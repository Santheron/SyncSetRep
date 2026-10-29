import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { IMPORT_ENABLED, PERSIST_REST_SECONDS, SUBTITLE_REQUIRED } from '../lib/import/flags.ts';

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
assert.match(dayOrderSql, /program_day_order_duplicates/);
assert.equal(/\b(insert|update|delete)\b/i.test(dayOrderSql), false);

const dayOrderRollbackSql = stripSql(files.dayOrderRollback);
assert.match(dayOrderRollbackSql, /day_order_rollback_blocked/);
assert.match(dayOrderRollbackSql, /UNIQUE \(day_order\)/);
assert.equal(/\b(insert|update|delete from)\b/i.test(dayOrderRollbackSql), false);

const saveSql = stripSql(files.save);
assert.match(saveSql, /SECURITY INVOKER/);
assert.match(saveSql, /SET search_path = public/);
assert.match(saveSql, /auth\.uid\(\)/);
assert.match(saveSql, /is_active/);
assert.match(saveSql, /FOR UPDATE/);
assert.match(saveSql, /invalid_import: inverted_reps/);
assert.match(saveSql, /active_program_required/);
assert.match(saveSql, /VALUES \(uid, program_name, NULL, false\)/);
assert.equal(/\bsecurity definer\b/i.test(saveSql), false);
assert.equal(/\bupdate\s+(public|only)\b/i.test(saveSql), false);
assert.equal(/\bdelete\s+from\b/i.test(saveSql), false);
assert.equal(/\bcopy_starter_program\b/i.test(saveSql), false);
assert.equal(stripSql(files.saveRollback).includes('DROP FUNCTION IF EXISTS public.save_imported_program(jsonb)'), true);

const quotaSql = stripSql(files.quota);
assert.match(quotaSql, /SECURITY DEFINER/);
assert.match(quotaSql, /SET search_path = public/);
assert.match(quotaSql, /auth\.uid\(\)/);
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
  CONSTRAINT program_days_day_order_global UNIQUE (day_order)
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
    VALUES ('${USER_A}', now());
    INSERT INTO public.workout_sets (workout_session_id, exercise_id, reps)
    VALUES (1, 1, 8);
  `);
}

async function runBehavior(PGlite: new () => PgLike) {
  const db = new PGlite();
  await seedBase(db);
  const beforeDays = await db.query<{ id: number; day_order: number }>(
    'SELECT id, day_order FROM public.program_days ORDER BY id',
  );
  const beforeHistory = await db.query<{ sessions: number; sets: number }>(`
    SELECT
      (SELECT count(*)::int FROM public.workout_sessions) AS sessions,
      (SELECT count(*)::int FROM public.workout_sets) AS sets
  `);
  await execFile(db, 'ai-import-day-order.sql');
  const afterDays = await db.query<{ id: number; day_order: number }>(
    'SELECT id, day_order FROM public.program_days ORDER BY id',
  );
  assert.deepEqual(afterDays.rows, beforeDays.rows);
  const afterHistory = await db.query<{ sessions: number; sets: number }>(`
    SELECT
      (SELECT count(*)::int FROM public.workout_sessions) AS sessions,
      (SELECT count(*)::int FROM public.workout_sets) AS sets
  `);
  assert.deepEqual(afterHistory.rows, beforeHistory.rows);
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
  const preflight = await db.query<{ day_order_preflight: string }>(readSql('ai-import-day-order-preflight.sql'));
  const preflightJson = JSON.parse(preflight.rows[0]?.day_order_preflight ?? '{}') as {
    duplicate_groups: number;
  };
  assert.equal(preflightJson.duplicate_groups, 0);

  await execFile(db, 'ai-import-save-program.sql');
  const functionFlags = await db.query<{ security_definer: boolean; config: string[] | null }>(`
    SELECT prosecdef AS security_definer, proconfig AS config
    FROM pg_proc
    WHERE proname = 'save_imported_program'
  `);
  assert.equal(functionFlags.rows[0]?.security_definer, false);
  assert.equal(functionFlags.rows[0]?.config?.includes('search_path=public'), true);

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
  assert.deepEqual(
    (await db.query('SELECT id, day_order FROM public.program_days WHERE id = 1')).rows,
    beforeDays.rows,
  );
  assert.deepEqual(
    (await db.query(`
      SELECT
        (SELECT count(*)::int FROM public.workout_sessions) AS sessions,
        (SELECT count(*)::int FROM public.workout_sets) AS sets
    `)).rows,
    beforeHistory.rows,
  );

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

  let rollbackBlocked = false;
  try {
    await execFile(db, 'ai-import-day-order-rollback.sql');
  } catch (error) {
    rollbackBlocked = true;
    assert.match(error instanceof Error ? error.message : String(error), /day_order_rollback_blocked/);
  }
  assert.equal(rollbackBlocked, true);
  const pairConstraint = await db.query<{ name: string | null }>(`
    SELECT conname AS name
    FROM pg_constraint
    WHERE conname = 'program_days_program_id_day_order_key'
  `);
  assert.equal(pairConstraint.rows[0]?.name, 'program_days_program_id_day_order_key');
  assert.deepEqual(
    (await db.query('SELECT id, day_order FROM public.program_days WHERE id = 1')).rows,
    beforeDays.rows,
  );

  const clean = new PGlite();
  await seedBase(clean);
  await execFile(clean, 'ai-import-day-order.sql');
  await execFile(clean, 'ai-import-day-order-rollback.sql');
  const restored = await clean.query<{ name: string }>(`
    SELECT conname AS name
    FROM pg_constraint
    WHERE conrelid = 'public.program_days'::regclass
      AND contype = 'u'
  `);
  assert.equal(restored.rows.some((row) => row.name === 'program_days_day_order_key'), true);
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
    (await clean.query('SELECT id, day_order FROM public.program_days ORDER BY id')).rows,
    beforeDays.rows,
  );

  const quotaDb = new PGlite();
  await quotaDb.exec(fixtureSql);
  await quotaDb.exec(`INSERT INTO auth.users (id) VALUES ('${USER_A}')`);
  await execFile(quotaDb, 'ai-import-quota.sql');
  const quotaFlags = await quotaDb.query<{ security_definer: boolean; config: string[] | null }>(`
    SELECT prosecdef AS security_definer, proconfig AS config
    FROM pg_proc
    WHERE proname = 'consume_ai_import_quota'
  `);
  assert.equal(quotaFlags.rows[0]?.security_definer, true);
  assert.equal(quotaFlags.rows[0]?.config?.includes('search_path=public'), true);
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
