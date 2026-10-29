import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { IMPORT_ENABLED, PERSIST_REST_SECONDS, SUBTITLE_REQUIRED } from '../lib/import/flags.ts';

const require = createRequire(import.meta.url);

function readSql(name: string) {
  return readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');
}

function stripSql(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

const activationSql = readSql('program-activation.sql');
const rollbackSql = readSql('program-activation-rollback.sql');
const verifySql = readSql('program-activation-verify.sql');
const activationBody = stripSql(activationSql);
const rollbackBody = stripSql(rollbackSql);
const verifyBody = stripSql(verifySql);

assert.equal(IMPORT_ENABLED, false);
assert.equal(PERSIST_REST_SECONDS, false);
assert.equal(SUBTITLE_REQUIRED, false);

for (const sql of [activationSql, rollbackSql, verifySql]) {
  assert.equal(sql.includes('workout_sessions'), false);
  assert.equal(sql.includes('workout_sets'), false);
  assert.equal(sql.includes('copy_starter'), false);
  assert.equal(sql.includes('ensureOwnProgram'), false);
}
for (const sql of [activationBody, rollbackBody, verifyBody]) {
  assert.equal(sql.includes('save_imported_program'), false);
}

assert.match(activationBody, /SECURITY INVOKER/);
assert.equal(/security definer/i.test(activationBody), false);
assert.match(activationBody, /SET search_path = ''/);
assert.match(activationBody, /pg_catalog\.pg_advisory_xact_lock/);
assert.match(activationBody, /programs_one_active_per_user_uidx/);
assert.match(activationBody, /active_program_exists/);
assert.match(activationBody, /active_program_count/);
assert.match(activationBody, /program_not_found/);
assert.match(activationBody, /FOR UPDATE/);
assert.match(activationBody, /VALUES \(uid, program_name, NULL, make_current\)/);
assert.equal(/\bdelete\s+from\b/i.test(activationBody), false);
assert.equal(/update\s+public\.program_days\b/i.test(activationBody), false);
assert.equal(/update\s+public\.program_exercises\b/i.test(activationBody), false);
assert.match(rollbackBody, /DROP FUNCTION IF EXISTS public\.activate_owned_program\(bigint\)/);
assert.match(rollbackBody, /DROP FUNCTION IF EXISTS public\.save_owned_program\(jsonb, boolean\)/);
assert.equal(/\b(insert|update|delete)\b/i.test(rollbackBody), false);
assert.match(verifyBody, /default_transaction_read_only = on/);
assert.match(verifyBody, /post_activation_functions_ok/);
assert.equal(/\b(insert|update|delete|create|alter|drop|grant|revoke)\b/i.test(verifyBody), false);

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const USER_C = '33333333-3333-3333-3333-333333333333';
const USER_D = '44444444-4444-4444-4444-444444444444';

const fixtureSql = `
CREATE SCHEMA IF NOT EXISTS auth;
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

GRANT SELECT, INSERT, UPDATE ON public.programs TO authenticated;
GRANT SELECT, INSERT ON public.program_days TO authenticated;
GRANT SELECT, INSERT ON public.program_exercises TO authenticated;
GRANT SELECT ON public.exercises TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
`;

type PgLike = {
  exec(sql: string): Promise<unknown>;
  query<T extends Record<string, unknown>>(sql: string): Promise<{ rows: T[] }>;
};

async function loadPg(): Promise<{ PGlite: new () => PgLike } | null> {
  try {
    const loaded = (await import('@electric-sql/pglite')) as { PGlite: new () => PgLike };
    return loaded;
  } catch {
    try {
      return require('@electric-sql/pglite') as { PGlite: new () => PgLike };
    } catch {
      return null;
    }
  }
}

function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

async function execSql(db: PgLike, sql: string) {
  try {
    await db.exec(sql);
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function asUser<T extends Record<string, unknown>>(db: PgLike, userId: string | null, sql: string) {
  await db.exec('BEGIN');
  try {
    const claim = userId ?? '';
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${claim}', true)`);
    await db.exec('SET LOCAL ROLE authenticated');
    const result = await db.query<T>(sql);
    await db.exec('COMMIT');
    return result.rows;
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function expectRaise(db: PgLike, userId: string | null, sql: string, pattern: string) {
  let raised = false;
  try {
    await asUser(db, userId, sql);
  } catch (error) {
    raised = true;
    assert.match(error instanceof Error ? error.message : String(error), new RegExp(pattern));
  }
  assert.equal(raised, true, pattern);
}

const routine = {
  name: ' Home Routine ',
  days: [
    {
      name: ' Push ',
      subtitle: '  Upper  ',
      exercises: [
        { exercise_id: 1, target_sets: 3, min_reps: 8, max_reps: 12, notes: '  Pause  ' },
      ],
    },
  ],
};

const restDays = {
  name: 'Two Push',
  days: [
    { name: 'Push', subtitle: '   ', exercises: [] },
    {
      name: 'Push',
      subtitle: null,
      exercises: [
        { exercise_id: 1, target_sets: 4, min_reps: 5, max_reps: 5, notes: '  Tempo  ' },
      ],
    },
  ],
};

function saveCall(body: unknown, makeCurrent: boolean) {
  return `SELECT public.save_owned_program(${quoteLiteral(JSON.stringify(body))}::jsonb, ${makeCurrent ? 'true' : 'false'}) AS id`;
}

async function history(db: PgLike) {
  const sessions = await db.query(`
    SELECT id, user_id::text AS user_id, program_day_id, started_at::text AS started_at, finished_at::text AS finished_at
    FROM public.workout_sessions
    ORDER BY id
  `);
  const sets = await db.query(`
    SELECT id, workout_session_id, exercise_id, reps
    FROM public.workout_sets
    ORDER BY id
  `);
  return { sessions: sessions.rows, sets: sets.rows };
}

async function programShape(db: PgLike) {
  const programs = await db.query(`
    SELECT id, user_id::text AS user_id, name, slug, is_active, updated_at::text AS updated_at
    FROM public.programs
    ORDER BY id
  `);
  const days = await db.query(`
    SELECT id, program_id, name, subtitle, day_order
    FROM public.program_days
    ORDER BY id
  `);
  const exercises = await db.query(`
    SELECT id, program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps, notes
    FROM public.program_exercises
    ORDER BY id
  `);
  return { programs: programs.rows, days: days.rows, exercises: exercises.rows };
}

async function seed(db: PgLike) {
  await db.exec(fixtureSql);
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}'), ('${USER_C}'), ('${USER_D}');
    INSERT INTO public.exercises (name) VALUES ('Bench Press');
    INSERT INTO public.programs (user_id, name, slug, is_active, updated_at)
    VALUES
      ('${USER_A}', 'Current', NULL, true, timestamptz '2026-02-01T00:00:00Z'),
      ('${USER_B}', 'Other current', NULL, true, timestamptz '2026-02-01T00:00:00Z');
    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (1, 'Current day', 'Keep', 1), (2, 'Other day', NULL, 1);
    INSERT INTO public.program_exercises (
      program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps, notes
    )
    VALUES (1, 1, 1, 3, 8, 10, 'original'), (2, 1, 1, 2, 6, 8, 'other');
    INSERT INTO public.workout_sessions (user_id, program_day_id, started_at, finished_at)
    SELECT '${USER_A}', 1, timestamptz '2026-01-01T00:00:00Z' + (n || ' days')::interval,
           timestamptz '2026-01-01T01:00:00Z' + (n || ' days')::interval
    FROM generate_series(1, 30) AS n;
    INSERT INTO public.workout_sessions (user_id, program_day_id, started_at, finished_at)
    VALUES ('${USER_A}', 1, timestamptz '2026-03-01T00:00:00Z', NULL);
    INSERT INTO public.workout_sets (workout_session_id, exercise_id, reps)
    SELECT id, 1, 8 FROM public.workout_sessions ORDER BY id;
  `);
}

async function runBehavior(PGlite: new () => PgLike) {
  const db = new PGlite();
  await seed(db);
  await execSql(db, activationSql);
  const beforeHistory = await history(db);
  const beforeShape = await programShape(db);
  assert.equal(beforeHistory.sessions.length, 31);
  assert.equal(beforeHistory.sets.length, 31);
  assert.equal(beforeHistory.sessions.filter((row) => row.finished_at == null).length, 1);

  const saved = await asUser<{ id: string | number }>(db, USER_A, saveCall(routine, false));
  const savedId = Number(saved[0]?.id);
  assert.equal(savedId > 2, true);
  let shape = await programShape(db);
  assert.equal(shape.programs.find((row) => row.id === 1)?.is_active, true);
  assert.equal(shape.programs.find((row) => row.id === savedId)?.is_active, false);
  assert.equal(shape.programs.find((row) => row.id === savedId)?.name, 'Home Routine');
  assert.equal(shape.programs.find((row) => row.id === savedId)?.slug, null);
  assert.equal(shape.days.filter((row) => row.program_id === savedId).length, 1);
  assert.equal(shape.exercises.filter((row) => row.notes === 'Pause').length, 1);
  assert.deepEqual(await history(db), beforeHistory);
  assert.deepEqual(
    shape.days.filter((row) => row.program_id === 1),
    beforeShape.days.filter((row) => row.program_id === 1),
  );
  assert.deepEqual(
    shape.exercises.filter((row) => row.program_day_id === 1),
    beforeShape.exercises.filter((row) => row.program_day_id === 1),
  );

  const programsBeforeReject = (await programShape(db)).programs.length;
  await expectRaise(db, USER_A, saveCall(routine, true), 'active_program_exists');
  assert.equal((await programShape(db)).programs.length, programsBeforeReject);
  assert.deepEqual(await history(db), beforeHistory);

  const activated = await asUser<{ id: string | number }>(
    db,
    USER_A,
    `SELECT public.activate_owned_program(${savedId}) AS id`,
  );
  assert.equal(Number(activated[0]?.id), savedId);
  shape = await programShape(db);
  const activeRows = shape.programs.filter((row) => row.user_id === USER_A && row.is_active === true);
  assert.equal(activeRows.length, 1);
  assert.equal(activeRows[0]?.id, savedId);
  assert.equal(shape.programs.find((row) => row.id === 1)?.is_active, false);
  assert.equal(shape.programs.find((row) => row.id === 2)?.is_active, true);
  assert.equal(shape.programs.find((row) => row.id === 1)?.name, 'Current');
  assert.deepEqual(await history(db), beforeHistory);
  assert.equal(
    (await history(db)).sessions.find((row) => row.finished_at == null)?.program_day_id,
    1,
  );
  const switchedAt = shape.programs.find((row) => row.id === savedId)?.updated_at;
  const previousAt = shape.programs.find((row) => row.id === 1)?.updated_at;

  const again = await asUser<{ id: string | number }>(
    db,
    USER_A,
    `SELECT public.activate_owned_program(${savedId}) AS id`,
  );
  assert.equal(Number(again[0]?.id), savedId);
  shape = await programShape(db);
  assert.equal(shape.programs.find((row) => row.id === savedId)?.updated_at, switchedAt);
  assert.equal(shape.programs.find((row) => row.id === 1)?.updated_at, previousAt);
  assert.equal(shape.programs.filter((row) => row.user_id === USER_A && row.is_active === true).length, 1);
  assert.deepEqual(await history(db), beforeHistory);

  await expectRaise(db, USER_B, `SELECT public.activate_owned_program(1) AS id`, 'program_not_found');
  await expectRaise(db, USER_A, `SELECT public.activate_owned_program(NULL) AS id`, 'program_not_found');
  shape = await programShape(db);
  assert.equal(shape.programs.find((row) => row.id === 2)?.is_active, true);
  assert.equal(shape.programs.filter((row) => row.user_id === USER_A && row.is_active === true).length, 1);
  assert.deepEqual(await history(db), beforeHistory);

  const first = await asUser<{ id: string | number }>(db, USER_C, saveCall(routine, true));
  const firstId = Number(first[0]?.id);
  shape = await programShape(db);
  assert.equal(shape.programs.filter((row) => row.user_id === USER_C).length, 1);
  assert.equal(shape.programs.find((row) => row.id === firstId)?.is_active, true);
  assert.deepEqual(await history(db), beforeHistory);

  const parked = await asUser<{ id: string | number }>(db, USER_D, saveCall(routine, false));
  const parkedId = Number(parked[0]?.id);
  shape = await programShape(db);
  assert.equal(shape.programs.filter((row) => row.user_id === USER_D && row.is_active === true).length, 0);
  assert.equal(shape.programs.find((row) => row.id === parkedId)?.is_active, false);
  const chosen = await asUser<{ id: string | number }>(
    db,
    USER_D,
    `SELECT public.activate_owned_program(${parkedId}) AS id`,
  );
  assert.equal(Number(chosen[0]?.id), parkedId);
  shape = await programShape(db);
  assert.deepEqual(
    shape.programs.filter((row) => row.user_id === USER_D && row.is_active === true).map((row) => row.id),
    [parkedId],
  );
  assert.deepEqual(await history(db), beforeHistory);

  const duplicate = {
    name: 'Duplicate',
    days: [
      {
        name: 'Push',
        subtitle: null,
        exercises: [
          { exercise_id: 1, target_sets: 3, min_reps: 8, max_reps: 8, notes: null },
          { exercise_id: 1, target_sets: 3, min_reps: 8, max_reps: 8, notes: null },
        ],
      },
    ],
  };
  const beforeInvalid = await programShape(db);
  await expectRaise(db, USER_A, saveCall(duplicate, false), 'invalid_import: duplicate_exercise');
  await expectRaise(
    db,
    USER_A,
    saveCall({ name: 'Missing', days: [{ name: 'Push', subtitle: null, exercises: [{ exercise_id: 99, target_sets: 3, min_reps: 8, max_reps: 8, notes: null }] }] }, false),
    'invalid_import: unknown_exercise',
  );
  await expectRaise(db, USER_A, saveCall({ name: '   ', days: routine.days }, false), 'invalid_import: program_name');
  await expectRaise(db, null, saveCall(routine, false), 'Not authenticated');
  assert.deepEqual(await programShape(db), beforeInvalid);
  assert.deepEqual(await history(db), beforeHistory);

  const varied = await asUser<{ id: string | number }>(db, USER_A, saveCall(restDays, false));
  const variedId = Number(varied[0]?.id);
  shape = await programShape(db);
  const variedDays = shape.days.filter((row) => row.program_id === variedId);
  assert.deepEqual(
    variedDays.map((row) => row.name),
    ['Push', 'Push'],
  );
  assert.equal(variedDays[0]?.subtitle, null);
  assert.equal(shape.exercises.filter((row) => row.program_day_id === variedDays[0]?.id).length, 0);
  assert.equal(
    shape.exercises.find((row) => row.program_day_id === variedDays[1]?.id)?.notes,
    'Tempo',
  );
  assert.equal(shape.programs.find((row) => row.id === variedId)?.is_active, false);
  assert.equal(shape.programs.filter((row) => row.user_id === USER_A && row.is_active === true).length, 1);
  assert.deepEqual(await history(db), beforeHistory);

  const privileges = await db.query<{
    save_authenticated: boolean;
    activate_authenticated: boolean;
    save_anon: boolean;
    activate_anon: boolean;
    save_public: boolean;
    security_definer: boolean;
  }>(`
    SELECT
      has_function_privilege('authenticated', 'public.save_owned_program(jsonb, boolean)', 'EXECUTE') AS save_authenticated,
      has_function_privilege('authenticated', 'public.activate_owned_program(bigint)', 'EXECUTE') AS activate_authenticated,
      has_function_privilege('anon', 'public.save_owned_program(jsonb, boolean)', 'EXECUTE') AS save_anon,
      has_function_privilege('anon', 'public.activate_owned_program(bigint)', 'EXECUTE') AS activate_anon,
      has_function_privilege('public', 'public.save_owned_program(jsonb, boolean)', 'EXECUTE') AS save_public,
      (
        SELECT bool_or(prosecdef)
        FROM pg_proc
        WHERE oid IN (
          to_regprocedure('public.save_owned_program(jsonb, boolean)'),
          to_regprocedure('public.activate_owned_program(bigint)')
        )
      ) AS security_definer
  `);
  assert.equal(privileges.rows[0]?.save_authenticated, true);
  assert.equal(privileges.rows[0]?.activate_authenticated, true);
  assert.equal(privileges.rows[0]?.save_anon, false);
  assert.equal(privileges.rows[0]?.activate_anon, false);
  assert.equal(privileges.rows[0]?.save_public, false);
  assert.equal(privileges.rows[0]?.security_definer, false);
  assert.equal(
    (await db.query<{ present: string | null }>(
      `SELECT to_regprocedure('public.save_imported_program(jsonb)')::text AS present`,
    )).rows[0]?.present ?? null,
    null,
  );

  await execSql(db, verifySql);
  const verified = await db.query<{ post_activation_functions_ok: boolean }>(`
    WITH owned_save AS (
      SELECT proc.prosecdef, proc.proconfig, proc.prosrc
      FROM pg_proc proc
      WHERE proc.oid = to_regprocedure('public.save_owned_program(jsonb, boolean)')
    ),
    owned_activate AS (
      SELECT proc.prosecdef, proc.proconfig, proc.prosrc
      FROM pg_proc proc
      WHERE proc.oid = to_regprocedure('public.activate_owned_program(bigint)')
    )
    SELECT
      (
        to_regprocedure('public.save_owned_program(jsonb, boolean)') IS NOT NULL
        AND to_regprocedure('public.activate_owned_program(bigint)') IS NOT NULL
        AND (SELECT prosecdef FROM owned_save) IS FALSE
        AND (SELECT prosecdef FROM owned_activate) IS FALSE
        AND EXISTS (
          SELECT 1
          FROM owned_save
          CROSS JOIN LATERAL unnest(COALESCE(proconfig, ARRAY[]::text[])) AS cfg
          WHERE replace(cfg, ' ', '') IN ('search_path=', 'search_path=""')
        )
        AND EXISTS (
          SELECT 1
          FROM owned_activate
          CROSS JOIN LATERAL unnest(COALESCE(proconfig, ARRAY[]::text[])) AS cfg
          WHERE replace(cfg, ' ', '') IN ('search_path=', 'search_path=""')
        )
      ) AS post_activation_functions_ok
  `);
  assert.equal(verified.rows[0]?.post_activation_functions_ok, true);

  const preservedHistory = await history(db);
  const preservedPrograms = await programShape(db);
  await execSql(db, rollbackSql);
  assert.equal(
    (await db.query<{ present: string | null }>(
      `SELECT to_regprocedure('public.activate_owned_program(bigint)')::text AS present`,
    )).rows[0]?.present ?? null,
    null,
  );
  assert.deepEqual(await history(db), preservedHistory);
  assert.deepEqual(await programShape(db), preservedPrograms);
  await execSql(db, activationSql);
  assert.notEqual(
    (await db.query<{ present: string | null }>(
      `SELECT to_regprocedure('public.save_owned_program(jsonb, boolean)')::text AS present`,
    )).rows[0]?.present ?? null,
    null,
  );
  assert.deepEqual(await history(db), preservedHistory);
}

const pg = await loadPg();
if (process.env.RUN_IMPORT_DB === '1') {
  if (!pg) {
    throw new Error('RUN_IMPORT_DB=1 requires @electric-sql/pglite');
  }
  await runBehavior(pg.PGlite);
  console.log('program activation database checks passed');
} else if (pg) {
  await runBehavior(pg.PGlite);
  console.log('program activation database checks passed');
} else {
  console.log('program activation database checks skipped');
}

console.log('program activation checks passed');
