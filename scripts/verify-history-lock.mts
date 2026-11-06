import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const port = 55450;
const database = 'syncsetrep_history_lock';
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');

const lockSql = await readFile(join(root, 'sql/workout-history-lock.sql'), 'utf8');
const rollbackSql = await readFile(join(root, 'sql/workout-history-lock-rollback.sql'), 'utf8');
const preflightSql = await readFile(join(root, 'sql/workout-history-lock-preflight.sql'), 'utf8');
const sessionSource = await readFile(join(root, 'lib/workout-session.ts'), 'utf8');
const preserveSql = await readFile(join(root, 'sql/routine-rest-preserve.sql'), 'utf8');
const flagsSql = await readFile(join(root, 'lib/import/manual-program-client.ts'), 'utf8');
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

assert.equal(lockSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(rollbackSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(preflightSql.includes('SET TRANSACTION READ ONLY'), true);
assert.equal(/\bGRANT\b/i.test(stripSql(lockSql)), false);
assert.equal(/\bREVOKE\b/i.test(stripSql(lockSql)), false);
assert.equal(/\bALTER\s+TABLE\b/i.test(stripSql(lockSql)), false);
assert.equal(/\bDROP\b/i.test(stripSql(lockSql)), false);
assert.equal(/DELETE\s+FROM/i.test(stripSql(lockSql)), false);
assert.equal(/UPDATE\s+public\.workout_/i.test(stripSql(lockSql)), false);
assert.equal(/\bGRANT\b/i.test(stripSql(rollbackSql)), false);
assert.equal(/\bREVOKE\b/i.test(stripSql(rollbackSql)), false);
assert.equal(/DELETE\s+FROM/i.test(stripSql(rollbackSql)), false);
assert.match(lockSql, /history_lock_installed/);
assert.match(lockSql, /history_lock_already_present/);
assert.match(lockSql, /history_lock_policy_missing/);
assert.match(rollbackSql, /history_lock_absent/);
assert.match(rollbackSql, /history_lock_rolled_back/);
assert.equal(/FROM\(['"]programs['"]\)\s*\.delete\(/.test(appSources), false);
assert.equal(/FROM\(['"]program_days['"]\)\s*\.delete\(/.test(appSources), false);
assert.equal(/FROM\(['"]program_exercises['"]\)\s*\.delete\(/.test(appSources), false);
assert.match(sessionSource, /\.from\('workout_sets'\)\s*\.delete\(\)/);
assert.match(sessionSource, /\.from\('workout_sessions'\)\s*\.delete\(\)[\s\S]*?\.is\('finished_at', null\)/);
assert.match(sessionSource, /\.update\(\{ finished_at: finishedAt \}\)[\s\S]*?\.is\('finished_at', null\)/);
assert.match(sessionSource, /\.eq\('is_completed', false\)/);
assert.match(flagsSql, /export const OWNED_PROGRAM_EDIT_ENABLED = RELEASE_CANDIDATE_FEATURES_ENABLED/);
assert.notEqual(process.env.EXPO_PUBLIC_SYNCSETREP_RC, '1');
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

function asUser(userId: string, statement: string) {
  return `
BEGIN;
SELECT set_config('request.jwt.claim.sub', '${userId}', true) \\gset
SET LOCAL ROLE authenticated;
${statement}
COMMIT;
`;
}

const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-history-lock-pg-'));
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
    INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}');
    INSERT INTO public.exercises (id, name) VALUES (1, 'Squat');
    INSERT INTO public.programs (id, user_id, name, is_active) OVERRIDING SYSTEM VALUE VALUES
      (1, '${userA}', 'History', true),
      (2, '${userB}', 'Other', true);
    INSERT INTO public.program_days (id, name, day_order, program_id) VALUES
      (1, 'Lower', 1, 1),
      (2, 'Unused', 2, 1),
      (3, 'Other day', 3, 2);
    INSERT INTO public.program_exercises (
      id, program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps
    ) VALUES
      (1, 1, 1, 1, 2, 5, 8),
      (2, 2, 1, 1, 2, 5, 8),
      (3, 3, 1, 1, 1, 5, 8);
    INSERT INTO public.workout_sessions (id, program_day_id, user_id, finished_at, notes) VALUES
      (1, 1, '${userA}', '2026-10-01 12:00:00+00', 'kept'),
      (2, 1, '${userA}', NULL, 'open'),
      (3, 3, '${userB}', NULL, 'other'),
      (4, 1, '${userA}', '2026-10-02 12:00:00+00', 'sacrifice'),
      (5, 1, '${userA}', NULL, 'finish-me');
    INSERT INTO public.workout_sets (id, workout_session_id, exercise_id, set_number, weight, reps, is_completed) VALUES
      (1, 1, 1, 1, 135, 5, true),
      (2, 1, 1, 2, 135, 5, true),
      (3, 2, 1, 1, 95, 8, true),
      (4, 2, 1, 2, 95, NULL, false),
      (5, 3, 1, 1, 45, 10, false),
      (6, 4, 1, 1, 100, 3, true),
      (7, 5, 1, 1, 115, 4, true);
    SELECT setval(pg_get_serial_sequence('public.exercises', 'id'), 1, true);
    SELECT setval(pg_get_serial_sequence('public.programs', 'id'), 2, true);
    SELECT setval(pg_get_serial_sequence('public.program_days', 'id'), 3, true);
    SELECT setval(pg_get_serial_sequence('public.program_exercises', 'id'), 3, true);
    SELECT setval(pg_get_serial_sequence('public.workout_sessions', 'id'), 5, true);
    SELECT setval(pg_get_serial_sequence('public.workout_sets', 'id'), 7, true);
  `, 'seed');

  const beforePolicies = await must(`
    SELECT md5(COALESCE(string_agg(format(
      '%s:%s', pol.polname, COALESCE(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '')
    ), ',' ORDER BY pol.polname), ''))
    FROM pg_catalog.pg_policy pol
    WHERE pol.polrelid IN (
      'public.workout_sessions'::regclass,
      'public.workout_sets'::regclass,
      'public.programs'::regclass,
      'public.program_days'::regclass,
      'public.program_exercises'::regclass
    );
  `, 'policies before');

  assert.equal(await must(asUser(userA, `
    WITH removed AS (
      DELETE FROM public.workout_sets WHERE id = 6 RETURNING id
    )
    SELECT count(*)::text FROM removed;
  `), 'pre-lock sacrifice set'), '1');
  assert.equal(await must(asUser(userA, `
    WITH removed AS (
      DELETE FROM public.workout_sessions WHERE id = 4 RETURNING id
    )
    SELECT count(*)::text FROM removed;
  `), 'pre-lock sacrifice session'), '1');
  assert.equal(await must(`SELECT count(*)::text FROM public.workout_sessions WHERE id = 4;`, 'sacrifice gone'), '0');

  const installed = await must(lockSql, 'install');
  assert.match(installed, /history_lock_installed/);
  await expectError(lockSql, /history_lock_already_present/, 'second install');

  async function historyShape() {
    return must(`
      SELECT id::text || ':' || reps::text || ':' || is_completed::text
      FROM public.workout_sets
      WHERE workout_session_id = 1
      ORDER BY id;
    `, 'finished sets');
  }
  const finishedSets = await historyShape();
  assert.equal(finishedSets, '1:5:true\n2:5:true');

  async function affected(statement: string) {
    return must(asUser(userA, `
      WITH changed AS (
        ${statement}
        RETURNING 1
      )
      SELECT count(*)::text FROM changed;
    `), statement);
  }

  assert.equal(await affected(`DELETE FROM public.workout_sets WHERE id = 1`), '0');
  assert.equal(await affected(`DELETE FROM public.workout_sessions WHERE id = 1`), '0');
  assert.equal(await affected(`UPDATE public.workout_sessions SET finished_at = NULL WHERE id = 1`), '0');
  assert.equal(await affected(`UPDATE public.workout_sessions SET notes = 'rewritten' WHERE id = 1`), '0');
  assert.equal(await affected(`UPDATE public.workout_sets SET reps = 99 WHERE id = 1`), '0');
  assert.equal(await must(asUser(userB, `
    WITH changed AS (
      DELETE FROM public.workout_sessions WHERE id = 2 RETURNING 1
    )
    SELECT count(*)::text FROM changed;
  `), 'cross user'), '0');
  await expectError(asUser(userA, `
    INSERT INTO public.workout_sets (workout_session_id, exercise_id, set_number, reps, is_completed)
    VALUES (1, 1, 3, 1, true);
  `), /row-level security policy/, 'insert into finished session');
  await expectError(asUser(userA, `
    UPDATE public.workout_sets SET workout_session_id = 1 WHERE id = 3;
  `), /row-level security policy/, 'move set onto finished session');
  await expectError(`
    BEGIN;
    SET LOCAL ROLE anon;
    DELETE FROM public.workout_sessions WHERE id = 1;
    COMMIT;
  `, /permission denied/, 'anon delete');

  assert.equal(await historyShape(), finishedSets);
  assert.equal(await must(`SELECT notes FROM public.workout_sessions WHERE id = 1;`, 'notes unchanged'), 'kept');
  assert.equal(await must(`SELECT count(*)::text FROM public.workout_sets WHERE workout_session_id = 1;`, 'set count'), '2');

  assert.equal(await affected(`
    DELETE FROM public.workout_sets
    WHERE id = 4 AND workout_session_id = 2 AND is_completed = false
  `), '1');
  assert.equal(await affected(`UPDATE public.workout_sets SET reps = 9 WHERE id = 3`), '1');
  assert.equal(await affected(`UPDATE public.workout_sessions SET notes = 'still open' WHERE id = 2`), '1');
  await must(asUser(userA, `
    INSERT INTO public.workout_sets (workout_session_id, exercise_id, set_number, reps, is_completed)
    VALUES (2, 1, 3, 6, false);
  `), 'insert unfinished set');
  const inserted = await must(`
    SELECT count(*)::text FROM public.workout_sets
    WHERE workout_session_id = 2 AND set_number = 3;
  `, 'inserted row');
  assert.equal(inserted, '1');
  assert.equal(await affected(`DELETE FROM public.workout_sets WHERE workout_session_id = 2`), '2');
  assert.equal(await affected(`
    DELETE FROM public.workout_sessions
    WHERE id = 2 AND user_id = '${userA}'::uuid AND finished_at IS NULL
  `), '1');
  assert.equal(await must(`SELECT count(*)::text FROM public.workout_sessions WHERE id = 2;`, 'discarded'), '0');

  assert.equal(await affected(`
    UPDATE public.workout_sessions
    SET finished_at = '2026-11-02 18:00:00+00'
    WHERE id = 5 AND finished_at IS NULL
  `), '1');
  assert.equal(await affected(`DELETE FROM public.workout_sets WHERE workout_session_id = 5`), '0');
  assert.equal(await affected(`DELETE FROM public.workout_sessions WHERE id = 5`), '0');
  assert.equal(await must(`
    SELECT finished_at IS NOT NULL
    FROM public.workout_sessions WHERE id = 5;
  `, 'stayed finished'), 't');
  assert.equal(await historyShape(), finishedSets);

  await expectError(asUser(userA, `DELETE FROM public.program_days WHERE id = 1;`), /foreign key constraint/, 'day with history');
  assert.equal(await affected(`DELETE FROM public.program_exercises WHERE program_day_id = 1`), '1');
  assert.equal(await must(`SELECT count(*)::text FROM public.workout_sets WHERE workout_session_id = 1;`, 'sets after exercise delete'), '2');
  assert.equal(await affected(`DELETE FROM public.program_days WHERE id = 2`), '1');
  assert.equal(await must(`SELECT count(*)::text FROM public.program_exercises WHERE program_day_id = 2;`, 'cascaded empty day'), '0');
  await expectError(asUser(userA, `DELETE FROM public.programs WHERE id = 1;`), /foreign key constraint/, 'program with history day');
  assert.equal(await must(asUser(userB, `
    WITH removed AS (
      DELETE FROM public.workout_sets WHERE workout_session_id = 3 RETURNING 1
    )
    SELECT count(*)::text FROM removed;
  `), 'other user discards sets'), '1');
  assert.equal(await must(asUser(userB, `
    WITH removed AS (
      DELETE FROM public.workout_sessions WHERE id = 3 AND finished_at IS NULL RETURNING 1
    )
    SELECT count(*)::text FROM removed;
  `), 'other user discards session'), '1');

  await must(`
    INSERT INTO public.program_days (id, name, day_order, program_id) VALUES (4, 'Fresh', 4, 1);
    INSERT INTO public.program_exercises (
      id, program_day_id, exercise_id, exercise_order, target_sets
    ) VALUES (4, 4, 1, 1, 1);
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
  assert.equal(await must(`SELECT count(*)::text FROM public.program_days WHERE id = 4;`, 'empty day removed by owner'), '0');
  assert.equal(await must(`SELECT count(*)::text FROM public.program_days WHERE id = 1;`, 'history day kept by predicate'), '1');

  await must(`
    INSERT INTO public.workout_sessions (id, program_day_id, user_id, finished_at)
    VALUES (6, 1, '${userA}', '2026-10-03 12:00:00+00');
    INSERT INTO public.workout_sets (id, workout_session_id, exercise_id, set_number, reps, is_completed)
    VALUES (8, 6, 1, 1, 1, true);
    DELETE FROM public.workout_sessions WHERE id = 6;
  `, 'owner bypass');
  assert.equal(await must(`SELECT count(*)::text FROM public.workout_sets WHERE id = 8;`, 'owner cascade removed the copy'), '0');

  await must(`ALTER ROLE service_role BYPASSRLS;`, 'mirror hosted service role');
  await must(`
    INSERT INTO public.workout_sessions (id, program_day_id, user_id, finished_at)
    VALUES (7, 1, '${userA}', '2026-10-04 12:00:00+00');
  `, 'service copy');
  assert.equal(await must(`
    BEGIN;
    SET LOCAL ROLE service_role;
    WITH removed AS (
      DELETE FROM public.workout_sessions WHERE id = 7 RETURNING 1
    )
    SELECT count(*)::text FROM removed;
    COMMIT;
  `, 'service role bypass'), '1');

  assert.equal(await historyShape(), finishedSets);
  assert.equal(await must(`
    SELECT has_table_privilege('authenticated', 'public.workout_sessions', 'DELETE')::text
      || ':' || has_table_privilege('authenticated', 'public.workout_sets', 'DELETE')::text
      || ':' || has_table_privilege('authenticated', 'public.programs', 'DELETE')::text;
  `, 'delete grants remain'), 'true:true:true');
  const policyFlags = await must(`
    SELECT string_agg(polname || ':' || polpermissive::text, ',' ORDER BY polname)
    FROM pg_catalog.pg_policy
    WHERE polname LIKE '%_unfinished';
  `, 'restrictive flags');
  assert.equal(policyFlags, [
    'workout_sessions_delete_unfinished:false',
    'workout_sessions_update_unfinished:false',
    'workout_sets_delete_unfinished:false',
    'workout_sets_insert_unfinished:false',
    'workout_sets_update_unfinished:false',
  ].join(','));

  const rolled = await must(rollbackSql, 'rollback');
  assert.match(rolled, /history_lock_rolled_back/);
  await expectError(rollbackSql, /history_lock_absent/, 'second rollback');
  assert.equal(await affected(`DELETE FROM public.workout_sets WHERE workout_session_id = 5`), '1');
  assert.equal(await affected(`DELETE FROM public.workout_sessions WHERE id = 5`), '1');
  const restored = await must(lockSql, 'reinstall');
  assert.match(restored, /history_lock_installed/);
  await must(`
    INSERT INTO public.workout_sessions (id, program_day_id, user_id, finished_at)
    VALUES (9, 1, '${userA}', '2026-10-05 12:00:00+00');
    INSERT INTO public.workout_sets (id, workout_session_id, exercise_id, set_number, reps, is_completed)
    VALUES (9, 9, 1, 1, 2, true);
  `, 'post-rollback finished copy');
  assert.equal(await affected(`DELETE FROM public.workout_sessions WHERE id = 9`), '0');
  assert.equal(await must(`SELECT count(*)::text FROM public.workout_sets WHERE id = 9;`, 'copy set remains'), '1');
  assert.equal(await historyShape(), finishedSets);

  const afterPolicies = await must(`
    SELECT md5(COALESCE(string_agg(format(
      '%s:%s', pol.polname, COALESCE(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '')
    ), ',' ORDER BY pol.polname), ''))
    FROM pg_catalog.pg_policy pol
    WHERE pol.polname NOT LIKE '%_unfinished'
      AND pol.polrelid IN (
        'public.workout_sessions'::regclass,
        'public.workout_sets'::regclass,
        'public.programs'::regclass,
        'public.program_days'::regclass,
        'public.program_exercises'::regclass
      );
  `, 'original policies');
  assert.equal(afterPolicies, beforePolicies);

  console.log('history lock checks passed; finished sets preserved: 1:5:true,2:5:true');
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
