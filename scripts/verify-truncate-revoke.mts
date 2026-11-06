import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const port = 55452;
const database = 'syncsetrep_truncate_revoke';
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');

const revokeSql = await readFile(join(root, 'sql/workout-history-truncate-revoke.sql'), 'utf8');
const revokeRollbackSql = await readFile(
  join(root, 'sql/workout-history-truncate-revoke-rollback.sql'),
  'utf8',
);
const lockSql = await readFile(join(root, 'sql/workout-history-lock.sql'), 'utf8');
const sessionSource = await readFile(join(root, 'lib/workout-session.ts'), 'utf8');
const swapSource = await readFile(join(root, 'lib/exercise-swap.ts'), 'utf8');
const preserveSql = await readFile(join(root, 'sql/routine-rest-preserve.sql'), 'utf8');
const flagsSql = await readFile(join(root, 'lib/import/manual-program-client.ts'), 'utf8');
const loadModeSource = await readFile(join(root, 'lib/load-mode.ts'), 'utf8');
const appConfig = await readFile(join(root, 'app.config.ts'), 'utf8');
const appSources = [
  await readFile(join(root, 'app/(tabs)/index.tsx'), 'utf8'),
  await readFile(join(root, 'app/workout/select.tsx'), 'utf8'),
  await readFile(join(root, 'app/workout/[sessionId].tsx'), 'utf8'),
  await readFile(join(root, 'app/(tabs)/history/index.tsx'), 'utf8'),
  await readFile(join(root, 'app/(tabs)/history/[sessionId].tsx'), 'utf8'),
].join('\n');

