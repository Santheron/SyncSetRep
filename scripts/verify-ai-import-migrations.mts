import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { IMPORT_ENABLED, PERSIST_REST_SECONDS, SUBTITLE_REQUIRED } from '../lib/import/flags.ts';
import { TEXT_FIELD_MAX } from '../lib/import/limits.ts';

const require = createRequire(import.meta.url);

const sqlPath = (name: string) => new URL(`../sql/${name}`, import.meta.url);

function readSql(name: string) {
  return readFileSync(sqlPath(name), 'utf8');
}

function stripSql(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

const files = {
  preflight: readSql('ai-import-day-order-preflight.sql'),
  dayOrder: readSql('ai-import-day-order.sql'),
  dayOrderRollback: readSql('ai-import-day-order-rollback.sql'),
  quota: readSql('ai-import-quota.sql'),
  quotaRollback: readSql('ai-import-quota-rollback.sql'),
  save: readSql('ai-import-save-program.sql'),
  saveRollback: readSql('ai-import-save-program-rollback.sql'),
};

assert.equal(IMPORT_ENABLED, false);
assert.equal(PERSIST_REST_SECONDS, false);
assert.equal(SUBTITLE_REQUIRED, false);

for (const sql of Object.values(files)) {
  const stripped = stripSql(sql);
  assert.equal(/\b(grant|revoke)\b[^;]*\bexercises\b/i.test(stripped), false);
  assert.equal(/\bworkout_sessions\b/i.test(stripped), false);
  assert.equal(/\bworkout_sets\b/i.test(stripped), false);
  assert.equal(/\brest_seconds\b/i.test(stripped), false);
  assert.equal(/\bexercise_aliases\b/i.test(stripped), false);
}

assert.equal(/^\s*select\b/i.test(stripSql(files.preflight).trim()), true);
assert.equal(/\b(insert|update|delete|create|alter|drop|grant|revoke)\b/i.test(stripSql(files.preflight)), false);
assert.match(files.preflight, /GROUP BY program_id, day_order/);

const dayOrderSql = stripSql(files.dayOrder);
assert.match(dayOrderSql, /UNIQUE NULLS NOT DISTINCT \(program_id, day_order\)/);
assert.match(dayOrderSql, /program_days_day_order_key/);
assert.match(dayOrderSql, /indnullsnotdistinct/);
assert.match(dayOrderSql, /program_day_order_schema/);
assert.match(dayOrderSql, /program_day_order_duplicates/);
assert.equal(/\bdrop\s+index\b/i.test(dayOrderSql), false);
assert.equal(/\b(insert|update|delete)\b/i.test(dayOrderSql), false);

const dayOrderRollbackSql = stripSql(files.dayOrderRollback);
assert.match(dayOrderRollbackSql, /day_order_rollback_blocked/);
assert.match(dayOrderRollbackSql, /day_order_rollback_schema/);
assert.match(dayOrderRollbackSql, /DROP CONSTRAINT program_days_program_id_day_order_key/);
assert.match(dayOrderRollbackSql, /UNIQUE \(day_order\)/);
assert.equal(/\b(insert|update|delete)\b/i.test(dayOrderRollbackSql), false);

const saveSql = stripSql(files.save);
assert.match(saveSql, /SECURITY INVOKER/);
assert.match(saveSql, /SET search_path = ''/);
assert.equal(/SET search_path = public/.test(saveSql), false);
assert.match(saveSql, /SET LOCAL lock_timeout = '5s'/);
assert.match(saveSql, /SET LOCAL statement_timeout = '30s'/);
assert.match(saveSql, /auth\.uid\(\)/);
assert.match(saveSql, /pg_catalog\.btrim/);
assert.match(saveSql, /pg_catalog\.char_length/);
assert.match(saveSql, /\bNULLIF\(/);
assert.match(saveSql, /pg_catalog\.ltrim/);
assert.match(saveSql, /pg_catalog\.array_append/);
assert.match(saveSql, /pg_catalog\.jsonb_typeof/);
assert.match(saveSql, /pg_catalog\.jsonb_object_keys/);
assert.match(saveSql, /pg_catalog\.jsonb_array_length/);
assert.match(saveSql, /pg_catalog\.jsonb_array_elements/);
assert.match(saveSql, /pg_catalog\.jsonb_build_object/);
assert.match(saveSql, /pg_catalog\.jsonb_build_array/);
assert.match(saveSql, /is_active/);
assert.match(saveSql, /FOR UPDATE/);
assert.match(saveSql, /invalid_import: inverted_reps/);
assert.match(saveSql, /active_program_required/);
assert.match(saveSql, /VALUES \(uid, program_name, NULL, false\)/);
assert.match(saveSql, new RegExp(`pg_catalog\\.char_length\\(day_subtitle\\) > ${TEXT_FIELD_MAX}`));
assert.match(saveSql, /9223372036854775807/);
assert.equal(/\bsecurity definer\b/i.test(saveSql), false);
assert.equal(/\bupdate\s+(public|only)\b/i.test(saveSql), false);
assert.equal(/\bdelete\s+from\b/i.test(saveSql), false);
assert.equal(/\bcopy_starter_program\b/i.test(saveSql), false);
assert.equal(stripSql(files.saveRollback).includes('DROP FUNCTION IF EXISTS public.save_imported_program(jsonb)'), true);
const SAVE_PROGRAM_BODY_MD5 = 'ab614932badcedfc0c71eb1ee6d00087';
const SAVE_PROGRAM_DEFINITION_MD5 = '6275a18bdc001065d7ad77c0c4d52fbb';
const saveVerifySql = stripSql(readSql('ai-import-save-program-verify.sql'));
assert.match(saveVerifySql, /default_transaction_read_only/);
assert.match(saveVerifySql, new RegExp(SAVE_PROGRAM_BODY_MD5));
assert.match(saveVerifySql, new RegExp(SAVE_PROGRAM_DEFINITION_MD5));
assert.match(saveVerifySql, /search_path=""/);
assert.equal(/\binsert\s+into\b/i.test(saveVerifySql), false);
assert.equal(/\bupdate\s+(public|only)\b/i.test(saveVerifySql), false);
assert.equal(/\bdelete\s+from\b/i.test(saveVerifySql), false);
assert.equal(/\b(create|alter|drop|grant|revoke)\b/i.test(saveVerifySql), false);
assert.equal(/select\s+public\.save_imported_program\s*\(/i.test(saveVerifySql), false);

const quotaSql = stripSql(files.quota);
assert.match(quotaSql, /SECURITY DEFINER/);
assert.match(quotaSql, /SET search_path = ''/);
assert.equal(/SET search_path = public/.test(quotaSql), false);
assert.match(quotaSql, /pg_catalog\.pg_advisory_xact_lock/);
assert.match(quotaSql, /pg_catalog\.hashtextextended/);
assert.match(quotaSql, /pg_catalog\.now\(\)/);
assert.match(quotaSql, /auth\.uid\(\)/);
assert.match(quotaSql, /SET LOCAL lock_timeout = '5s'/);
assert.match(quotaSql, /SET LOCAL statement_timeout = '30s'/);
assert.match(quotaSql, /REVOKE ALL ON TABLE public\.ai_import_attempts FROM PUBLIC, anon, authenticated/);
assert.match(quotaSql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public\.ai_import_attempts FROM authenticated/);
assert.match(quotaSql, /GRANT SELECT ON TABLE public\.ai_import_attempts TO authenticated/);
assert.match(quotaSql, /REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated/);
assert.match(quotaSql, /REVOKE ALL ON FUNCTION public\.consume_ai_import_quota\(text\) FROM PUBLIC, anon/);
assert.equal(/\bupdate\s+(public|only)\b/i.test(quotaSql), false);
assert.equal(/\bdelete\s+from\b/i.test(quotaSql), false);
assert.match(stripSql(files.quotaRollback), /DROP TABLE IF EXISTS public\.ai_import_attempts/);

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

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
GRANT USAGE ON SCHEMA auth, public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE public.programs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id),
  name text NOT NULL,
  slug text,
  is_active boolean NOT NULL DEFAULT true
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
  CONSTRAINT program_days_day_order_key UNIQUE (day_order)
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
CREATE POLICY program_days_insert_own ON public.program_days
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.programs
      WHERE programs.id = program_id AND programs.user_id = auth.uid()
    )
  );
