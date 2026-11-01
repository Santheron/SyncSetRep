import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const port = 55433;
const database = 'activation_concurrency_test';
const userA = '11111111-1111-1111-1111-111111111111';
const userB = '22222222-2222-2222-2222-222222222222';
const userC = '33333333-3333-3333-3333-333333333333';
const userD = '44444444-4444-4444-4444-444444444444';
const activationSqlPath = fileURLToPath(new URL('../sql/program-activation.sql', import.meta.url));
const privilegeSqlPath = fileURLToPath(new URL('../sql/program-activation-privilege.sql', import.meta.url));

const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');

const routine = JSON.stringify({
  name: 'First Routine',
  days: [
    {
      name: 'Day',
      subtitle: null,
      exercises: [
        { exercise_id: 1, target_sets: 3, min_reps: 8, max_reps: 10, notes: null },
      ],
    },
  ],
});

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
SELECT set_config('request.jwt.claim.sub', '${userId}', true);
SET LOCAL ROLE authenticated;
${statement}
COMMIT;
`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-activation-pg-'));
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
      `\nlisten_addresses = '127.0.0.1'\nport = ${port}\n`,
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
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
      INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}'), ('${userC}'), ('${userD}');

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
        program_day_id bigint,
        started_at timestamptz,
        finished_at timestamptz
      );
      CREATE TABLE public.workout_sets (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        workout_session_id bigint NOT NULL REFERENCES public.workout_sessions (id),
        exercise_id bigint NOT NULL,
        reps integer
      );
      ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.program_days ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.program_exercises ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
      CREATE POLICY programs_select_own ON public.programs
        FOR SELECT TO authenticated USING (user_id = auth.uid());
      CREATE POLICY programs_insert_own ON public.programs
        FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
      CREATE POLICY programs_update_own ON public.programs
        FOR UPDATE TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
      CREATE POLICY program_days_select_own ON public.program_days
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.programs
            WHERE programs.id = program_id AND programs.user_id = auth.uid()
          )
        );
      CREATE POLICY program_days_insert_own ON public.program_days
        FOR INSERT TO authenticated
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM public.programs
            WHERE programs.id = program_id AND programs.user_id = auth.uid()
          )
        );
      CREATE POLICY program_exercises_select_own ON public.program_exercises
        FOR SELECT TO authenticated
        USING (
          EXISTS (
            SELECT 1
            FROM public.program_days
            JOIN public.programs ON programs.id = program_days.program_id
            WHERE program_days.id = program_day_id
              AND programs.user_id = auth.uid()
          )
        );
      CREATE POLICY program_exercises_insert_own ON public.program_exercises
        FOR INSERT TO authenticated
        WITH CHECK (
          EXISTS (
            SELECT 1
            FROM public.program_days
            JOIN public.programs ON programs.id = program_days.program_id
            WHERE program_days.id = program_day_id
              AND programs.user_id = auth.uid()
          )
        );
      CREATE POLICY exercises_select_authenticated ON public.exercises
        FOR SELECT TO authenticated USING (true);
      INSERT INTO public.exercises (name) VALUES ('Bench Press');
      INSERT INTO public.programs (user_id, name, slug, is_active)
      VALUES
        ('${userA}', 'Current', NULL, true),
        ('${userA}', 'Saved', NULL, false),
        ('${userB}', 'Other current', NULL, true),
        ('${userD}', 'Parked', NULL, false);
      INSERT INTO public.program_days (program_id, name, subtitle, day_order)
      VALUES (1, 'Current day', 'Keep', 1);
      INSERT INTO public.workout_sessions (user_id, program_day_id, started_at, finished_at)
      VALUES
        ('${userA}', 1, timestamptz '2026-01-02T00:00:00Z', timestamptz '2026-01-02T01:00:00Z'),
        ('${userA}', 1, timestamptz '2026-03-01T00:00:00Z', NULL);
      INSERT INTO public.workout_sets (workout_session_id, exercise_id, reps)
      SELECT id, 1, 8 FROM public.workout_sessions ORDER BY id;
    `);
    assert.equal(fixture.code, 0, fixture.stderr);

    const migration = await psql(await readFile(activationSqlPath, 'utf8'));
    assert.equal(migration.code, 0, migration.stderr);
    const privilege = await psql(await readFile(privilegeSqlPath, 'utf8'));
    assert.equal(privilege.code, 0, privilege.stderr);
    const definer = await psql(`
      SELECT prosecdef::text
      FROM pg_proc
      WHERE oid IN (
        to_regprocedure('public.save_owned_program(jsonb, boolean)'),
        to_regprocedure('public.activate_owned_program(bigint)')
      )
      ORDER BY 1;
    `);
    assert.equal(definer.code, 0, definer.stderr);
    assert.equal(definer.stdout.includes('f'), false, definer.stdout);
    assert.match(definer.stdout, /t/);

    const historySql = `
      SELECT coalesce(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')
      FROM (
        SELECT id, user_id, program_day_id, finished_at
        FROM public.workout_sessions
        ORDER BY id
      ) s;
    `;
    const setsSql = `
      SELECT coalesce(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')
      FROM (
        SELECT id, workout_session_id, exercise_id, reps
        FROM public.workout_sets
        ORDER BY id
      ) s;
    `;
    const beforeHistory = await psql(historySql);
    const beforeSets = await psql(setsSql);
    assert.equal(beforeHistory.code, 0, beforeHistory.stderr);
    assert.equal(beforeSets.code, 0, beforeSets.stderr);

    const ownership = await psql(asUser(userB, 'SELECT public.activate_owned_program(1);'));
    assert.notEqual(ownership.code, 0);
    assert.match(ownership.stderr, /program_not_found/);
    const afterOwnership = await psql(`
      SELECT id::text || ':' || is_active::text
      FROM public.programs
      ORDER BY id;
    `);
    assert.equal(afterOwnership.code, 0, afterOwnership.stderr);
    assert.match(afterOwnership.stdout, /1:t/);
    assert.match(afterOwnership.stdout, /2:f/);
    assert.match(afterOwnership.stdout, /3:t/);

    const parked = await psql(asUser(userD, 'SELECT public.activate_owned_program(4);'));
    assert.equal(parked.code, 0, parked.stderr);
    const parkedState = await psql(`
      SELECT count(*) FILTER (WHERE is_active) 
      FROM public.programs
      WHERE user_id = '${userD}';
    `);
    assert.match(parkedState.stdout, /\b1\b/);

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
      const deadline = Date.now() + 10000;
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
      SELECT public.activate_owned_program(2);
      SELECT 'ACTIVATE_HOLD_READY';
    `);
    await waitFor('ACTIVATE_HOLD_READY');
    const duringHold = await psql(`
      SELECT id::text || ':' || is_active::text
      FROM public.programs
      WHERE user_id = '${userA}'
      ORDER BY id;
    `);
    assert.match(duringHold.stdout, /1:t/);
    assert.match(duringHold.stdout, /2:f/);
    holder.stdin.write(`ROLLBACK;\nSELECT 'ACTIVATE_ROLLED_BACK';\n`);
    await waitFor('ACTIVATE_ROLLED_BACK');
    const afterRollback = await psql(`
      SELECT id::text || ':' || is_active::text
      FROM public.programs
      WHERE user_id = '${userA}'
      ORDER BY id;
    `);
    assert.match(afterRollback.stdout, /1:t/);
    assert.match(afterRollback.stdout, /2:f/);

    holder.stdin.write(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${userA}', true);
      SET LOCAL ROLE authenticated;
      SELECT public.activate_owned_program(2);
      SELECT 'ACTIVATE_LOCK_HELD';
    `);
    await waitFor('ACTIVATE_LOCK_HELD');
    let secondDone = false;
    const second = psql(asUser(userA, 'SELECT public.activate_owned_program(1);')).then((result) => {
      secondDone = true;
      return result;
    });
    await sleep(300);
    assert.equal(secondDone, false);
    const whileBlocked = await psql(`
      SELECT id::text || ':' || is_active::text
      FROM public.programs
      WHERE user_id = '${userA}'
      ORDER BY id;
    `);
    assert.match(whileBlocked.stdout, /1:t/);
    assert.match(whileBlocked.stdout, /2:f/);
    holder.stdin.write(`COMMIT;\nSELECT 'ACTIVATE_LOCK_RELEASED';\n`);
    await waitFor('ACTIVATE_LOCK_RELEASED');
    const secondResult = await second;
    assert.equal(secondResult.code, 0, secondResult.stderr);
    holder.stdin.end();
    const holderExit = await new Promise<number>((resolve, reject) => {
      holder.on('error', reject);
      holder.on('exit', (status) => resolve(status ?? 1));
    });
    assert.equal(holderExit, 0, holderErr);

    const afterSwitch = await psql(`
      SELECT id::text || ':' || is_active::text
      FROM public.programs
      WHERE user_id = '${userA}'
      ORDER BY id;
    `);
    assert.match(afterSwitch.stdout, /1:t/);
    assert.match(afterSwitch.stdout, /2:f/);
    const activeCount = await psql(`
      SELECT count(*)
      FROM public.programs
      WHERE user_id = '${userA}' AND is_active;
    `);
    assert.match(activeCount.stdout, /\b1\b/);
    const openSession = await psql(`
      SELECT program_day_id::text || '|' || CASE WHEN finished_at IS NULL THEN 'open' ELSE 'finished' END
      FROM public.workout_sessions
      WHERE finished_at IS NULL;
    `);
    assert.match(openSession.stdout, /1\|open/);

    const firstSaves = await Promise.all([
      psql(asUser(
        userC,
        `SELECT public.save_owned_program($json$${routine}$json$::jsonb, true);`,
      )),
      psql(asUser(
        userC,
        `SELECT public.save_owned_program($json$${routine}$json$::jsonb, true);`,
      )),
    ]);
    const accepted = firstSaves.filter((result) => result.code === 0);
    const rejected = firstSaves.filter(
      (result) => result.code !== 0 && /active_program_exists/.test(result.stderr),
    );
    const other = firstSaves.filter(
      (result) => result.code !== 0 && !/active_program_exists/.test(result.stderr),
    );
    assert.equal(other.length, 0, other.map((result) => result.stderr).join('\n'));
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    const firstState = await psql(`
      SELECT count(*)::text || ':' || count(*) FILTER (WHERE is_active)::text
      FROM public.programs
      WHERE user_id = '${userC}';
    `);
    assert.match(firstState.stdout, /1:1/);

    const flagsBeforeProbes = await psql(`
      SELECT id::text || ':' || is_active::text
      FROM public.programs
      ORDER BY id;
    `);
    assert.equal(flagsBeforeProbes.code, 0, flagsBeforeProbes.stderr);
    const columnPrivileges = await psql(`
      SELECT has_column_privilege('authenticated', 'public.programs', 'is_active', 'UPDATE')::text
        || ':' || has_column_privilege('authenticated', 'public.programs', 'name', 'UPDATE')::text
        || ':' || has_table_privilege('authenticated', 'public.programs', 'UPDATE')::text
        || ':' || has_table_privilege('authenticated', 'public.programs', 'INSERT')::text;
    `);
    assert.equal(columnPrivileges.code, 0, columnPrivileges.stderr);
    assert.match(columnPrivileges.stdout, /false:true:false:true/);
    const locked = await psql(asUser(
      userA,
      'SELECT id FROM public.programs WHERE id = 1 FOR UPDATE;',
    ));
    assert.equal(locked.code, 0, locked.stderr);
    const denied = await psql(asUser(
      userA,
      'UPDATE public.programs SET is_active = false WHERE id = 1;',
    ));
    assert.notEqual(denied.code, 0);
    assert.match(denied.stderr, /permission denied/);
    const gucBypass = await psql(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${userA}', true);
      SELECT set_config('syncsetrep.program_activation', 'on', true);
      SET LOCAL ROLE authenticated;
      UPDATE public.programs SET is_active = false WHERE id = 1;
      COMMIT;
    `);
    assert.notEqual(gucBypass.code, 0);
    assert.match(gucBypass.stderr, /permission denied/);
    const directInsert = await psql(asUser(
      userA,
      `INSERT INTO public.programs (user_id, name, is_active) VALUES ('${userA}', 'Direct', true);`,
    ));
    assert.notEqual(directInsert.code, 0);
    assert.match(directInsert.stderr, /program_activation_rpc_required/);
    const anonCall = await psql(`
      BEGIN;
      SET LOCAL ROLE anon;
      SELECT public.activate_owned_program(1);
      COMMIT;
    `);
    assert.notEqual(anonCall.code, 0);
    assert.match(anonCall.stderr, /permission denied/);
    const unsignedCall = await psql('SELECT public.activate_owned_program(1);');
    assert.notEqual(unsignedCall.code, 0);
    assert.match(unsignedCall.stderr, /Not authenticated/);
    const ownerReassign = await psql(`UPDATE public.programs SET user_id = '${userB}' WHERE id = 1;`);
    assert.notEqual(ownerReassign.code, 0);
    assert.match(ownerReassign.stderr, /program_owner_change_forbidden/);
    const flagsAfterProbes = await psql(`
      SELECT id::text || ':' || is_active::text
      FROM public.programs
      ORDER BY id;
    `);
    assert.equal(flagsAfterProbes.stdout, flagsBeforeProbes.stdout);

    const afterHistory = await psql(historySql);
    const afterSets = await psql(setsSql);
    assert.equal(afterHistory.stdout, beforeHistory.stdout);
    assert.equal(afterSets.stdout, beforeSets.stdout);

    console.log('program activation concurrency checks passed');
  } finally {
    if (started) {
      await run(pgCtlPath, ['-D', dataDir, '-m', 'fast', '-w', 'stop']).catch(() => undefined);
    }
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

await main();