function stripSql(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

assert.equal(revokeSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(revokeRollbackSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(lockSql.startsWith('-- NOT APPLIED.'), true);
assert.match(revokeSql, /history_truncate_revoked/);
assert.match(revokeSql, /history_truncate_already_revoked/);
assert.match(revokeSql, /history_truncate_still_effective/);
assert.match(revokeSql, /history_truncate_programs_update_changed/);
assert.match(revokeRollbackSql, /history_truncate_restored/);
assert.match(revokeRollbackSql, /history_truncate_revoke_absent/);
assert.equal(/\bDROP\b/i.test(stripSql(revokeSql)), false);
assert.equal(/DELETE\s+FROM/i.test(stripSql(revokeSql)), false);
assert.equal(/UPDATE\s+public\.workout_/i.test(stripSql(revokeSql)), false);
assert.equal(/\bTRUNCATE\s+(TABLE|ONLY|public)\b/i.test(stripSql(revokeSql)), false);
assert.equal(/\bREVOKE\b/i.test(stripSql(revokeRollbackSql)), false);
assert.equal(/DELETE\s+FROM/i.test(stripSql(revokeRollbackSql)), false);
assert.equal(/\bGRANT\b/i.test(stripSql(lockSql)), false);
assert.equal(/\bREVOKE\b/i.test(stripSql(lockSql)), false);
assert.equal(/\btruncate\b/i.test(sessionSource), false);
assert.equal(/\btruncate\b/i.test(swapSource), false);
assert.equal(/\btruncate\b/i.test(appSources), false);
assert.match(sessionSource, /\.from\('workout_sets'\)\s*\.delete\(\)/);
assert.match(sessionSource, /\.from\('workout_sessions'\)\s*\.delete\(\)[\s\S]*?\.is\('finished_at', null\)/);
assert.match(sessionSource, /\.update\(\{ finished_at: finishedAt \}\)[\s\S]*?\.is\('finished_at', null\)/);
assert.match(sessionSource, /\.eq\('is_completed', false\)/);
assert.match(sessionSource, /\.update\(\{ exercise_id: toExerciseId \}\)/);
assert.match(flagsSql, /export const OWNED_PROGRAM_EDIT_ENABLED = RELEASE_CANDIDATE_FEATURES_ENABLED/);
assert.match(loadModeSource, /export const PERSIST_LOAD_MODE = RELEASE_CANDIDATE_FEATURES_ENABLED/);
assert.notEqual(process.env.EXPO_PUBLIC_SYNCSETREP_RC, '1');
assert.match(appConfig, /version: '1\.1\.0'/);
assert.match(appConfig, /com\.akagi253\.workouttracker/);
assert.match(preserveSql, /DELETE FROM public\.program_days AS day_row[\s\S]*?NOT EXISTS \([\s\S]*?workout_sessions/);
assert.equal(/DELETE\s+FROM\s+public\.workout_/i.test(stripSql(preserveSql)), false);

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
  return run(
    psqlPath,
    [
      '-h', '127.0.0.1',
      '-p', String(port),
      '-U', 'postgres',
      '-d', databaseName,
      '-X', '-A', '-t',
      '-v', 'ON_ERROR_STOP=1',
      '-q',
    ],
    sql,
  );
}

function asUser(userId: string, statement: string, finish = 'COMMIT') {
  return `
BEGIN;
SELECT set_config('request.jwt.claim.sub', '${userId}', true) \\gset
SET LOCAL ROLE authenticated;
${statement}
${finish};
`;
}

const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-truncate-revoke-pg-'));
const logFile = join(dataDir, 'server.log');
let started = false;

try {
  const initialized = await run(initdbPath, [
    '-D', dataDir, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale',
  ]);
  assert.equal(initialized.code, 0, initialized.stderr);
  await writeFile(
    join(dataDir, 'postgresql.conf'),
    `\nlisten_addresses = '127.0.0.1'\nport = ${port}\n`,
    { flag: 'a' },
  );
  const startedResult = await run(pgCtlPath, ['-D', dataDir, '-l', logFile, '-w', 'start']);
  assert.equal(startedResult.code, 0, `${startedResult.stderr}\n${await readFile(logFile, 'utf8').catch(() => '')}`);
  started = true;

  const created = await psql(`CREATE DATABASE ${database};`, 'postgres');
  assert.equal(created.code, 0, created.stderr);

  async function must(sql: string, label: string) {
    const result = await psql(sql);
    assert.equal(result.code, 0, `${label}\n${result.stderr}\n${result.stdout}`);
    return result.stdout.replace(/\r/g, '').trim();
  }

  async function expectError(sql: string, pattern: RegExp, label: string) {
    const result = await psql(sql);
    assert.notEqual(result.code, 0, `${label} unexpectedly succeeded\n${result.stdout}`);
    assert.match(result.stderr, pattern, `${label}\n${result.stderr}`);
  }

  const fixture = await psql(await readFile(join(root, 'scripts/fixtures/production-shape.sql'), 'utf8'));
  assert.equal(fixture.code, 0, fixture.stderr);

  await must(`
    CREATE TABLE public.body_metrics (
      id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id uuid
    );
    CREATE TABLE public.cardio_sessions (
      id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id uuid
    );
    GRANT ALL ON TABLE public.body_metrics, public.cardio_sessions
      TO authenticated, service_role;
    ALTER TABLE public.body_metrics ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.cardio_sessions ENABLE ROW LEVEL SECURITY;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      GRANT ALL ON TABLES TO anon, authenticated, service_role;
    REVOKE UPDATE ON TABLE public.programs FROM authenticated;
    CREATE ROLE authenticator NOINHERIT NOLOGIN;
    GRANT authenticated TO authenticator WITH INHERIT FALSE, SET TRUE;
    INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}');
    INSERT INTO public.exercises (id, name) VALUES (1, 'Squat'), (2, 'Lunge');
    INSERT INTO public.programs (id, user_id, name, is_active) OVERRIDING SYSTEM VALUE VALUES
      (1, '${userA}', 'History', true),
      (2, '${userB}', 'Other', true);
    INSERT INTO public.program_days (id, name, day_order, program_id) VALUES
      (1, 'Lower', 1, 1),
      (2, 'Unused', 2, 1);
    INSERT INTO public.program_exercises (
      id, program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps
    ) VALUES
      (1, 1, 1, 1, 2, 5, 8),
      (2, 2, 1, 1, 2, 5, 8);
    INSERT INTO public.workout_sessions (id, program_day_id, user_id, finished_at, notes) VALUES
      (1, 1, '${userA}', '2026-10-01 12:00:00+00', 'kept'),
      (2, 1, '${userA}', NULL, 'open'),
      (5, 1, '${userA}', NULL, 'finish-me'),
      (8, 1, '${userA}', NULL, 'discard-me');
    INSERT INTO public.workout_sets (
      id, workout_session_id, exercise_id, set_number, weight, reps, is_completed
    ) VALUES
      (1, 1, 1, 1, 135, 5, true),
      (2, 1, 1, 2, 135, 5, true),
      (3, 2, 1, 1, 95, 8, true),
      (4, 2, 1, 2, 95, NULL, false),
      (7, 5, 1, 1, 115, 4, true),
      (8, 8, 1, 1, 65, NULL, false);
    INSERT INTO public.body_metrics (user_id) VALUES ('${userA}');
    INSERT INTO public.cardio_sessions (user_id) VALUES ('${userA}');
    SELECT setval(pg_get_serial_sequence('public.exercises', 'id'), 2, true);
    SELECT setval(pg_get_serial_sequence('public.programs', 'id'), 2, true);
    SELECT setval(pg_get_serial_sequence('public.program_days', 'id'), 2, true);
    SELECT setval(pg_get_serial_sequence('public.program_exercises', 'id'), 2, true);
    SELECT setval(pg_get_serial_sequence('public.workout_sessions', 'id'), 8, true);
    SELECT setval(pg_get_serial_sequence('public.workout_sets', 'id'), 8, true);
  `, 'seed');

  async function historyShape() {
    return must(`
      SELECT id::text || ':' || reps::text || ':' || is_completed::text
      FROM public.workout_sets
      WHERE workout_session_id = 1
      ORDER BY id;
    `, 'finished sets');
  }

  async function affected(statement: string) {
    return must(asUser(userA, `
      WITH changed AS (
        ${statement}
        RETURNING 1
      )
      SELECT count(*)::text FROM changed;
    `), statement);
  }

  const finishedSets = await historyShape();
  assert.equal(finishedSets, '1:5:true\n2:5:true');

  await must(asUser(userA, 'TRUNCATE public.workout_sets;', 'ROLLBACK'), 'truncate sets before revoke');
  await must(asUser(
    userA,
    'TRUNCATE public.workout_sessions, public.workout_sets;',
    'ROLLBACK',
  ), 'truncate sessions and sets before revoke');
  await must(asUser(userA, 'TRUNCATE public.workout_sessions CASCADE;', 'ROLLBACK'), 'cascade before revoke');
  await expectError(asUser(
    userA,
    'TRUNCATE public.workout_sessions;',
    'ROLLBACK',
  ), /foreign key constraint/, 'sessions alone are referenced by sets');
  assert.equal(await historyShape(), finishedSets);

  const locked = await must(lockSql, 'history lock');
  assert.match(locked, /history_lock_installed/);
  await must(asUser(userA, 'TRUNCATE public.workout_sets;', 'ROLLBACK'), 'truncate still ignores the lock');
  assert.equal(await historyShape(), finishedSets);
  assert.equal(await affected('DELETE FROM public.workout_sets WHERE id = 1'), '0');
  assert.equal(await affected('DELETE FROM public.workout_sessions WHERE id = 1'), '0');
  assert.equal(await affected(`UPDATE public.workout_sessions SET notes = 'rewritten' WHERE id = 1`), '0');
  assert.equal(await affected('UPDATE public.workout_sets SET reps = 99 WHERE id = 1'), '0');
  await expectError(asUser(userA, `
    INSERT INTO public.workout_sets (workout_session_id, exercise_id, set_number, reps, is_completed)
    VALUES (1, 1, 3, 1, true);
  `), /row-level security policy/, 'insert into finished session');

  const revoked = await must(revokeSql, 'revoke truncate');
  assert.match(revoked, /history_truncate_revoked/);
  await expectError(revokeSql, /history_truncate_already_revoked/, 'second revoke');

  await expectError(asUser(userA, 'TRUNCATE public.workout_sets;', 'ROLLBACK'), /permission denied/, 'authenticated sets');
  await expectError(asUser(
    userA,
    'TRUNCATE public.workout_sessions, public.workout_sets;',
    'ROLLBACK',
  ), /permission denied/, 'authenticated both tables');
  await expectError(asUser(
    userA,
    'TRUNCATE public.workout_sessions CASCADE;',
    'ROLLBACK',
  ), /permission denied/, 'authenticated cascade');
  await expectError(asUser(userA, 'TRUNCATE public.body_metrics;', 'ROLLBACK'), /permission denied/, 'body metrics');
  await expectError(asUser(userA, 'TRUNCATE public.cardio_sessions;', 'ROLLBACK'), /permission denied/, 'cardio');
  await expectError(`
    BEGIN;
    SET LOCAL ROLE anon;
    TRUNCATE public.workout_sets;
    ROLLBACK;
  `, /permission denied/, 'anon truncate');
  await expectError(`
    BEGIN;
    SET LOCAL ROLE authenticator;
    SET LOCAL ROLE authenticated;
    TRUNCATE public.workout_sets;
    ROLLBACK;
  `, /permission denied/, 'authenticator set role truncate');
  await must(`
    BEGIN;
    TRUNCATE public.workout_sets;
    ROLLBACK;
  `, 'owner truncate still allowed');
  await must(`
    BEGIN;
    SET LOCAL ROLE service_role;
    TRUNCATE public.workout_sets;
    ROLLBACK;
  `, 'service role truncate still allowed');
  assert.equal(await historyShape(), finishedSets);
  assert.equal(await must(`
    SELECT rolcanlogin::text FROM pg_catalog.pg_roles WHERE rolname = 'authenticated';
  `, 'authenticated cannot log in'), 'false');
  assert.equal(await must(`
    SELECT string_agg(
      privilege_name || '=' || has_table_privilege('authenticated', 'public.workout_sessions', privilege_name)::text,
      ',' ORDER BY privilege_name
    )
    FROM (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS privileges(privilege_name);
  `, 'session privileges'), 'DELETE=true,INSERT=true,SELECT=true,TRUNCATE=false,UPDATE=true');
  assert.equal(await must(`
    SELECT has_table_privilege('anon', 'public.workout_sessions', 'TRUNCATE')::text
      || ':' || has_table_privilege('service_role', 'public.workout_sets', 'TRUNCATE')::text
      || ':' || has_table_privilege('authenticated', 'public.programs', 'UPDATE')::text
      || ':' || has_table_privilege('authenticated', 'public.programs', 'DELETE')::text;
  `, 'anon, service role, and programs'), 'false:true:false:true');

  assert.equal(await affected(`UPDATE public.workout_sets SET reps = 9, is_completed = false WHERE id = 4`), '1');
  await must(asUser(userA, `
    INSERT INTO public.workout_sets (
      workout_session_id, exercise_id, set_number, weight, reps, is_completed
    ) VALUES (2, 2, 3, 45, NULL, false);
  `), 'swap insert');
  assert.equal(await affected(`
    DELETE FROM public.workout_sets
    WHERE id = 4 AND workout_session_id = 2 AND exercise_id = 1 AND is_completed = false
  `), '1');
  assert.equal(await affected(`UPDATE public.program_exercises SET exercise_id = 2 WHERE id = 1`), '1');
  assert.equal(await must(`
    SELECT exercise_id::text || ':' || COALESCE(reps::text, 'null') || ':' || is_completed::text
    FROM public.workout_sets
    WHERE workout_session_id = 2
    ORDER BY exercise_id, is_completed;
  `, 'open sets after swap'), '1:8:true\n2:null:false');
  assert.equal(await affected(`
    UPDATE public.workout_sessions
    SET finished_at = '2026-11-02 18:00:00+00'
    WHERE id = 5 AND finished_at IS NULL
  `), '1');
  assert.equal(await affected('DELETE FROM public.workout_sets WHERE workout_session_id = 5'), '0');
  assert.equal(await affected('DELETE FROM public.workout_sessions WHERE id = 5'), '0');
  assert.equal(await affected(`
    DELETE FROM public.workout_sets WHERE workout_session_id = 8 AND is_completed = false
  `), '1');
  assert.equal(await affected(`
    DELETE FROM public.workout_sessions
    WHERE id = 8 AND user_id = '${userA}'::uuid AND finished_at IS NULL
  `), '1');
  assert.equal(await must(`SELECT count(*)::text FROM public.workout_sessions WHERE id = 8;`, 'discarded'), '0');
  assert.equal(await affected('UPDATE public.program_exercises SET target_sets = 4 WHERE id = 2'), '1');
  await must(`
    INSERT INTO public.program_days (id, name, day_order, program_id) VALUES (4, 'Fresh', 4, 1);
    INSERT INTO public.program_exercises (id, program_day_id, exercise_id, exercise_order, target_sets)
    VALUES (4, 4, 1, 1, 1);
    DELETE FROM public.program_exercises AS child
    USING public.program_days AS day_row
    WHERE child.program_day_id = day_row.id
      AND day_row.id = 4
      AND NOT EXISTS (
        SELECT 1 FROM public.workout_sessions AS session_row
        WHERE session_row.program_day_id = day_row.id
      );
    DELETE FROM public.program_days AS day_row
    WHERE day_row.id = 4
      AND NOT EXISTS (
        SELECT 1 FROM public.workout_sessions AS session_row
        WHERE session_row.program_day_id = day_row.id
      );
    DELETE FROM public.program_days AS day_row
    WHERE day_row.id = 1
      AND NOT EXISTS (
        SELECT 1 FROM public.workout_sessions AS session_row
        WHERE session_row.program_day_id = day_row.id
      );
  `, 'owner routine predicates');
  assert.equal(await must(`SELECT count(*)::text FROM public.program_days WHERE id = 4;`, 'empty day removed'), '0');
  assert.equal(await must(`SELECT count(*)::text FROM public.program_days WHERE id = 1;`, 'history day kept'), '1');
  await expectError(asUser(userA, 'DELETE FROM public.program_days WHERE id = 1;'), /foreign key constraint/, 'day with history');
  assert.equal(await historyShape(), finishedSets);

  async function probePrivileges() {
    return must(`
      CREATE TABLE public.truncate_probe (id integer);
      SELECT has_table_privilege('authenticated', 'public.truncate_probe', 'TRUNCATE')::text
        || ':' || has_table_privilege('authenticated', 'public.truncate_probe', 'SELECT')::text
        || ':' || has_table_privilege('anon', 'public.truncate_probe', 'TRUNCATE')::text
        || ':' || has_table_privilege('service_role', 'public.truncate_probe', 'TRUNCATE')::text;
      DROP TABLE public.truncate_probe;
    `, 'probe table');
  }

  assert.equal(await probePrivileges(), 'false:true:false:true');

  const restored = await must(revokeRollbackSql, 'restore truncate');
  assert.match(restored, /history_truncate_restored/);
  await expectError(revokeRollbackSql, /history_truncate_revoke_absent/, 'second restore');
  await must(asUser(userA, 'TRUNCATE public.workout_sets;', 'ROLLBACK'), 'truncate works after restore');
  await must(`
    BEGIN;
    SET LOCAL ROLE authenticator;
    SET LOCAL ROLE authenticated;
    TRUNCATE public.workout_sets;
    ROLLBACK;
  `, 'set role works after restore');
  assert.equal(await affected('DELETE FROM public.workout_sessions WHERE id = 1'), '0');
  assert.equal(await must(`
    SELECT has_table_privilege('anon', 'public.workout_sessions', 'TRUNCATE')::text;
  `, 'anon stays without truncate'), 'false');
  assert.equal(await probePrivileges(), 'true:true:true:true');
  assert.equal(await historyShape(), finishedSets);

  const revokedAgain = await must(revokeSql, 'revoke again');
  assert.match(revokedAgain, /history_truncate_revoked/);
  await expectError(asUser(userA, 'TRUNCATE public.workout_sets;', 'ROLLBACK'), /permission denied/, 'closed again');
  assert.equal(await historyShape(), finishedSets);
  console.log('truncate revoke checks passed; finished sets preserved: 1:5:true,2:5:true');
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
