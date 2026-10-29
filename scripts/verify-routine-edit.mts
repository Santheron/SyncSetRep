import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLANNED_EXERCISES, normalizeExerciseName } from '../lib/import/planned-exercises.ts';

const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const port = 55441;
const database = 'routine_edit_test';
const userA = '11111111-1111-1111-1111-111111111111';
const userB = '22222222-2222-2222-2222-222222222222';
const root = fileURLToPath(new URL('..', import.meta.url));
const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');

const sqlPaths = [
  'sql/load-mode.sql',
  'sql/program-day-archive.sql',
  'sql/exercise-ownership.sql',
  'sql/routine-edit.sql',
];
const rollbackPaths = [
  'sql/routine-edit-rollback.sql',
  'sql/exercise-ownership-rollback.sql',
  'sql/program-day-archive-rollback.sql',
  'sql/load-mode-rollback.sql',
];

function run(file: string, args: string[], input?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (status) => resolve({ code: status ?? 1, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function psql(sql: string, databaseName = database) {
  return run(psqlPath, [
    '-h', '127.0.0.1',
    '-p', String(port),
    '-U', 'postgres',
    '-d', databaseName,
    '-X',
    '-A',
    '-t',
    '-v', 'ON_ERROR_STOP=1',
    '-q',
  ], sql);
}

function asUser(userId: string, statement: string) {
  return `
BEGIN;
SELECT set_config('request.jwt.claim.sub', '${userId}', true) \\gset
SET LOCAL ROLE authenticated;
${statement}
COMMIT;
`;
}

function payload(json: unknown) {
  return `$payload$${JSON.stringify(json)}$payload$::jsonb`;
}

const finishedSetsSql = `
  SELECT coalesce(string_agg(
    id::text || ':' || coalesce(weight::text, 'null') || ':' || coalesce(reps::text, 'null'),
    ',' ORDER BY id
  ), '')
  FROM public.workout_sets
  WHERE workout_session_id IN (
    SELECT id FROM public.workout_sessions WHERE finished_at IS NOT NULL
  );
`;

const sessionsSql = `
  SELECT coalesce(string_agg(
    id::text || ':' || coalesce(program_day_id::text, '') || ':' ||
      CASE WHEN finished_at IS NULL THEN 'open' ELSE 'finished' END,
    ',' ORDER BY id
  ), '')
  FROM public.workout_sessions;
`;

async function main() {
  for (const path of [...sqlPaths, ...rollbackPaths]) {
    const text = await readFile(join(root, path), 'utf8');
    assert.equal(text.startsWith('-- NOT APPLIED.'), true, path);
    assert.equal(/supabase\.co|postgres:\/\/|password\s*=/i.test(text), false, path);
  }

  const plannedNames = PLANNED_EXERCISES.map((item) => item.name);
  const normalizedNames = plannedNames.map((name) => normalizeExerciseName(name));
  assert.equal(new Set(normalizedNames).size, normalizedNames.length);
  assert.ok(plannedNames.length >= 300 && plannedNames.length <= 500);
  const bench = 'Barbell Bench Press';
  assert.equal(plannedNames.includes(bench), true);
  const customPlanned = plannedNames.find((name) => normalizeExerciseName(name) !== normalizeExerciseName(bench));
  assert.ok(customPlanned);
  assert.equal(normalizeExerciseName('  Band-Fly  '), 'band fly');

  const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-routine-pg-'));
  const logFile = join(dataDir, 'server.log');
  let started = false;
  try {
    const initialized = await run(initdbPath, [
      '-D', dataDir,
      '-U', 'postgres',
      '--auth=trust',
      '--encoding=UTF8',
      '--no-locale',
    ]);
    assert.equal(initialized.code, 0, initialized.stderr);
    await writeFile(
      join(dataDir, 'postgresql.conf'),
      "\nlisten_addresses = '127.0.0.1'\nport = 55441\n",
      { flag: 'a' },
    );
    const startedResult = await run(pgCtlPath, ['-D', dataDir, '-l', logFile, '-w', 'start']);
    assert.equal(
      startedResult.code,
      0,
      `${startedResult.stderr}\n${await readFile(logFile, 'utf8').catch(() => '')}`,
    );
    started = true;

    const created = await psql(`CREATE DATABASE ${database};`, 'postgres');
    assert.equal(created.code, 0, created.stderr);

    const fixture = await psql(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
      INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}');

      CREATE TABLE public.programs (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES auth.users (id),
        name text NOT NULL,
        slug text,
        is_active boolean NOT NULL DEFAULT true,
        updated_at timestamptz NOT NULL DEFAULT timestamptz '2026-01-01T00:00:00Z'
      );
      CREATE UNIQUE INDEX programs_one_active_per_user_uidx
        ON public.programs (user_id)
        WHERE is_active;
      CREATE TABLE public.program_days (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        program_id bigint REFERENCES public.programs (id),
        name text NOT NULL,
        subtitle text,
        day_order integer NOT NULL,
        CONSTRAINT program_days_program_id_day_order_key UNIQUE NULLS NOT DISTINCT (program_id, day_order)
      );
      CREATE TABLE public.exercises (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name text NOT NULL
      );
      CREATE TABLE public.program_exercises (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        program_day_id bigint NOT NULL REFERENCES public.program_days (id),
        exercise_id bigint NOT NULL REFERENCES public.exercises (id),
        exercise_order integer NOT NULL,
        target_sets integer NOT NULL,
        min_reps integer,
        max_reps integer,
        notes text
      );
      CREATE TABLE public.workout_sessions (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id uuid NOT NULL,
        program_day_id bigint REFERENCES public.program_days (id),
        started_at timestamptz,
        finished_at timestamptz
      );
      CREATE TABLE public.workout_sets (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        workout_session_id bigint NOT NULL REFERENCES public.workout_sessions (id),
        exercise_id bigint NOT NULL,
        set_number integer NOT NULL,
        weight numeric,
        reps integer,
        rir integer,
        is_completed boolean
      );
      ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
      CREATE POLICY exercises_select_authenticated ON public.exercises
        FOR SELECT TO authenticated USING (true);
      GRANT SELECT ON TABLE
        public.programs, public.program_days, public.program_exercises,
        public.exercises, public.workout_sessions, public.workout_sets
        TO authenticated;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

      INSERT INTO public.exercises (name) VALUES ('${bench}');
      INSERT INTO public.programs (user_id, name, slug, is_active)
      VALUES
        ('${userA}', 'Home', NULL, true),
        ('${userB}', 'Other', NULL, true);
      INSERT INTO public.program_days (program_id, name, subtitle, day_order)
      VALUES
        (1, 'Push', NULL, 1),
        (1, 'Pull', 'Keep', 2),
        (1, 'Rest', NULL, 3);
      INSERT INTO public.program_exercises (
        program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps, notes
      )
      VALUES
        (1, 1, 1, 3, 8, 10, NULL),
        (2, 1, 1, 3, 5, 8, NULL);
      INSERT INTO public.workout_sessions (user_id, program_day_id, started_at, finished_at)
      VALUES
        ('${userA}', 2, timestamptz '2026-01-02T00:00:00Z', timestamptz '2026-01-02T01:00:00Z'),
        ('${userA}', 2, timestamptz '2026-03-01T00:00:00Z', NULL);
      INSERT INTO public.workout_sets (
        workout_session_id, exercise_id, set_number, weight, reps, rir, is_completed
      )
      VALUES
        (1, 1, 1, 135, 5, 2, true),
        (1, 1, 2, -4, 3, NULL, true),
        (1, 1, 3, 0, 8, NULL, true),
        (1, 1, 4, NULL, 4, NULL, true),
        (2, 1, 1, 100, 5, 1, false);
    `);
    assert.equal(fixture.code, 0, fixture.stderr);

    const finishedBefore = await psql(finishedSetsSql);
    const sessionsBefore = await psql(sessionsSql);
    assert.equal(finishedBefore.code, 0, finishedBefore.stderr);
    assert.equal(sessionsBefore.code, 0, sessionsBefore.stderr);
    const finishedSnapshot = finishedBefore.stdout.trim();
    const sessionSnapshot = sessionsBefore.stdout.trim();
    assert.match(finishedSnapshot, /135/);
    assert.match(finishedSnapshot, /-4/);

    for (const path of sqlPaths) {
      const applied = await psql(await readFile(join(root, path), 'utf8'));
      assert.equal(applied.code, 0, `${path}\n${applied.stderr}`);
    }

    const finishedAfterMigration = await psql(finishedSetsSql);
    const sessionsAfterMigration = await psql(sessionsSql);
    assert.equal(finishedAfterMigration.stdout.trim(), finishedSnapshot);
    assert.equal(sessionsAfterMigration.stdout.trim(), sessionSnapshot);

    const normalized = await psql(`SELECT public.normalize_exercise_name('  Band-Fly  ');`);
    assert.equal(normalized.code, 0, normalized.stderr);
    assert.equal(normalized.stdout.trim(), 'band fly');

    const legacyNegative = await psql(`
      INSERT INTO public.workout_sets (
        workout_session_id, exercise_id, set_number, weight, reps, is_completed
      )
      VALUES (2, 1, 9, -9, 1, false);
    `);
    assert.equal(legacyNegative.code, 0, legacyNegative.stderr);
    const mixedMode = await psql(`
      INSERT INTO public.workout_sets (
        workout_session_id, exercise_id, set_number, weight, assistance, load_mode, weight_unit, reps, is_completed
      )
      VALUES (2, 1, 10, 10, 5, 'added', 'lb', 5, false);
    `);
    assert.notEqual(mixedMode.code, 0);
    assert.match(mixedMode.stderr, /workout_sets_tracked_load_check/);

    const trackedCall = (userId: string, args: string) => psql(asUser(
      userId,
      `SELECT public.record_tracked_set(${args});`,
    ));
    const historyLocked = await trackedCall(
      userA,
      '1, 1, 1, \'added\', 10, NULL, \'lb\', 5, 2, true',
    );
    assert.notEqual(historyLocked.code, 0);
    assert.match(historyLocked.stderr, /history_locked/);
    const stranger = await trackedCall(
      userB,
      '2, 1, 1, \'added\', 10, NULL, \'lb\', 5, NULL, false',
    );
    assert.notEqual(stranger.code, 0);
    assert.match(stranger.stderr, /session_not_found/);
    const badAmount = await trackedCall(
      userA,
      '2, 1, 4, \'added\', 10, 5, \'lb\', 5, NULL, false',
    );
    assert.notEqual(badAmount.code, 0);
    assert.match(badAmount.stderr, /invalid_load_amount/);
    const missingSet = await psql(`
      SELECT count(*) FROM public.workout_sets WHERE workout_session_id = 2 AND set_number = 4;
    `);
    assert.equal(missingSet.stdout.trim(), '0');

    const added = await trackedCall(
      userA,
      '2, 1, 1, \'added\', 10, NULL, \'lb\', 8, 2, true',
    );
    assert.equal(added.code, 0, added.stderr);
    const addedAgain = await trackedCall(
      userA,
      '2, 1, 1, \'added\', 15, NULL, \'kg\', 8, 1, true',
    );
    assert.equal(addedAgain.code, 0, addedAgain.stderr);
    assert.equal(added.stdout.trim(), addedAgain.stdout.trim());
    const addedRow = await psql(`
      SELECT load_mode || ':' || weight::text || ':' || coalesce(assistance::text, 'null') || ':' || weight_unit
      FROM public.workout_sets
      WHERE workout_session_id = 2 AND set_number = 1;
    `);
    assert.equal(addedRow.stdout.trim(), 'added:15:null:kg');
    const assisted = await trackedCall(
      userA,
      '2, 1, 2, \'assisted\', NULL, 20, \'lb\', 6, NULL, true',
    );
    assert.equal(assisted.code, 0, assisted.stderr);
    const assistedRow = await psql(`
      SELECT load_mode || ':' || coalesce(weight::text, 'null') || ':' || assistance::text || ':' || weight_unit
      FROM public.workout_sets
      WHERE id = ${assisted.stdout.trim()};
    `);
    assert.equal(assistedRow.stdout.trim(), 'assisted:null:20:lb');
    const bodyweight = await trackedCall(
      userA,
      '2, 1, 3, \'bodyweight\', NULL, NULL, \'lb\', 8, NULL, true',
    );
    assert.equal(bodyweight.code, 0, bodyweight.stderr);
    const bodyweightRow = await psql(`
      SELECT load_mode || ':' || coalesce(weight::text, 'null') || ':' || coalesce(assistance::text, 'null')
      FROM public.workout_sets
      WHERE id = ${bodyweight.stdout.trim()};
    `);
    assert.equal(bodyweightRow.stdout.trim(), 'bodyweight:null:null');

    const emptyEdit = await psql(asUser(userA, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Home',
        days: [],
      })});
    `));
    assert.notEqual(emptyEdit.code, 0);
    assert.match(emptyEdit.stderr, /invalid_import: day_count/);
    const dayCount = await psql(`SELECT count(*) FROM public.program_days WHERE program_id = 1;`);
    assert.equal(dayCount.stdout.trim(), '3');

    const stolen = await psql(asUser(userB, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Stolen',
        days: [{ day_id: 1, name: 'Push', subtitle: null, exercises: [] }],
      })});
    `));
    assert.notEqual(stolen.code, 0);
    assert.match(stolen.stderr, /program_not_found/);
    const stillHome = await psql(`SELECT name || ':' || is_active::text FROM public.programs WHERE id = 1;`);
    assert.equal(stillHome.stdout.trim(), 'Home:true');

    const rolledBack = await psql(asUser(userA, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Should Not Stick',
        days: [
          {
            day_id: 1,
            name: 'Renamed',
            subtitle: null,
            exercises: [
              {
                custom_name: 'Band Fly',
                target_sets: 3,
                min_reps: 8,
                max_reps: 12,
                notes: null,
                load_mode: 'bodyweight',
              },
            ],
          },
          {
            name: 'Broken',
            subtitle: null,
            exercises: [
              { exercise_id: 99999, target_sets: 3, min_reps: 8, max_reps: 12, notes: null },
            ],
          },
        ],
      })});
    `));
    assert.notEqual(rolledBack.code, 0);
    assert.match(rolledBack.stderr, /unknown_exercise/);
    const afterRollbackAttempt = await psql(`
      SELECT
        (SELECT name FROM public.programs WHERE id = 1) || '|' ||
        (SELECT name FROM public.program_days WHERE id = 1) || '|' ||
        (SELECT count(*) FROM public.exercises WHERE public.normalize_exercise_name(name) = 'band fly')::text || '|' ||
        (SELECT count(*) FROM public.program_days)::text;
    `);
    assert.equal(afterRollbackAttempt.stdout.trim(), 'Home|Push|0|3');
    const finishedAfterFailure = await psql(finishedSetsSql);
    const sessionsAfterFailure = await psql(sessionsSql);
    assert.equal(finishedAfterFailure.stdout.trim(), finishedSnapshot);
    assert.equal(sessionsAfterFailure.stdout.trim(), sessionSnapshot);

    const edited = await psql(asUser(userA, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Home edited',
        days: [
          {
            day_id: 1,
            name: 'Push day',
            subtitle: 'Upper',
            exercises: [
              {
                exercise_id: 1,
                target_sets: 4,
                min_reps: 6,
                max_reps: 10,
                notes: 'Pause',
                load_mode: 'added',
              },
            ],
          },
          { name: 'Legs', subtitle: null, exercises: [] },
        ],
      })});
    `));
    assert.equal(edited.code, 0, edited.stderr);
    const shape = await psql(`
      SELECT id::text || ':' || name || ':' || coalesce(archived_at::text, 'active') || ':' || day_order::text
      FROM public.program_days
      WHERE program_id = 1
      ORDER BY id;
    `);
    assert.match(shape.stdout, /^1:Push day:active:1/m);
    assert.match(shape.stdout, /^2:Pull:/m);
    assert.match(shape.stdout, /:10000/);
    assert.equal(shape.stdout.includes('\n3:'), false);
    const archived = await psql(`
      SELECT (archived_at IS NOT NULL)::text || ':' || (day_order >= 100000)::text
      FROM public.program_days
      WHERE id = 2;
    `);
    assert.equal(archived.stdout.trim(), 'true:true');
    const prescription = await psql(`
      SELECT exercise_id::text || ':' || target_sets::text || ':' || min_reps::text || ':' ||
        max_reps::text || ':' || coalesce(notes, '') || ':' || coalesce(load_mode, '')
      FROM public.program_exercises
      WHERE program_day_id = 1;
    `);
    assert.equal(prescription.stdout.trim(), '1:4:6:10:Pause:added');
    const legs = await psql(`
      SELECT id::text
      FROM public.program_days
      WHERE program_id = 1 AND name = 'Legs' AND archived_at IS NULL;
    `);
    const legsId = Number(legs.stdout.trim());
    assert.equal(Number.isInteger(legsId) && legsId > 0, true);
    const archivedAt = await psql(`SELECT archived_at::text FROM public.program_days WHERE id = 2;`);
    const sessionLink = await psql(`SELECT program_day_id::text FROM public.workout_sessions WHERE id = 1;`);
    assert.equal(sessionLink.stdout.trim(), '2');
    const activeFlag = await psql(`SELECT is_active::text FROM public.programs WHERE id = 1;`);
    assert.equal(activeFlag.stdout.trim(), 'true');

    const repeat = await psql(asUser(userA, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Home edited',
        days: [
          {
            day_id: 1,
            name: 'Push day',
            subtitle: 'Upper',
            exercises: [
              {
                exercise_id: 1,
                target_sets: 4,
                min_reps: 6,
                max_reps: 10,
                notes: 'Pause',
                load_mode: 'added',
              },
            ],
          },
          { day_id: legsId, name: 'Legs', subtitle: null, exercises: [] },
        ],
      })});
    `));
    assert.equal(repeat.code, 0, repeat.stderr);
    const shapeAgain = await psql(`
      SELECT id::text || ':' || name || ':' || coalesce(archived_at::text, 'active') || ':' || day_order::text
      FROM public.program_days
      WHERE program_id = 1
      ORDER BY id;
    `);
    assert.equal(shapeAgain.stdout.trim(), shape.stdout.trim());
    const archivedAtAgain = await psql(`SELECT archived_at::text FROM public.program_days WHERE id = 2;`);
    assert.equal(archivedAtAgain.stdout.trim(), archivedAt.stdout.trim());
    const dayCountAgain = await psql(`SELECT count(*) FROM public.program_days WHERE program_id = 1;`);
    assert.equal(dayCountAgain.stdout.trim(), '3');

    const lockedDay = await psql(asUser(userA, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Home edited',
        days: [
          { day_id: 2, name: 'Pull again', subtitle: null, exercises: [] },
          { day_id: legsId, name: 'Legs', subtitle: null, exercises: [] },
        ],
      })});
    `));
    assert.notEqual(lockedDay.code, 0);
    assert.match(lockedDay.stderr, /archived_day_locked/);
    const nameAfterLock = await psql(`SELECT name FROM public.programs WHERE id = 1;`);
    assert.equal(nameAfterLock.stdout.trim(), 'Home edited');

    const directDay = await psql(asUser(
      userA,
      `UPDATE public.program_days SET name = 'Hacked' WHERE id = 1;`,
    ));
    assert.notEqual(directDay.code, 0);
    assert.match(directDay.stderr, /permission denied/);
    const dayName = await psql(`SELECT name FROM public.program_days WHERE id = 1;`);
    assert.equal(dayName.stdout.trim(), 'Push day');

    const custom = await psql(asUser(
      userA,
      `SELECT public.create_custom_exercise('${customPlanned.replace(/'/g, "''")}');`,
    ));
    assert.equal(custom.code, 0, custom.stderr);
    const customAgain = await psql(asUser(
      userA,
      `SELECT public.create_custom_exercise('  ${customPlanned.replace(/'/g, "''")}  ');`,
    ));
    assert.equal(customAgain.code, 0, customAgain.stderr);
    assert.equal(custom.stdout.trim(), customAgain.stdout.trim());
    const customId = custom.stdout.trim();
    const customCount = await psql(`
      SELECT count(*)
      FROM public.exercises
      WHERE owner_user_id = '${userA}'
        AND public.normalize_exercise_name(name) = public.normalize_exercise_name('${customPlanned.replace(/'/g, "''")}');
    `);
    assert.equal(customCount.stdout.trim(), '1');
    const catalogClash = await psql(asUser(
      userA,
      `SELECT public.create_custom_exercise('  barbell   bench press ');`,
    ));
    assert.notEqual(catalogClash.code, 0);
    assert.match(catalogClash.stderr, /use_catalog_exercise/);
    const hidden = await psql(asUser(
      userB,
      `SELECT count(*) FROM public.exercises WHERE id = ${customId};`,
    ));
    assert.equal(hidden.code, 0, hidden.stderr);
    assert.equal(hidden.stdout.trim(), '0');
    const visible = await psql(asUser(
      userA,
      `SELECT count(*) FROM public.exercises WHERE id = ${customId};`,
    ));
    assert.equal(visible.stdout.trim(), '1');
    const sharedInsert = await psql(asUser(
      userA,
      `INSERT INTO public.exercises (name, owner_user_id) VALUES ('Shared Fake', NULL);`,
    ));
    assert.notEqual(sharedInsert.code, 0);
    assert.match(sharedInsert.stderr, /row-level security|new row violates/);
    const sharedUpdate = await psql(asUser(
      userA,
      `UPDATE public.exercises SET name = 'Hacked Bench' WHERE id = 1;`,
    ));
    assert.equal(sharedUpdate.code, 0, sharedUpdate.stderr);
    const benchName = await psql(`SELECT name || ':' || coalesce(owner_user_id::text, 'shared') FROM public.exercises WHERE id = 1;`);
    assert.equal(benchName.stdout.trim(), `${bench}:shared`);
    const beforeSeed = await psql(`
      SELECT id::text || '|' || name || '|' || coalesce(owner_user_id::text, 'shared')
      FROM public.exercises
      WHERE id IN (1, ${customId})
      ORDER BY id;
    `);

    const seeded = await psql(`
      SELECT public.seed_standard_exercises($planned$${JSON.stringify(PLANNED_EXERCISES)}$planned$::jsonb);
    `);
    assert.equal(seeded.code, 0, seeded.stderr);
    assert.equal(seeded.stdout.trim(), String(plannedNames.length - 2));
    const afterSeed = await psql(`
      SELECT id::text || '|' || name || '|' || coalesce(owner_user_id::text, 'shared')
      FROM public.exercises
      WHERE id IN (1, ${customId})
      ORDER BY id;
    `);
    assert.equal(afterSeed.stdout.trim(), beforeSeed.stdout.trim());
    const seededAgain = await psql(`
      SELECT public.seed_standard_exercises($planned$${JSON.stringify(plannedNames)}$planned$::jsonb);
    `);
    assert.equal(seededAgain.code, 0, seededAgain.stderr);
    assert.equal(seededAgain.stdout.trim(), '0');
    const seedDenied = await psql(asUser(
      userA,
      `SELECT public.seed_standard_exercises('[]'::jsonb);`,
    ));
    assert.notEqual(seedDenied.code, 0);
    assert.match(seedDenied.stderr, /permission denied/);
    const resolveDenied = await psql(asUser(
      userA,
      `SELECT public.resolve_routine_exercise('${userA}'::uuid, '{}'::jsonb);`,
    ));
    assert.notEqual(resolveDenied.code, 0);
    assert.match(resolveDenied.stderr, /permission denied/);

    const badSave = await psql(asUser(userA, `
      SELECT public.save_manual_program(${payload({
        name: 'Nope',
        days: [
          {
            name: 'A',
            subtitle: null,
            exercises: [
              { custom_name: 'Only Once', target_sets: 3, min_reps: 8, max_reps: 12, notes: null },
            ],
          },
          {
            name: 'B',
            subtitle: null,
            exercises: [
              { exercise_id: 99999, target_sets: 3, min_reps: 8, max_reps: 12, notes: null },
            ],
          },
        ],
      })});
    `));
    assert.notEqual(badSave.code, 0);
    assert.match(badSave.stderr, /unknown_exercise/);
    const noNope = await psql(`
      SELECT
        (SELECT count(*) FROM public.programs WHERE name = 'Nope')::text || '|' ||
        (SELECT count(*) FROM public.exercises WHERE name = 'Only Once')::text;
    `);
    assert.equal(noNope.stdout.trim(), '0|0');

    const privateName = 'SyncSetRep Private Fly';
    assert.equal(
      plannedNames.some((name) => normalizeExerciseName(name) === normalizeExerciseName(privateName)),
      false,
    );
    const band = await psql(asUser(userA, `SELECT public.create_custom_exercise('${privateName}');`));
    assert.equal(band.code, 0, band.stderr);
    const bandAgain = await psql(asUser(userA, `SELECT public.create_custom_exercise('syncsetrep private fly');`));
    assert.equal(bandAgain.stdout.trim(), band.stdout.trim());
    const manualPayload = {
      name: 'Manual Arms',
      days: [
        {
          name: 'Arms',
          subtitle: null,
          exercises: [
            {
              custom_name: privateName,
              target_sets: 3,
              min_reps: 8,
              max_reps: 12,
              notes: null,
              load_mode: 'assisted',
            },
          ],
        },
      ],
    };
    const firstManual = await psql(asUser(
      userA,
      `SELECT public.save_manual_program(${payload(manualPayload)});`,
    ));
    assert.equal(firstManual.code, 0, firstManual.stderr);
    const secondManual = await psql(asUser(
      userA,
      `SELECT public.save_manual_program(${payload(manualPayload)});`,
    ));
    assert.equal(secondManual.code, 0, secondManual.stderr);
    assert.notEqual(firstManual.stdout.trim(), secondManual.stdout.trim());
    const manualState = await psql(`
      SELECT
        (SELECT count(*) FROM public.programs WHERE user_id = '${userA}' AND is_active)::text || '|' ||
        (SELECT count(*) FROM public.programs WHERE user_id = '${userA}' AND NOT is_active)::text || '|' ||
        (SELECT is_active::text FROM public.programs WHERE id = 1);
    `);
    assert.equal(manualState.stdout.trim(), '1|2|true');
    const manualExercise = await psql(`
      SELECT exercise_id::text || ':' || coalesce(load_mode, '')
      FROM public.program_exercises
      WHERE program_day_id IN (
        SELECT id FROM public.program_days WHERE program_id = ${firstManual.stdout.trim()}
      );
    `);
    assert.equal(manualExercise.stdout.trim(), `${band.stdout.trim()}:assisted`);

    const otherManual = await psql(asUser(userB, `
      SELECT public.save_manual_program(${payload({
        name: 'Other manual',
        days: [
          {
            name: 'Day',
            subtitle: null,
            exercises: [
              { exercise_id: 1, target_sets: 3, min_reps: 8, max_reps: 10, notes: null },
            ],
          },
        ],
      })});
    `));
    assert.equal(otherManual.code, 0, otherManual.stderr);
    const otherActive = await psql(`
      SELECT count(*) FILTER (WHERE is_active)::text || ':' || count(*)::text
      FROM public.programs
      WHERE user_id = '${userB}';
    `);
    assert.equal(otherActive.stdout.trim(), '1:2');
    const hiddenExercise = await psql(asUser(userB, `
      SELECT public.save_manual_program(${payload({
        name: 'Hidden',
        days: [
          {
            name: 'Day',
            subtitle: null,
            exercises: [
              { exercise_id: Number(customId), target_sets: 3, min_reps: 8, max_reps: 10, notes: null },
            ],
          },
        ],
      })});
    `));
    assert.notEqual(hiddenExercise.code, 0);
    assert.match(hiddenExercise.stderr, /unknown_exercise/);
    const noHidden = await psql(`SELECT count(*) FROM public.programs WHERE name = 'Hidden';`);
    assert.equal(noHidden.stdout.trim(), '0');

    const activeDays = await psql(`
      SELECT id::text
      FROM public.program_days
      WHERE program_id = 1 AND archived_at IS NULL
      ORDER BY day_order, id;
    `);
    const activeDayIds = activeDays.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
    assert.deepEqual(activeDayIds, [1, legsId]);
    const namedPayload = (name: string) => payload({
      program_id: 1,
      name,
      days: [
        {
          day_id: 1,
          name: 'Push day',
          subtitle: 'Upper',
          exercises: [
            {
              exercise_id: 1,
              target_sets: 4,
              min_reps: 6,
              max_reps: 10,
              notes: 'Pause',
              load_mode: 'added',
            },
          ],
        },
        { day_id: legsId, name: 'Legs', subtitle: null, exercises: [] },
      ],
    });

    const holder = spawn(psqlPath, [
      '-h', '127.0.0.1',
      '-p', String(port),
      '-U', 'postgres',
      '-d', database,
      '-X',
      '-v', 'ON_ERROR_STOP=1',
      '-A',
      '-t',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let holderOut = '';
    let holderErr = '';
    holder.stdout.on('data', (chunk) => {
      holderOut += chunk.toString();
    });
    holder.stderr.on('data', (chunk) => {
      holderErr += chunk.toString();
    });
    const waitFor = async (text: string) => {
      const deadline = Date.now() + 15000;
      while (!holderOut.includes(text)) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for ${text}. stdout=${holderOut} stderr=${holderErr}`);
        }
        await sleep(25);
      }
    };
    holder.stdin.write(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${userA}', true);
      SET LOCAL ROLE authenticated;
      SELECT public.update_owned_program(${namedPayload('Hold Name')});
      SELECT 'EDIT_LOCK_HELD';
    `);
    await waitFor('EDIT_LOCK_HELD');
    const duringHold = await psql(`SELECT name FROM public.programs WHERE id = 1;`);
    assert.equal(duringHold.stdout.trim(), 'Home edited');
    let secondDone = false;
    const second = psql(asUser(
      userA,
      `SELECT public.update_owned_program(${namedPayload('Final Name')});`,
    )).then((result) => {
      secondDone = true;
      return result;
    });
    await sleep(400);
    assert.equal(secondDone, false);
    const finishedDuring = await psql(finishedSetsSql);
    assert.equal(finishedDuring.stdout.trim(), finishedSnapshot);
    holder.stdin.write(`COMMIT;\nSELECT 'EDIT_LOCK_RELEASED';\n`);
    await waitFor('EDIT_LOCK_RELEASED');
    const secondResult = await second;
    assert.equal(secondResult.code, 0, secondResult.stderr);
    holder.stdin.end();
    const holderExit = await new Promise<number>((resolve, reject) => {
      holder.on('error', reject);
      holder.on('exit', (status) => resolve(status ?? 1));
    });
    assert.equal(holderExit, 0, holderErr);
    const finalName = await psql(`SELECT name || ':' || is_active::text FROM public.programs WHERE id = 1;`);
    assert.equal(finalName.stdout.trim(), 'Final Name:true');
    const dayCountFinal = await psql(`SELECT count(*) FROM public.program_days WHERE program_id = 1;`);
    assert.equal(dayCountFinal.stdout.trim(), '3');

    const definitions = await psql(`
      SELECT proname || ':' || prosecdef::text || ':' || coalesce(array_to_string(proconfig, ','), '')
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN (
          'record_tracked_set',
          'seed_standard_exercises',
          'create_custom_exercise',
          'resolve_routine_exercise',
          'routine_write_days',
          'update_owned_program',
          'save_manual_program'
        )
      ORDER BY 1;
    `);
    assert.equal(definitions.code, 0, definitions.stderr);
    for (const line of definitions.stdout.trim().split(/\r?\n/)) {
      assert.match(line, /:true:/);
      assert.match(line, /search_path=/);
    }
    const updateDef = await psql(`SELECT pg_get_functiondef('public.update_owned_program(jsonb)'::regprocedure);`);
    assert.equal(updateDef.code, 0, updateDef.stderr);
    assert.equal(/is_active|workout_sets/i.test(updateDef.stdout), false);
    assert.match(updateDef.stdout, /archived_day_locked/);
    const saveDef = await psql(`SELECT pg_get_functiondef('public.save_manual_program(jsonb)'::regprocedure);`);
    assert.match(saveDef.stdout, /is_active/);
    assert.match(saveDef.stdout, /false/);
    assert.equal(/workout_sessions|workout_sets/i.test(saveDef.stdout), false);
    const writeDef = await psql(`SELECT pg_get_functiondef('public.routine_write_days(uuid,bigint,jsonb,boolean)'::regprocedure);`);
    assert.match(writeDef.stdout, /workout_sessions/);
    assert.equal(/workout_sets|is_active/i.test(writeDef.stdout), false);
    const grants = await psql(`
      SELECT has_function_privilege('authenticated', 'public.update_owned_program(jsonb)', 'EXECUTE')::text
        || ':' || has_function_privilege('anon', 'public.update_owned_program(jsonb)', 'EXECUTE')::text
        || ':' || has_function_privilege('authenticated', 'public.seed_standard_exercises(jsonb)', 'EXECUTE')::text
        || ':' || has_function_privilege('authenticated', 'public.resolve_routine_exercise(uuid,jsonb)', 'EXECUTE')::text
        || ':' || has_function_privilege('authenticated', 'public.create_custom_exercise(text)', 'EXECUTE')::text
        || ':' || has_function_privilege('authenticated', 'public.save_manual_program(jsonb)', 'EXECUTE')::text;
    `);
    assert.equal(grants.stdout.trim(), 'true:false:false:false:true:true');

    const finishedBeforeRollback = await psql(finishedSetsSql);
    const sessionsBeforeRollback = await psql(sessionsSql);
    assert.equal(finishedBeforeRollback.stdout.trim(), finishedSnapshot);
    assert.equal(sessionsBeforeRollback.stdout.trim(), sessionSnapshot);

    for (const path of rollbackPaths) {
      const applied = await psql(await readFile(join(root, path), 'utf8'));
      assert.equal(applied.code, 0, `${path}\n${applied.stderr}`);
    }

    const functionsGone = await psql(`
      SELECT count(*)
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN (
          'record_tracked_set',
          'seed_standard_exercises',
          'create_custom_exercise',
          'normalize_exercise_name',
          'resolve_routine_exercise',
          'routine_write_days',
          'routine_normalize_days',
          'routine_require_int',
          'update_owned_program',
          'save_manual_program'
        );
    `);
    assert.equal(functionsGone.stdout.trim(), '0');
    const columnsGone = await psql(`
      SELECT count(*)
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'workout_sets' AND column_name IN ('load_mode', 'assistance', 'weight_unit'))
          OR (table_name = 'program_exercises' AND column_name = 'load_mode')
          OR (table_name = 'program_days' AND column_name = 'archived_at')
          OR (table_name = 'exercises' AND column_name = 'owner_user_id')
        );
    `);
    assert.equal(columnsGone.stdout.trim(), '0');
    const archivedOrder = await psql(`
      SELECT (day_order >= 100000)::text || ':' || id::text
      FROM public.program_days
      WHERE id = 2;
    `);
    assert.equal(archivedOrder.stdout.trim(), 'true:2');
    const stillLinked = await psql(`SELECT program_day_id::text FROM public.workout_sessions WHERE id = 1;`);
    assert.equal(stillLinked.stdout.trim(), '2');
    const finishedAfterRollback = await psql(finishedSetsSql);
    const sessionsAfterRollback = await psql(sessionsSql);
    assert.equal(finishedAfterRollback.stdout.trim(), finishedSnapshot);
    assert.equal(sessionsAfterRollback.stdout.trim(), sessionSnapshot);
    const restoredPolicy = await psql(`
      SELECT count(*)
      FROM pg_policy
      WHERE polrelid = 'public.exercises'::regclass
        AND polname = 'exercises_select_authenticated';
    `);
    assert.equal(restoredPolicy.stdout.trim(), '1');
    const benchRemains = await psql(`SELECT name FROM public.exercises WHERE id = 1;`);
    assert.equal(benchRemains.stdout.trim(), bench);

    console.log('routine edit checks passed');
    console.log(`finished sets preserved: ${finishedSnapshot}`);
  } finally {
    if (started) {
      const stopped = await run(pgCtlPath, ['-D', dataDir, '-m', 'immediate', '-w', 'stop']);
      if (stopped.code !== 0) {
        console.error(stopped.stderr);
      }
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(dataDir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 4) {
          throw error;
        }
        await sleep(200);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