CREATE POLICY program_days_select_own ON public.program_days
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.programs
      WHERE programs.id = program_id AND programs.user_id = auth.uid()
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

GRANT SELECT, INSERT, UPDATE, DELETE ON public.programs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_days TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.program_exercises TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exercises TO authenticated;
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

async function execFile(db: PgLike, name: string) {
  try {
    await db.exec(readSql(name));
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function asUser<T extends Record<string, unknown>>(db: PgLike, userId: string, sql: string) {
  await db.exec('BEGIN');
  try {
    await db.exec(`SELECT set_config('request.jwt.claim.sub', '${userId}', true)`);
    await db.exec('SET LOCAL ROLE authenticated');
    const result = await db.query<T>(sql);
    await db.exec('COMMIT');
    return result.rows;
  } catch (error) {
    await db.exec('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function expectRaise(db: PgLike, userId: string, sql: string, pattern: string) {
  let raised = false;
  try {
    await asUser(db, userId, sql);
  } catch (error) {
    raised = true;
    assert.match(error instanceof Error ? error.message : String(error), new RegExp(pattern));
  }
  assert.equal(raised, true);
}

function payload(body: string) {
  return `SELECT public.save_imported_program(${quoteLiteral(body)}::jsonb) AS id`;
}

function quoteLiteral(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

const importedProgram = JSON.stringify({
  name: ' Imported ',
  days: [
    {
      name: ' Day 1 ',
      subtitle: ' Push ',
      exercises: [
        { exercise_id: 1, target_sets: 3, min_reps: 8, max_reps: 12, notes: ' Pause ' },
      ],
    },
  ],
});

async function seedBase(db: PgLike) {
  await db.exec(fixtureSql);
  await db.exec(`
    INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
    INSERT INTO public.exercises (name) VALUES ('Dumbbell Bench Press');
    INSERT INTO public.programs (user_id, name, slug, is_active)
    VALUES ('${USER_A}', 'Current', NULL, true);
    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (1, 'Current day', NULL, 1);
    INSERT INTO public.workout_sessions (user_id, finished_at)
    SELECT '${USER_A}', timestamptz '2026-01-01T00:00:00Z' + (n || ' days')::interval
    FROM generate_series(1, 30) AS n;
    INSERT INTO public.workout_sets (workout_session_id, exercise_id, reps)
    SELECT id, 1, 8 FROM public.workout_sessions ORDER BY id;
  `);
}

function schemaWith(constraintSql: string) {
  return fixtureSql.replace(
    'CONSTRAINT program_days_day_order_key UNIQUE (day_order)',
    constraintSql,
  );
}

async function preservedRows(db: PgLike) {
  const active = await db.query<{
    id: number;
    user_id: string;
    name: string;
    slug: string | null;
    is_active: boolean;
  }>(`
    SELECT id, user_id::text AS user_id, name, slug, is_active
    FROM public.programs
    WHERE id = 1
  `);
  const originalDay = await db.query<{
    id: number;
    program_id: number;
    name: string;
    subtitle: string | null;
    day_order: number;
  }>(`
    SELECT id, program_id, name, subtitle, day_order
    FROM public.program_days
    WHERE id = 1
  `);
  const sessions = await db.query<{ id: number; user_id: string; finished_at: string }>(`
    SELECT id, user_id::text AS user_id, finished_at::text AS finished_at
    FROM public.workout_sessions
    ORDER BY id
  `);
  const sets = await db.query<{
    id: number;
    workout_session_id: number;
    exercise_id: number;
    reps: number;
  }>(`
    SELECT id, workout_session_id, exercise_id, reps
    FROM public.workout_sets
    ORDER BY id
  `);
  return {
    active: active.rows,
    originalDay: originalDay.rows,
    sessions: sessions.rows,
    sets: sets.rows,
  };
}

function assertHistoryUntouched(
  current: Awaited<ReturnType<typeof preservedRows>>,
  expected: Awaited<ReturnType<typeof preservedRows>>,
) {
  assert.equal(current.sessions.length, 30);
  assert.equal(current.sets.length, 30);
  assert.equal(current.sessions.every((row) => row.finished_at.length > 0), true);
  assert.equal(current.active[0]?.is_active, true);
  assert.equal(current.active[0]?.name, 'Current');
  assert.equal(current.originalDay[0]?.day_order, 1);
  assert.deepEqual(current, expected);
}

async function pairConstraint(db: PgLike) {
  const rows = await db.query<{ nulls_not_distinct: boolean; columns: string }>(`
    SELECT
      ix.indnullsnotdistinct AS nulls_not_distinct,
      (
        SELECT array_to_string(array_agg(att.attname ORDER BY key.ord), ',')
        FROM unnest(ix.indkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute att
          ON att.attrelid = ix.indrelid
         AND att.attnum = key.attnum
        WHERE key.ord <= ix.indnkeyatts
          AND key.attnum > 0
      ) AS columns
    FROM pg_constraint con
    JOIN pg_index ix ON ix.indexrelid = con.conindid
    WHERE con.conname = 'program_days_program_id_day_order_key'
  `);
  return rows.rows[0];
}

async function expectFileRaise(db: PgLike, name: string, pattern: string) {
  let raised = false;
  try {
    await execFile(db, name);
  } catch (error) {
    raised = true;
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, new RegExp(pattern));
    assert.equal(/out of range/i.test(message), false);
  }
  assert.equal(raised, true);
}

async function runBehavior(PGlite: new () => PgLike) {
  const db = new PGlite();
  await seedBase(db);
  const beforeDays = await db.query<{
    id: number;
    program_id: number;
    name: string;
    subtitle: string | null;
    day_order: number;
  }>('SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id');
  const beforeHistory = await db.query<{ sessions: number; sets: number }>(`
    SELECT
      (SELECT count(*)::int FROM public.workout_sessions) AS sessions,
      (SELECT count(*)::int FROM public.workout_sets) AS sets
  `);
  const preserved = await preservedRows(db);
  assert.equal(beforeHistory.rows[0]?.sessions, 30);
  assert.equal(beforeHistory.rows[0]?.sets, 30);
  await execFile(db, 'ai-import-day-order.sql');
  assert.deepEqual(
    (await db.query('SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id')).rows,
    beforeDays.rows,
  );
  assertHistoryUntouched(await preservedRows(db), preserved);
  const replacement = await pairConstraint(db);
  assert.equal(replacement?.nulls_not_distinct, true);
  assert.equal(replacement?.columns, 'program_id,day_order');
  await execFile(db, 'ai-import-day-order.sql');
  assert.deepEqual(
    (await db.query('SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id')).rows,
    beforeDays.rows,
  );
  assertHistoryUntouched(await preservedRows(db), preserved);
  const exerciseInsert = await db.query<{ allowed: boolean }>(
    `SELECT has_table_privilege('authenticated', 'public.exercises', 'INSERT') AS allowed`,
  );
  assert.equal(exerciseInsert.rows[0]?.allowed, true);

  await db.exec(`
    INSERT INTO public.programs (user_id, name, slug, is_active)
    VALUES ('${USER_A}', 'Second', NULL, false);
    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (2, 'Second day', NULL, 1);
  `);
  const sharedDays = await db.query(
    'SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id',
  );
  await execFile(db, 'ai-import-day-order.sql');
  assert.deepEqual(
    (await db.query('SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id')).rows,
    sharedDays.rows,
  );
  assertHistoryUntouched(await preservedRows(db), preserved);
  await db.exec(`
    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (NULL, 'Unowned', NULL, 1);
  `);
  let repeatedNullProgramRejected = false;
  try {
    await db.exec(`
      INSERT INTO public.program_days (program_id, name, subtitle, day_order)
      VALUES (NULL, 'Unowned again', NULL, 1);
    `);
  } catch (error) {
    repeatedNullProgramRejected = true;
    assert.match(
      error instanceof Error ? error.message : String(error),
      /program_days_program_id_day_order_key|duplicate key/,
    );
  }
  assert.equal(repeatedNullProgramRejected, true);
  const preflight = await db.query<{ day_order_preflight: string }>(readSql('ai-import-day-order-preflight.sql'));
  const preflightJson = JSON.parse(preflight.rows[0]?.day_order_preflight ?? '{}') as {
    duplicate_groups: number;
  };
  assert.equal(preflightJson.duplicate_groups, 0);

  const saveTimeoutsBefore = await db.query<{ lock_timeout: string; statement_timeout: string }>(`
    SELECT current_setting('lock_timeout') AS lock_timeout,
           current_setting('statement_timeout') AS statement_timeout
  `);
  await execFile(db, 'ai-import-save-program.sql');
  const saveTimeoutsAfter = await db.query<{ lock_timeout: string; statement_timeout: string }>(`
    SELECT current_setting('lock_timeout') AS lock_timeout,
           current_setting('statement_timeout') AS statement_timeout
  `);
  assert.deepEqual(saveTimeoutsAfter.rows[0], saveTimeoutsBefore.rows[0]);
  const functionFlags = await db.query<{
    security_definer: boolean;
    config: string[] | null;
    identity_arguments: string;
    language_name: string;
    body_md5: string;
    definition_md5: string;
  }>(`
    SELECT
      proc.prosecdef AS security_definer,
      proc.proconfig AS config,
      pg_get_function_identity_arguments(proc.oid) AS identity_arguments,
      lang.lanname AS language_name,
      md5(proc.prosrc) AS body_md5,
      md5(pg_get_functiondef(proc.oid)) AS definition_md5
    FROM pg_proc proc
    JOIN pg_language lang ON lang.oid = proc.prolang
    WHERE proc.proname = 'save_imported_program'
  `);
  assert.equal(functionFlags.rows[0]?.security_definer, false);
  assert.equal(functionFlags.rows[0]?.config?.includes('search_path=public'), false);
  assert.equal(
    functionFlags.rows[0]?.config?.some((entry) => entry.replace(/\s/g, '') === 'search_path=' || entry === 'search_path=""'),
    true,
  );
  assert.equal(functionFlags.rows[0]?.identity_arguments, 'p_program jsonb');
  assert.equal(functionFlags.rows[0]?.language_name, 'plpgsql');
  assert.equal(functionFlags.rows[0]?.body_md5, SAVE_PROGRAM_BODY_MD5);
  assert.equal(functionFlags.rows[0]?.definition_md5, SAVE_PROGRAM_DEFINITION_MD5);

  const saved = await asUser<{ id: number }>(db, USER_A, payload(importedProgram));
  const savedId = Number(saved[0]?.id);
  const programs = await db.query<{ id: number; user_id: string; name: string; is_active: boolean; slug: string | null }>(
    'SELECT id, user_id::text, name, is_active, slug FROM public.programs ORDER BY id',
  );
  assert.equal(programs.rows.filter((row) => row.is_active).length, 1);
  assert.equal(programs.rows[0]?.is_active, true);
  assert.equal(programs.rows[0]?.id, 1);
  const imported = programs.rows.find((row) => row.id === savedId);
  assert.equal(imported?.user_id, USER_A);
  assert.equal(imported?.name, 'Imported');
  assert.equal(imported?.is_active, false);
  assert.equal(imported?.slug, null);
  const dayRows = await db.query<{ program_id: number; name: string; subtitle: string | null; day_order: number }>(`
    SELECT program_id, name, subtitle, day_order
    FROM public.program_days
    WHERE day_order = 1
    ORDER BY program_id
  `);
  assert.equal(dayRows.rows.length >= 2, true);
  assert.equal(dayRows.rows.some((row) => row.program_id === savedId && row.name === 'Day 1' && row.subtitle === 'Push'), true);
  assertHistoryUntouched(await preservedRows(db), preserved);
  assert.deepEqual(
    (await db.query(`
      SELECT
        (SELECT count(*)::int FROM public.workout_sessions) AS sessions,
        (SELECT count(*)::int FROM public.workout_sets) AS sets
    `)).rows,
    beforeHistory.rows,
  );

  const duplicateDays = await asUser<{ id: number }>(db, USER_A, payload(JSON.stringify({
    name: 'Same names',
    days: [
      { name: 'Push', exercises: [] },
      { name: 'Push', exercises: [] },
    ],
  })));
  const duplicateDayId = Number(duplicateDays[0]?.id);
  const duplicateDayRows = await db.query<{ day_order: number; name: string; exercises: number }>(`
    SELECT d.day_order, d.name, count(e.id)::int AS exercises
    FROM public.program_days d
    LEFT JOIN public.program_exercises e ON e.program_day_id = d.id
    WHERE d.program_id = ${duplicateDayId}
    GROUP BY d.id, d.day_order, d.name
    ORDER BY d.day_order
  `);
  assert.deepEqual(duplicateDayRows.rows, [
    { day_order: 1, name: 'Push', exercises: 0 },
    { day_order: 2, name: 'Push', exercises: 0 },
  ]);
  const activeAfterDuplicateDays = await db.query<{ id: number; is_active: boolean }>(`
    SELECT id, is_active FROM public.programs WHERE id = 1
  `);
  assert.deepEqual(activeAfterDuplicateDays.rows, [{ id: 1, is_active: true }]);
  assertHistoryUntouched(await preservedRows(db), preserved);

  const programsBeforeRollback = await db.query<{ programs: number }>(`
    SELECT count(*)::int AS programs FROM public.programs
  `);
  await db.exec('BEGIN');
  await db.exec(`SELECT set_config('request.jwt.claim.sub', '${USER_A}', true)`);
  await db.exec('SET LOCAL ROLE authenticated');
  await db.query(payload(JSON.stringify({
    name: 'Rollback me',
    days: [{ name: 'Day', exercises: [] }],
  })));
  await db.exec('ROLLBACK');
  const programsAfterRollback = await db.query<{ programs: number }>(`
    SELECT count(*)::int AS programs FROM public.programs
  `);
  assert.deepEqual(programsAfterRollback.rows, programsBeforeRollback.rows);
  assertHistoryUntouched(await preservedRows(db), preserved);

  const beforeFailed = await db.query<{ programs: number; days: number }>(`
    SELECT
      (SELECT count(*)::int FROM public.programs) AS programs,
      (SELECT count(*)::int FROM public.program_days) AS days
  `);
  await expectRaise(
    db,
    USER_A,
    payload(JSON.stringify({
      name: 'Broken',
      days: [{
        name: 'Day',
        exercises: [
          { exercise_id: 1, target_sets: 3, min_reps: 8, max_reps: 12, notes: null },
          { exercise_id: 999, target_sets: 3, min_reps: 8, max_reps: 12, notes: null },
        ],
      }],
    })),
    'unknown_exercise',
  );
  await expectRaise(
    db,
    USER_A,
    payload(JSON.stringify({
      name: 'Inverted',
      days: [{
        name: 'Day',
        exercises: [{ exercise_id: 1, target_sets: 3, min_reps: 12, max_reps: 8, notes: null }],
      }],
    })),
    'inverted_reps',
  );
  await expectRaise(db, USER_B, payload(importedProgram), 'active_program_required');
  await expectRaise(
    db,
    USER_A,
    payload(JSON.stringify({ name: 'Owned', user_id: USER_B, days: [] })),
    'program_field',
  );
  const afterFailed = await db.query<{ programs: number; days: number }>(`
    SELECT
      (SELECT count(*)::int FROM public.programs) AS programs,
      (SELECT count(*)::int FROM public.program_days) AS days
  `);
  assert.deepEqual(afterFailed.rows, beforeFailed.rows);
  const ownerRows = await db.query<{ user_id: string }>(
    `SELECT user_id::text FROM public.programs WHERE user_id = '${USER_B}'`,
  );
  assert.equal(ownerRows.rows.length, 0);

  const beforeOverflow = await db.query<{ programs: number; days: number; sets: number }>(`
    SELECT
      (SELECT count(*)::int FROM public.programs) AS programs,
      (SELECT count(*)::int FROM public.program_days) AS days,
      (SELECT count(*)::int FROM public.workout_sets) AS sets
  `);
  const restProgram = JSON.stringify({
    name: 'Rest week',
    days: [
      { name: 'Rest', subtitle: '   ', exercises: [] },
      {
        name: 'Lift',
        subtitle: 'S'.repeat(TEXT_FIELD_MAX),
        exercises: [
          { exercise_id: '1', target_sets: '0003', min_reps: '0008', max_reps: '00012', notes: null },
        ],
      },
    ],
  });
  const restSaved = await asUser<{ id: number }>(db, USER_A, payload(restProgram));
  const restId = Number(restSaved[0]?.id);
  const restDays = await db.query<{ name: string; subtitle: string | null; day_order: number; exercises: number }>(`
    SELECT d.name, d.subtitle, d.day_order, count(e.id)::int AS exercises
    FROM public.program_days d
    LEFT JOIN public.program_exercises e ON e.program_day_id = d.id
    WHERE d.program_id = ${restId}
    GROUP BY d.id, d.name, d.subtitle, d.day_order
    ORDER BY d.day_order
  `);
  assert.deepEqual(restDays.rows, [
    { name: 'Rest', subtitle: null, day_order: 1, exercises: 0 },
    { name: 'Lift', subtitle: 'S'.repeat(TEXT_FIELD_MAX), day_order: 2, exercises: 1 },
  ]);
  const paddedSets = await db.query<{ target_sets: number; min_reps: number; max_reps: number }>(`
    SELECT target_sets, min_reps, max_reps
    FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${restId}
  `);
  assert.deepEqual(paddedSets.rows, [{ target_sets: 3, min_reps: 8, max_reps: 12 }]);

  await expectRaise(
    db,
    USER_A,
    payload(JSON.stringify({
      name: 'Long subtitle',
      days: [{ name: 'Day', subtitle: 'S'.repeat(TEXT_FIELD_MAX + 1), exercises: [] }],
    })),
    'invalid_import: subtitle',
  );
  let setsOverflow = false;
  try {
    await asUser(
      db,
      USER_A,
      payload(
        '{"name":"Huge sets","days":[{"name":"Day","exercises":[{"exercise_id":1,"target_sets":99999999999999999999,"min_reps":8,"max_reps":12}]}]}',
      ),
    );
  } catch (error) {
    setsOverflow = true;
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, /invalid_import: sets/);
    assert.equal(/out of range/i.test(message), false);
  }
  assert.equal(setsOverflow, true);
  let idOverflow = false;
  try {
    await asUser(
      db,
      USER_A,
      payload(JSON.stringify({
        name: 'Huge id',
        days: [{
          name: 'Day',
          exercises: [{
            exercise_id: '9223372036854775808',
            target_sets: 3,
            min_reps: 8,
            max_reps: 12,
          }],
        }],
      })),
    );
  } catch (error) {
    idOverflow = true;
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, /invalid_import: exercise_id/);
    assert.equal(/out of range/i.test(message), false);
  }
  assert.equal(idOverflow, true);
  await expectRaise(
    db,
    USER_A,
    payload(JSON.stringify({
      name: 'Max bigint',
      days: [{
        name: 'Day',
        exercises: [{
          exercise_id: '9223372036854775807',
          target_sets: 3,
          min_reps: 8,
          max_reps: 12,
        }],
      }],
    })),
    'unknown_exercise',
  );
  const afterOverflow = await db.query<{ programs: number; days: number; sets: number }>(`
    SELECT
      (SELECT count(*)::int FROM public.programs) AS programs,
      (SELECT count(*)::int FROM public.program_days) AS days,
      (SELECT count(*)::int FROM public.workout_sets) AS sets
  `);
  assert.equal(afterOverflow.rows[0]?.programs, (beforeOverflow.rows[0]?.programs ?? 0) + 1);
  assert.equal(afterOverflow.rows[0]?.days, (beforeOverflow.rows[0]?.days ?? 0) + 2);
  assert.equal(afterOverflow.rows[0]?.sets, beforeOverflow.rows[0]?.sets);
  assertHistoryUntouched(await preservedRows(db), preserved);

  const daysBeforeRollback = await db.query(
    'SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id',
  );
  await expectFileRaise(db, 'ai-import-day-order-rollback.sql', 'day_order_rollback_blocked');
  await expectFileRaise(db, 'ai-import-day-order-rollback.sql', 'day_order_rollback_blocked');
  assert.deepEqual(
    (await db.query('SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id')).rows,
    daysBeforeRollback.rows,
  );
  const keptPair = await pairConstraint(db);
  assert.equal(keptPair?.nulls_not_distinct, true);
  assert.equal(keptPair?.columns, 'program_id,day_order');
  assertHistoryUntouched(await preservedRows(db), preserved);

  const clean = new PGlite();
  await seedBase(clean);
  const cleanPreserved = await preservedRows(clean);
  const cleanDays = await clean.query(
    'SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id',
  );
  await execFile(clean, 'ai-import-day-order.sql');
  await execFile(clean, 'ai-import-day-order-rollback.sql');
  await execFile(clean, 'ai-import-day-order-rollback.sql');
  const restored = await clean.query<{ name: string }>(`
    SELECT conname AS name
    FROM pg_constraint
    WHERE conrelid = 'public.program_days'::regclass
      AND contype = 'u'
  `);
  assert.equal(restored.rows.some((row) => row.name === 'program_days_day_order_key'), true);
  assert.equal(
    (await clean.query(`SELECT 1 FROM pg_constraint WHERE conname = 'program_days_program_id_day_order_key'`)).rows.length,
    0,
  );
  let globalUniqueHeld = false;
  try {
    await clean.exec(`
      INSERT INTO public.programs (user_id, name, slug, is_active)
      VALUES ('${USER_A}', 'Blocked', NULL, false);
      INSERT INTO public.program_days (program_id, name, subtitle, day_order)
      VALUES (2, 'Blocked day', NULL, 1);
    `);
  } catch (error) {
    globalUniqueHeld = true;
    assert.match(error instanceof Error ? error.message : String(error), /program_days_day_order_key|duplicate key/);
  }
  assert.equal(globalUniqueHeld, true);
  assert.deepEqual(
    (await clean.query('SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id')).rows,
    cleanDays.rows,
  );
  assertHistoryUntouched(await preservedRows(clean), cleanPreserved);

  const wrongName = new PGlite();
  await wrongName.exec(schemaWith('CONSTRAINT program_days_day_order_global UNIQUE (day_order)'));
  await wrongName.exec(`
    INSERT INTO auth.users (id) VALUES ('${USER_A}');
    INSERT INTO public.exercises (name) VALUES ('Dumbbell Bench Press');
    INSERT INTO public.programs (user_id, name, slug, is_active)
    VALUES ('${USER_A}', 'Current', NULL, true);
    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (1, 'Current day', NULL, 1);
  `);
  const wrongDays = await wrongName.query(
    'SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id',
  );
  await expectFileRaise(wrongName, 'ai-import-day-order.sql', 'program_day_order_schema');
  assert.deepEqual(
    (await wrongName.query('SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id')).rows,
    wrongDays.rows,
  );
  assert.equal(
    (await wrongName.query(`SELECT 1 FROM pg_constraint WHERE conname = 'program_days_day_order_global'`)).rows.length,
    1,
  );

  const wrongNulls = new PGlite();
  await wrongNulls.exec(schemaWith('CONSTRAINT program_days_day_order_key UNIQUE NULLS NOT DISTINCT (day_order)'));
  await wrongNulls.exec(`
    INSERT INTO auth.users (id) VALUES ('${USER_A}');
    INSERT INTO public.programs (user_id, name, slug, is_active)
    VALUES ('${USER_A}', 'Current', NULL, true);
    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (1, 'Current day', NULL, 1);
  `);
  await expectFileRaise(wrongNulls, 'ai-import-day-order.sql', 'program_day_order_schema');
  const stillSingle = await wrongNulls.query<{ nulls_not_distinct: boolean }>(`
    SELECT ix.indnullsnotdistinct AS nulls_not_distinct
    FROM pg_constraint con
    JOIN pg_index ix ON ix.indexrelid = con.conindid
    WHERE con.conname = 'program_days_day_order_key'
  `);
  assert.equal(stillSingle.rows[0]?.nulls_not_distinct, true);

  const wrongPair = new PGlite();
  await seedBase(wrongPair);
  await execFile(wrongPair, 'ai-import-day-order.sql');
  await wrongPair.exec(`
    ALTER TABLE public.program_days DROP CONSTRAINT program_days_program_id_day_order_key;
    ALTER TABLE public.program_days
      ADD CONSTRAINT program_days_program_id_day_order_key
      UNIQUE (program_id, day_order);
  `);
  const wrongPairDays = await wrongPair.query(
    'SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id',
  );
  await expectFileRaise(wrongPair, 'ai-import-day-order.sql', 'program_day_order_schema');
  await expectFileRaise(wrongPair, 'ai-import-day-order-rollback.sql', 'day_order_rollback_schema');
  assert.deepEqual(
    (await wrongPair.query('SELECT id, program_id, name, subtitle, day_order FROM public.program_days ORDER BY id')).rows,
    wrongPairDays.rows,
  );
  const wrongPairFlag = await wrongPair.query<{ nulls_not_distinct: boolean }>(`
    SELECT ix.indnullsnotdistinct AS nulls_not_distinct
    FROM pg_constraint con
    JOIN pg_index ix ON ix.indexrelid = con.conindid
    WHERE con.conname = 'program_days_program_id_day_order_key'
  `);
  assert.equal(wrongPairFlag.rows[0]?.nulls_not_distinct, false);

  const quotaDb = new PGlite();
  await quotaDb.exec(fixtureSql);
  await quotaDb.exec(`
    INSERT INTO auth.users (id) VALUES ('${USER_A}'), ('${USER_B}');
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
  `);
  const timeoutsBefore = await quotaDb.query<{ lock_timeout: string; statement_timeout: string }>(`
    SELECT current_setting('lock_timeout') AS lock_timeout,
           current_setting('statement_timeout') AS statement_timeout
  `);
  await execFile(quotaDb, 'ai-import-quota.sql');
  const timeoutsAfter = await quotaDb.query<{ lock_timeout: string; statement_timeout: string }>(`
    SELECT current_setting('lock_timeout') AS lock_timeout,
           current_setting('statement_timeout') AS statement_timeout
  `);
  assert.deepEqual(timeoutsAfter.rows[0], timeoutsBefore.rows[0]);
  const quotaFlags = await quotaDb.query<{ security_definer: boolean; config: string[] | null }>(`
    SELECT prosecdef AS security_definer, proconfig AS config
    FROM pg_proc
    WHERE proname = 'consume_ai_import_quota'
  `);
  assert.equal(quotaFlags.rows[0]?.security_definer, true);
  assert.equal(quotaFlags.rows[0]?.config?.includes('search_path=public'), false);
  assert.equal(
    quotaFlags.rows[0]?.config?.some((entry) => entry.replace(/\s/g, '') === 'search_path=' || entry === 'search_path=""'),
    true,
  );
  const quotaPrivileges = await quotaDb.query<{
    authenticated_select: boolean;
    authenticated_insert: boolean;
    authenticated_update: boolean;
    authenticated_delete: boolean;
    authenticated_truncate: boolean;
    anon_insert: boolean;
    public_insert: boolean;
    authenticated_sequence_usage: boolean;
    authenticated_sequence_select: boolean;
    authenticated_sequence_update: boolean;
    anon_sequence_usage: boolean;
    public_sequence_usage: boolean;
  }>(`
    SELECT
      has_table_privilege('authenticated', 'public.ai_import_attempts', 'SELECT') AS authenticated_select,
      has_table_privilege('authenticated', 'public.ai_import_attempts', 'INSERT') AS authenticated_insert,
      has_table_privilege('authenticated', 'public.ai_import_attempts', 'UPDATE') AS authenticated_update,
      has_table_privilege('authenticated', 'public.ai_import_attempts', 'DELETE') AS authenticated_delete,
      has_table_privilege('authenticated', 'public.ai_import_attempts', 'TRUNCATE') AS authenticated_truncate,
      has_table_privilege('anon', 'public.ai_import_attempts', 'INSERT') AS anon_insert,
      has_table_privilege('public', 'public.ai_import_attempts', 'INSERT') AS public_insert,
      has_sequence_privilege('authenticated', pg_get_serial_sequence('public.ai_import_attempts', 'id')::regclass, 'USAGE') AS authenticated_sequence_usage,
      has_sequence_privilege('authenticated', pg_get_serial_sequence('public.ai_import_attempts', 'id')::regclass, 'SELECT') AS authenticated_sequence_select,
      has_sequence_privilege('authenticated', pg_get_serial_sequence('public.ai_import_attempts', 'id')::regclass, 'UPDATE') AS authenticated_sequence_update,
      has_sequence_privilege('anon', pg_get_serial_sequence('public.ai_import_attempts', 'id')::regclass, 'USAGE') AS anon_sequence_usage,
      has_sequence_privilege('public', pg_get_serial_sequence('public.ai_import_attempts', 'id')::regclass, 'USAGE') AS public_sequence_usage
  `);
  const privileges = quotaPrivileges.rows[0];
  assert.equal(privileges?.authenticated_select, true);
  assert.equal(privileges?.authenticated_insert, false);
  assert.equal(privileges?.authenticated_update, false);
  assert.equal(privileges?.authenticated_delete, false);
  assert.equal(privileges?.authenticated_truncate, false);
  assert.equal(privileges?.anon_insert, false);
  assert.equal(privileges?.public_insert, false);
  assert.equal(privileges?.authenticated_sequence_usage, false);
  assert.equal(privileges?.authenticated_sequence_select, false);
  assert.equal(privileges?.authenticated_sequence_update, false);
  assert.equal(privileges?.anon_sequence_usage, false);
  assert.equal(privileges?.public_sequence_usage, false);
  await expectRaise(
    quotaDb,
    USER_A,
    `INSERT INTO public.ai_import_attempts (user_id, kind) VALUES ('${USER_A}', 'model')`,
    'permission denied',
  );
  await expectRaise(
    quotaDb,
    USER_A,
    `SELECT nextval(pg_get_serial_sequence('public.ai_import_attempts', 'id'))`,
    'permission denied',
  );
  await asUser(quotaDb, USER_A, `SELECT public.consume_ai_import_quota('model')`);
  await asUser(quotaDb, USER_A, `SELECT public.consume_ai_import_quota('model')`);
  await expectRaise(
    quotaDb,
    USER_A,
    `SELECT public.consume_ai_import_quota('model')`,
    'rate_limited_burst',
  );
  const attempts = await quotaDb.query<{ rows: number }>(
    `SELECT count(*)::int AS rows FROM public.ai_import_attempts WHERE user_id = '${USER_A}'`,
  );
  assert.equal(attempts.rows[0]?.rows, 2);
  await asUser(quotaDb, USER_B, `SELECT public.consume_ai_import_quota('model')`);
  const separated = await quotaDb.query<{ user_id: string; rows: number }>(`
    SELECT user_id::text, count(*)::int AS rows
    FROM public.ai_import_attempts
    WHERE kind = 'model'
    GROUP BY user_id
    ORDER BY user_id
  `);
  assert.deepEqual(separated.rows, [
    { user_id: USER_A, rows: 2 },
    { user_id: USER_B, rows: 1 },
  ]);
  await quotaDb.exec('BEGIN');
  await quotaDb.exec(`SELECT set_config('request.jwt.claim.sub', '${USER_B}', true)`);
  await quotaDb.exec('SET LOCAL ROLE authenticated');
  await quotaDb.exec(`SELECT public.consume_ai_import_quota('pdf')`);
  await quotaDb.exec('ROLLBACK');
  const rolledBack = await quotaDb.query<{ rows: number }>(`
    SELECT count(*)::int AS rows
    FROM public.ai_import_attempts
    WHERE user_id = '${USER_B}' AND kind = 'pdf'
  `);
  assert.equal(rolledBack.rows[0]?.rows, 0);
  await expectRaise(
    quotaDb,
    USER_A,
    `SELECT public.consume_ai_import_quota('PDF')`,
    'quota_unavailable',
  );
  const afterRejected = await quotaDb.query<{ rows: number }>(
    `SELECT count(*)::int AS rows FROM public.ai_import_attempts`,
  );
  assert.equal(afterRejected.rows[0]?.rows, 3);
  await execFile(quotaDb, 'ai-import-quota-rollback.sql');
  const quotaGone = await quotaDb.query<{ attempts_table: string | null }>(`
    SELECT to_regclass('public.ai_import_attempts')::text AS attempts_table
  `);
  assert.equal(quotaGone.rows[0]?.attempts_table ?? null, null);
}

const pg = await loadPg();
if (process.env.RUN_IMPORT_DB === '1') {
  if (!pg) {
    throw new Error('RUN_IMPORT_DB=1 requires @electric-sql/pglite');
  }
  await runBehavior(pg.PGlite);
  console.log('ai import database behavior checks passed');
} else if (pg) {
  await runBehavior(pg.PGlite);
  console.log('ai import database behavior checks passed');
} else {
  console.log('ai import database behavior checks skipped');
}

console.log('ai import migration checks passed');

if (process.env.RUN_QUOTA_CONCURRENCY === '1') {
  const script = fileURLToPath(new URL('./verify-ai-import-quota-concurrency.mts', import.meta.url));
  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', script], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (status) => resolve(status ?? 1));
  });
  if (code !== 0) {
    throw new Error(`quota concurrency test exited ${code}`);
  }
}
