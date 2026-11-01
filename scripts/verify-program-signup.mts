import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function readSql(name: string) {
  return readFileSync(new URL(`../sql/${name}`, import.meta.url), 'utf8');
}

function stripSql(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

const forwardSql = readSql('program-signup-no-starter.sql');
const rollbackSql = readSql('program-signup-no-starter-rollback.sql');
const forwardBody = stripSql(forwardSql);
const rollbackBody = stripSql(rollbackSql);

assert.match(forwardSql, /NOT APPLIED/);
assert.match(forwardBody, /CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)/);
assert.match(forwardBody, /INSERT INTO public\.profiles/);
assert.equal(forwardBody.includes('copy_starter'), false);
assert.equal(forwardBody.includes('workout_sessions'), false);
assert.equal(forwardBody.includes('workout_sets'), false);
assert.equal(/\b(update|delete)\b/i.test(forwardBody), false);
assert.equal(forwardBody.includes('public.programs'), false);
assert.match(forwardBody, /SET LOCAL lock_timeout = '5s'/);
assert.match(forwardBody, /SET LOCAL statement_timeout = '30s'/);
assert.match(rollbackSql, /NOT AN INSTALL STEP/);
assert.match(rollbackBody, /copy_starter_program/);
assert.equal(/\b(update|delete)\s+/i.test(rollbackBody), false);
assert.equal(rollbackBody.includes('workout_sessions'), false);
assert.equal(rollbackBody.includes('public.programs'), false);

const disableSql = readSql('program-starter-disable.sql');
const disableRollbackSql = readSql('program-starter-disable-rollback.sql');
const disableBody = stripSql(disableSql);
const disableRollbackBody = stripSql(disableRollbackSql);
assert.match(disableSql, /NOT APPLIED/);
assert.match(disableBody, /starter_program_disabled/);
assert.match(disableBody, /SECURITY DEFINER/);
assert.match(disableBody, /SET search_path = ''/);
assert.match(
  disableBody,
  /REVOKE ALL ON FUNCTION public\.copy_starter_program_for_current_user\(\) FROM PUBLIC, anon, authenticated/,
);
assert.equal(/\binsert\s+into\b/i.test(disableBody), false);
assert.equal(/\bupdate\s+public\./i.test(disableBody), false);
assert.equal(/\bdelete\s+from\b/i.test(disableBody), false);
assert.equal(disableBody.includes('workout_sessions'), false);
assert.equal(disableBody.includes('workout_sets'), false);
assert.match(disableRollbackSql, /NOT AN INSTALL STEP/);
assert.match(disableRollbackBody, /INSERT INTO public\.programs/);
assert.match(disableRollbackBody, /GRANT EXECUTE ON FUNCTION public\.copy_starter_program_for_current_user\(\) TO authenticated/);
assert.equal(disableRollbackBody.includes('workout_sessions'), false);
assert.equal(disableRollbackBody.includes('workout_sets'), false);

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const USER_C = '33333333-3333-3333-3333-333333333333';
const USER_D = '44444444-4444-4444-4444-444444444444';

const fixtureSql = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id),
  display_name text,
  preferred_weight_unit text NOT NULL DEFAULT 'lb'
);
CREATE TABLE public.programs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.program_days (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id bigint NOT NULL REFERENCES public.programs (id),
  name text NOT NULL
);
CREATE TABLE public.workout_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  program_day_id bigint,
  finished_at timestamptz
);
CREATE TABLE public.workout_sets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workout_session_id bigint NOT NULL REFERENCES public.workout_sessions (id),
  exercise_id bigint NOT NULL,
  reps integer
);
CREATE OR REPLACE FUNCTION public.copy_starter_program(target_user_id uuid, template_slug text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.programs (user_id, name, is_active)
  VALUES (target_user_id, 'Starter', true);
  RETURN 1;
END;
$$;
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

async function snapshot(db: PgLike) {
  const profiles = await db.query(`
    SELECT id::text AS id, display_name, preferred_weight_unit
    FROM public.profiles
    ORDER BY id
  `);
  const programs = await db.query(`
    SELECT id, user_id::text AS user_id, name, is_active
    FROM public.programs
    ORDER BY id
  `);
  const sessions = await db.query(`
    SELECT id, user_id::text AS user_id, program_day_id, finished_at::text AS finished_at
    FROM public.workout_sessions
    ORDER BY id
  `);
  const sets = await db.query(`
    SELECT id, workout_session_id, exercise_id, reps
    FROM public.workout_sets
    ORDER BY id
  `);
  return {
    profiles: profiles.rows,
    programs: programs.rows,
    sessions: sessions.rows,
    sets: sets.rows,
  };
}

async function functionBody(db: PgLike) {
  const result = await db.query<{ prosrc: string }>(`
    SELECT prosrc
    FROM pg_proc
    WHERE proname = 'handle_new_user'
    ORDER BY oid DESC
    LIMIT 1
  `);
  return result.rows[0]?.prosrc ?? '';
}

async function runBehavior(PGlite: new () => PgLike) {
  const db = new PGlite();
  await db.exec(fixtureSql);
  await db.exec(`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES ('${USER_A}', 'owner@example.com', '{"display_name":"Owner"}'::jsonb);
    INSERT INTO public.profiles (id, display_name, preferred_weight_unit)
    VALUES ('${USER_A}', 'Owner', 'lb');
    INSERT INTO public.programs (user_id, name, is_active)
    VALUES ('${USER_A}', 'Current', true);
    INSERT INTO public.program_days (program_id, name)
    VALUES (1, 'Push');
    INSERT INTO public.workout_sessions (user_id, program_day_id, finished_at)
    VALUES
      ('${USER_A}', 1, timestamptz '2026-01-02T00:00:00Z'),
      ('${USER_A}', 1, NULL);
    INSERT INTO public.workout_sets (workout_session_id, exercise_id, reps)
    SELECT id, 1, 8 FROM public.workout_sessions ORDER BY id;
  `);
  const seeded = await snapshot(db);
  assert.equal(seeded.programs.length, 1);
  assert.equal(seeded.sessions.length, 2);
  assert.equal(seeded.sets.length, 2);

  await db.exec(rollbackSql);
  await db.exec(`
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE PROCEDURE public.handle_new_user();
  `);
  assert.match(await functionBody(db), /copy_starter_program/);
  assert.deepEqual(await snapshot(db), seeded);

  await db.exec(forwardSql);
  assert.equal((await functionBody(db)).includes('copy_starter'), false);
  assert.deepEqual(await snapshot(db), seeded);

  await db.exec(`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES ('${USER_B}', 'new@example.com', '{"display_name":"New Lifter"}'::jsonb);
  `);
  const afterNewUser = await snapshot(db);
  assert.equal(afterNewUser.programs.filter((row) => row.user_id === USER_B).length, 0);
  assert.equal(afterNewUser.programs.filter((row) => row.name === 'Starter').length, 0);
  assert.deepEqual(
    afterNewUser.profiles.find((row) => row.id === USER_B),
    { id: USER_B, display_name: 'New Lifter', preferred_weight_unit: 'lb' },
  );
  assert.deepEqual(
    afterNewUser.profiles.find((row) => row.id === USER_A),
    seeded.profiles[0],
  );
  assert.deepEqual(afterNewUser.programs, seeded.programs);
  assert.deepEqual(afterNewUser.sessions, seeded.sessions);
  assert.deepEqual(afterNewUser.sets, seeded.sets);

  await db.exec(rollbackSql);
  assert.match(await functionBody(db), /copy_starter_program/);
  assert.deepEqual(await snapshot(db), afterNewUser);

  await db.exec(forwardSql);
  await db.exec(`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES ('${USER_C}', 'blank@example.com', '{"display_name":"  "}'::jsonb);
  `);
  const afterBlank = await snapshot(db);
  assert.equal(afterBlank.profiles.find((row) => row.id === USER_C)?.display_name, null);
  assert.equal(afterBlank.programs.filter((row) => row.user_id === USER_C).length, 0);
  assert.deepEqual(
    afterBlank.programs,
    seeded.programs,
  );
  assert.deepEqual(afterBlank.sessions, seeded.sessions);
  assert.deepEqual(afterBlank.sets, seeded.sets);
  assert.equal(afterBlank.profiles.filter((row) => row.id === USER_A).length, 1);
  assert.equal(afterBlank.profiles.filter((row) => row.id === USER_B).length, 1);

  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
  `);
  await db.exec(disableSql);
  let starterRaised = false;
  try {
    await db.exec(`SELECT public.copy_starter_program('${USER_A}', NULL)`);
  } catch (error) {
    starterRaised = true;
    assert.match(error instanceof Error ? error.message : String(error), /starter_program_disabled/);
  }
  assert.equal(starterRaised, true);
  const starterExecute = await db.query<{ allowed: boolean }>(`
    SELECT has_function_privilege(
      'authenticated',
      'public.copy_starter_program_for_current_user()',
      'EXECUTE'
    ) AS allowed
  `);
  assert.equal(starterExecute.rows[0]?.allowed, false);
  assert.deepEqual((await snapshot(db)).programs, seeded.programs);

  await db.exec(rollbackSql);
  await db.exec(`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES ('${USER_D}', 'chooser@example.com', '{"display_name":"Chooser"}'::jsonb);
  `);
  const afterDisabledSignup = await snapshot(db);
  assert.equal(afterDisabledSignup.programs.filter((row) => row.user_id === USER_D).length, 0);
  assert.equal(afterDisabledSignup.programs.filter((row) => row.name === 'Starter').length, 0);
  assert.equal(afterDisabledSignup.profiles.find((row) => row.id === USER_D)?.display_name, 'Chooser');
  assert.deepEqual(afterDisabledSignup.programs, seeded.programs);
  assert.deepEqual(afterDisabledSignup.sessions, seeded.sessions);
  assert.deepEqual(afterDisabledSignup.sets, seeded.sets);

  await db.exec(`
    ALTER TABLE public.programs
      ADD COLUMN slug text,
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE public.program_days
      ADD COLUMN subtitle text,
      ADD COLUMN day_order integer;
    CREATE TABLE public.program_exercises (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      program_day_id bigint NOT NULL,
      exercise_id bigint NOT NULL,
      exercise_order integer NOT NULL,
      target_sets integer NOT NULL,
      min_reps integer,
      max_reps integer,
      notes text
    );
    CREATE TABLE public.program_templates (
      id bigint PRIMARY KEY,
      name text,
      slug text,
      is_default boolean
    );
    CREATE TABLE public.program_template_days (
      id bigint PRIMARY KEY,
      template_id bigint,
      name text,
      subtitle text,
      day_order integer
    );
    CREATE TABLE public.program_template_exercises (
      id bigint PRIMARY KEY,
      template_day_id bigint,
      exercise_id bigint,
      exercise_order integer,
      target_sets integer,
      min_reps integer,
      max_reps integer,
      notes text
    );
  `);
  await db.exec(disableRollbackSql);
  const restoredStarter = await db.query<{ prosrc: string }>(`
    SELECT prosrc
    FROM pg_proc
    WHERE proname = 'copy_starter_program'
    ORDER BY oid DESC
    LIMIT 1
  `);
  assert.match(restoredStarter.rows[0]?.prosrc ?? '', /INSERT INTO public\.programs/);
  assert.deepEqual((await snapshot(db)).programs, seeded.programs);
  assert.deepEqual((await snapshot(db)).sessions, seeded.sessions);

  await db.exec(disableSql);
  let restoredCallRaised = false;
  try {
    await db.exec(`SELECT public.copy_starter_program('${USER_D}', NULL)`);
  } catch (error) {
    restoredCallRaised = true;
    assert.match(error instanceof Error ? error.message : String(error), /starter_program_disabled/);
  }
  assert.equal(restoredCallRaised, true);
  assert.deepEqual((await snapshot(db)).programs, seeded.programs);
  assert.deepEqual((await snapshot(db)).sets, seeded.sets);
}

const pg = await loadPg();
if (process.env.RUN_IMPORT_DB === '1') {
  if (!pg) {
    throw new Error('RUN_IMPORT_DB=1 requires @electric-sql/pglite');
  }
  await runBehavior(pg.PGlite);
  console.log('program signup database checks passed');
} else if (pg) {
  await runBehavior(pg.PGlite);
  console.log('program signup database checks passed');
} else {
  console.log('program signup database checks skipped');
}

console.log('program signup checks passed');
