import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = 55459;
const database = 'syncsetrep_unspecified_targets';
if (host !== '127.0.0.1' || port === 5432 || port === 6543 || (port >= 55450 && port <= 55458)) {
  throw new Error('refusing non-disposable database');
}

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const userC = '33333333-3333-4333-8333-333333333333';
const requestB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');

const forwardSql = await readFile(join(root, 'sql/program-unspecified-targets.sql'), 'utf8');
const rollbackSql = await readFile(join(root, 'sql/program-unspecified-targets-rollback.sql'), 'utf8');
const hash = createHash('sha256').update(forwardSql).digest('hex');
const rollbackHash = createHash('sha256').update(rollbackSql).digest('hex');

function stripSql(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

function body(sql: string, tag: string) {
  const open = `AS $${tag}$`;
  const start = sql.indexOf(open);
  const from = start + open.length;
  const end = sql.indexOf(`$${tag}$;`, from);
  assert.ok(start >= 0 && end > from, tag);
  return sql.slice(from, end).replace(/\r\n/g, '\n');
}

assert.equal(forwardSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(/\bGRANT\b/i.test(stripSql(forwardSql)), false);
assert.equal(/\bREVOKE\b/i.test(stripSql(forwardSql)), false);
assert.equal(/\bDROP\s+FUNCTION\b/i.test(stripSql(forwardSql)), false);
assert.match(forwardSql, /ALTER COLUMN target_sets DROP NOT NULL/);
assert.match(forwardSql, /ALTER COLUMN min_reps DROP NOT NULL/);
assert.match(forwardSql, /ALTER COLUMN max_reps DROP NOT NULL/);
assert.match(forwardSql, /unspecified_targets_already_present/);
assert.match(forwardSql, /unspecified_targets_installed/);
assert.match(forwardSql, /day_count > 8/);
assert.equal(/day_count > 16/.test(forwardSql), false);
assert.match(forwardSql, /exercise_owner_required/);
assert.match(forwardSql, /activate_owned_program_required/);
const ownedSource = body(forwardSql, 'save_owned');
const ownedBody = stripSql(ownedSource);
assert.match(ownedSource, /invalid_import: exercise_owner/);
assert.equal(ownedSource.split('PERFORM public.activate_owned_program(existing_program_id);').length - 1, 3);
assert.equal(ownedBody.includes('workout_sessions'), false);
assert.equal(ownedBody.includes('workout_sets'), false);
assert.equal(/\bTRUNCATE\b/i.test(ownedBody), false);
assert.equal(/\bDELETE\s+FROM\b/i.test(ownedBody), false);
assert.match(ownedSource, /unspecified_targets_v1/);
assert.match(ownedSource, /first_save_idempotent/);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.(save_imported_program|update_owned_program|record_tracked_set)/i.test(forwardSql), false);
assert.equal(rollbackSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(/\bGRANT\b/i.test(stripSql(rollbackSql)), false);
assert.equal(/\bREVOKE\b/i.test(stripSql(rollbackSql)), false);
assert.match(rollbackSql, /unspecified_targets_rollback_blocked/);
assert.match(rollbackSql, /unspecified_targets_not_present/);
assert.match(rollbackSql, /ALTER COLUMN target_sets SET NOT NULL/);
assert.match(rollbackSql, /ALTER COLUMN min_reps SET NOT NULL/);
assert.match(rollbackSql, /ALTER COLUMN max_reps SET NOT NULL/);
assert.match(rollbackSql, /day_count > 7/);
assert.equal(stripSql(rollbackSql).includes('workout_sessions'), false);
assert.equal(stripSql(rollbackSql).includes('workout_sets'), false);
assert.equal(rollbackSql.includes('unspecified_targets_v1'), true);

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
    ['-h', host, '-p', String(port), '-U', 'postgres', '-d', databaseName, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-q'],
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

function payload(json: unknown) {
  return `$payload$${JSON.stringify(json)}$payload$::jsonb`;
}

function exercise(id: number, extra: Record<string, unknown> = {}) {
  return {
    exercise_id: id,
    target_sets: 3,
    min_reps: 8,
    max_reps: 8,
    notes: null,
    ...extra,
  };
}

const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-unspecified-pg-'));
const logFile = join(dataDir, 'server.log');
let started = false;

try {
  const initialized = await run(initdbPath, ['-D', dataDir, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  assert.equal(initialized.code, 0, initialized.stderr);
  await writeFile(join(dataDir, 'postgresql.conf'), `\nlisten_addresses = '${host}'\nport = ${port}\n`, { flag: 'a' });
  const startedResult = await run(pgCtlPath, ['-D', dataDir, '-l', logFile, '-w', 'start']);
  assert.equal(startedResult.code, 0, `${startedResult.stderr}\n${await readFile(logFile, 'utf8').catch(() => '')}`);
  started = true;

  const createdDb = await psql(`CREATE DATABASE ${database};`, 'postgres');
  assert.equal(createdDb.code, 0, createdDb.stderr);

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

  for (const name of [
    'scripts/fixtures/production-shape.sql',
    'sql/ai-import-day-order.sql',
    'sql/ai-import-save-program.sql',
    'sql/load-mode.sql',
    'sql/program-day-archive.sql',
    'sql/exercise-ownership.sql',
    'sql/routine-edit.sql',
    'sql/program-activation.sql',
    'sql/program-activation-privilege.sql',
    'sql/program-exercise-rest.sql',
    'sql/routine-rest-preserve.sql',
    'sql/program-exercise-planned-weight.sql',
    'sql/program-first-save-idempotency.sql',
  ]) {
    const applied = await psql(await readFile(join(root, name), 'utf8'));
    assert.equal(applied.code, 0, `${name}\n${applied.stderr}`);
  }

  await must(`
    INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}'), ('${userC}');
    INSERT INTO public.exercises (name) VALUES
      ('Bench'), ('Row'), ('Squat'), ('Curl'), ('Raise'), ('Fly'), ('Pulldown');
    INSERT INTO public.programs (user_id, name, slug, is_active)
    VALUES ('${userA}', 'Home', NULL, true);
    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (1, 'Push', NULL, 1);
    INSERT INTO public.program_exercises (
      program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps, notes, rest_seconds
    ) VALUES (1, 1, 1, 3, 8, 12, 'Old', 90);
    INSERT INTO public.workout_sessions (user_id, program_day_id, started_at, finished_at)
    VALUES
      ('${userA}', 1, '2026-11-01 12:00:00+00', '2026-11-01 13:00:00+00'),
      ('${userA}', NULL, '2026-11-02 12:00:00+00', NULL);
    INSERT INTO public.workout_sets (
      workout_session_id, exercise_id, set_number, weight, reps, is_completed
    ) VALUES (1, 1, 1, 135.5, 5, true);
  `, 'seed');

  async function fingerprint(table: string) {
    return must(
      `SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY t.id), '')) FROM public.${table} t;`,
      table,
    );
  }

  async function historyText() {
    return must(`
      SELECT
        (SELECT count(*) FROM public.workout_sessions)::text
        || ':' || (SELECT count(*) FROM public.workout_sets)::text
        || ':' || (SELECT weight::text || ':' || reps::text || ':' || is_completed::text FROM public.workout_sets WHERE id = 1)
        || ':' || (SELECT finished_at::text FROM public.workout_sessions WHERE id = 1)
        || ':' || (SELECT finished_at IS NULL FROM public.workout_sessions WHERE id = 2)::text;
    `, 'history');
  }

  async function functionMd5(signature: string) {
    return must(
      `SELECT md5(pg_get_functiondef(oid)) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.${signature}');`,
      signature,
    );
  }

  async function programCount(userId: string) {
    return must(`SELECT count(*)::text FROM public.programs WHERE user_id = '${userId}';`, userId);
  }

  const historyBefore = await historyText();
  const sessionsBefore = await fingerprint('workout_sessions');
  const setsBefore = await fingerprint('workout_sets');
  const importedBefore = await functionMd5('save_imported_program(jsonb)');
  const updateBefore = await functionMd5('update_owned_program(jsonb)');
  const trackedBefore = await functionMd5('record_tracked_set(bigint, bigint, integer, text, numeric, numeric, text, integer, integer, boolean)');
  assert.equal(historyBefore, '2:1:135.5:5:true:2026-11-01 13:00:00+00:true');
  assert.equal(await must(`
    SELECT a.attnotnull::text
    FROM pg_attribute a
    WHERE a.attrelid = 'public.program_exercises'::regclass
      AND a.attname = 'target_sets'
      AND a.attnum > 0
      AND NOT a.attisdropped;
  `, 'target sets required'), 'true');

  const updated = await must(asUser(userA, `
    UPDATE public.program_exercises
    SET target_sets = 4, min_reps = 6, max_reps = 6
    WHERE id = 1
    RETURNING target_sets::text || ':' || min_reps::text || ':' || max_reps::text;
  `), 'update existing targets');
  assert.equal(updated, '4:6:6');
  assert.equal(await historyText(), historyBefore);

  const nullPlan = {
    name: 'Imported routine',
    client_request_id: requestB,
    days: [
      { name: 'Legs', subtitle: null, exercises: [exercise(3, { target_sets: null, min_reps: null, max_reps: null })] },
      {
        name: 'Abs',
        subtitle: 'Not on the weekly schedule',
        exercises: [exercise(4, { target_sets: null, min_reps: 5, max_reps: 5, notes: 'each' })],
      },
    ],
  };
  const weekNames = ['Push', 'Pull', 'Legs', 'Rest', 'Upper body', 'Legs Arms', 'Rest', 'Abs'];
  const weekPlan = {
    name: 'Imported routine',
    client_request_id: requestC,
    days: weekNames.map((name, index) => {
      if (name === 'Rest' || name === 'Upper body' || name === 'Legs Arms') {
        return { name, subtitle: null, exercises: [] };
      }
      if (name === 'Legs') {
        return { name, subtitle: null, exercises: [exercise(3, { target_sets: null, min_reps: null, max_reps: null })] };
      }
      if (name === 'Abs') {
        return {
          name,
          subtitle: 'Not on the weekly schedule',
          exercises: [exercise(4, { target_sets: null, min_reps: 5, max_reps: 5, notes: 'each' })],
        };
      }
      return { name, subtitle: null, exercises: [exercise(index + 1)] };
    }),
  };

  await expectError(
    asUser(userB, `SELECT public.save_owned_program(${payload(nullPlan)}, true);`),
    /invalid_import: sets/,
    'null sets before migration',
  );
  await expectError(
    asUser(userC, `SELECT public.save_owned_program(${payload(weekPlan)}, true);`),
    /invalid_import: day_count/,
    'eight days before migration',
  );
  await expectError(`
    INSERT INTO public.program_exercises (
      program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps
    ) VALUES (1, 2, 2, NULL, NULL, NULL);
  `, /null value in column "target_sets"/, 'null column before migration');
  assert.equal(await programCount(userB), '0');
  assert.equal(await programCount(userC), '0');

  const installed = await must(forwardSql, 'install unspecified targets');
  assert.match(installed, /unspecified_targets_installed/);
  assert.equal(await must(`
    SELECT string_agg(a.attname || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    FROM pg_attribute a
    WHERE a.attrelid = 'public.program_exercises'::regclass
      AND a.attname IN ('target_sets', 'min_reps', 'max_reps')
      AND a.attnum > 0
      AND NOT a.attisdropped;
  `, 'nullable targets'), 'max_reps:false,min_reps:false,target_sets:false');

  const savedNull = await must(
    asUser(userB, `SELECT public.save_owned_program(${payload(nullPlan)}, true);`),
    'save null targets',
  );
  const savedAgain = await must(
    asUser(userB, `SELECT public.save_owned_program(${payload(nullPlan)}, true);`),
    'retry null targets',
  );
  assert.equal(savedAgain, savedNull);
  assert.equal(await programCount(userB), '1');
  assert.equal(await must(`
    SELECT d.name || ':' || coalesce(e.target_sets::text, 'null') || ':' || coalesce(e.min_reps::text, 'null')
      || ':' || coalesce(e.max_reps::text, 'null') || ':' || coalesce(e.notes, '')
    FROM public.program_days d
    JOIN public.program_exercises e ON e.program_day_id = d.id
    WHERE d.program_id = ${savedNull}
    ORDER BY d.day_order, e.exercise_order;
  `, 'stored null targets'), 'Legs:null:null:null:\nAbs:null:5:5:each');

  const savedWeek = await must(
    asUser(userC, `SELECT public.save_owned_program(${payload(weekPlan)}, true);`),
    'save eight days',
  );
  assert.equal(await must(`
    SELECT string_agg(name, '>' ORDER BY day_order) || ':' || count(*)::text
    FROM public.program_days
    WHERE program_id = ${savedWeek};
  `, 'week order'), 'Push>Pull>Legs>Rest>Upper body>Legs Arms>Rest>Abs:8');
  assert.equal(await must(`
    SELECT coalesce(e.target_sets::text, 'null') || ':' || coalesce(e.min_reps::text, 'null')
    FROM public.program_days d
    JOIN public.program_exercises e ON e.program_day_id = d.id
    WHERE d.program_id = ${savedWeek} AND d.name = 'Legs';
  `, 'week legs'), 'null:null');

  const beforeRejects = await programCount(userC);
  await expectError(
    asUser(userC, `SELECT public.save_owned_program(${payload({
      name: 'Bad sets',
      days: [{ name: 'Push', subtitle: null, exercises: [exercise(1, { target_sets: 0 })] }],
    })}, false);`),
    /invalid_import: sets/,
    'zero sets',
  );
  await expectError(
    asUser(userC, `SELECT public.save_owned_program(${payload({
      name: 'Bad sets',
      days: [{ name: 'Push', subtitle: null, exercises: [exercise(1, { target_sets: 13 })] }],
    })}, false);`),
    /invalid_import: sets/,
    'thirteen sets',
  );
  await expectError(
    asUser(userC, `SELECT public.save_owned_program(${payload({
      name: 'Bad reps',
      days: [{ name: 'Push', subtitle: null, exercises: [exercise(1, { min_reps: 5, max_reps: null })] }],
    })}, false);`),
    /invalid_import: reps/,
    'one-sided reps',
  );
  await expectError(
    asUser(userC, `SELECT public.save_owned_program(${payload({
      name: 'Too many days',
      days: Array.from({ length: 9 }, (_item, index) => ({ name: `Day ${index + 1}`, subtitle: null, exercises: [] })),
    })}, false);`),
    /invalid_import: day_count/,
    'nine days',
  );
  assert.equal(await programCount(userC), beforeRejects);

  const legsId = await must(`
    SELECT e.id::text
    FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${savedWeek} AND d.name = 'Legs';
  `, 'legs id');
  const routineUpdate = await must(asUser(userC, `
    UPDATE public.program_exercises
    SET target_sets = 5, min_reps = 8, max_reps = 8
    WHERE id = ${legsId}
    RETURNING target_sets::text || ':' || min_reps::text || ':' || max_reps::text;
  `), 'save targets to one exercise');
  assert.equal(routineUpdate, '5:8:8');
  assert.equal(await must(`
    SELECT coalesce(e.target_sets::text, 'null') || ':' || coalesce(e.min_reps::text, 'null')
    FROM public.program_days d
    JOIN public.program_exercises e ON e.program_day_id = d.id
    WHERE d.program_id = ${savedWeek} AND d.name = 'Abs';
  `, 'abs unchanged'), 'null:5');
  assert.equal(await historyText(), historyBefore);
  assert.equal(await fingerprint('workout_sessions'), sessionsBefore);
  assert.equal(await fingerprint('workout_sets'), setsBefore);
  assert.equal(await functionMd5('save_imported_program(jsonb)'), importedBefore);
  assert.equal(await functionMd5('update_owned_program(jsonb)'), updateBefore);
  assert.equal(
    await functionMd5('record_tracked_set(bigint, bigint, integer, text, numeric, numeric, text, integer, integer, boolean)'),
    trackedBefore,
  );
  assert.match(await must(`
    SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.save_owned_program(jsonb, boolean)');
  `, 'marker'), /unspecified_targets_v1/);
  assert.equal((await must(`
    SELECT strpos(prosrc, 'unspecified_targets_v1')::text
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.update_owned_program(jsonb)');
  `, 'update untouched')).trim(), '0');

  await expectError(forwardSql, /unspecified_targets_already_present/, 'second apply');
  assert.equal(await historyText(), historyBefore);

  const requestRetry = 'dddddddd-dddd-4ddd-8ddd-dddddddddd11';
  const retryPlan = {
    name: 'Imported later',
    client_request_id: requestRetry,
    days: [{ name: 'Pull', subtitle: null, exercises: [exercise(2)] }],
  };
  const programsBeforeRetry = await programCount(userA);
  const inactiveId = await must(
    asUser(userA, `SELECT public.save_owned_program(${payload(retryPlan)}, false);`),
    'save inactive retry target',
  );
  assert.equal(await programCount(userA), String(Number(programsBeforeRetry) + 1));
  assert.equal(await must(`
    SELECT (is_active::text) FROM public.programs WHERE id = ${inactiveId};
  `, 'retry target starts inactive'), 'false');
  assert.equal(await must(`
    SELECT count(*)::text FROM public.programs WHERE user_id = '${userA}' AND is_active;
  `, 'original program stays current'), '1');
  const activatedId = await must(
    asUser(userA, `SELECT public.save_owned_program(${payload({ ...retryPlan, name: '' })}, true);`),
    'retry activates without a second insert',
  );
  assert.equal(activatedId, inactiveId);
  assert.equal(await programCount(userA), String(Number(programsBeforeRetry) + 1));
  assert.equal(await must(`
    SELECT is_active::text || ':' || name FROM public.programs WHERE id = ${inactiveId};
  `, 'stored program activated'), 'true:Imported later');
  assert.equal(await must(`
    SELECT count(*)::text FROM public.programs WHERE user_id = '${userA}' AND is_active;
  `, 'one active after retry'), '1');
  const activatedAgain = await must(
    asUser(userA, `SELECT public.save_owned_program(${payload(retryPlan)}, true);`),
    'second make-current retry',
  );
  assert.equal(activatedAgain, inactiveId);
  assert.equal(await programCount(userA), String(Number(programsBeforeRetry) + 1));
  const leftActive = await must(
    asUser(userA, `SELECT public.save_owned_program(${payload(retryPlan)}, false);`),
    'make-current false retry',
  );
  assert.equal(leftActive, inactiveId);
  assert.equal(await must(`
    SELECT is_active::text FROM public.programs WHERE id = ${inactiveId};
  `, 'false retry does not deactivate'), 'true');

  const privateId = await must(`
    INSERT INTO public.exercises (name, owner_user_id)
    VALUES ('Private Curl', '${userB}')
    RETURNING id::text;
  `, 'private exercise');
  const beforeCrossUser = await programCount(userA);
  await expectError(
    asUser(userA, `SELECT public.save_owned_program(${payload({
      name: 'Cross user',
      client_request_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd12',
      days: [{ name: 'Pull', subtitle: null, exercises: [exercise(Number(privateId))] }],
    })}, false);`),
    /invalid_import: exercise_owner/,
    'cross-user exercise',
  );
  assert.equal(await programCount(userA), beforeCrossUser);
  const ownedPrivate = await must(
    asUser(userB, `SELECT public.save_owned_program(${payload({
      name: 'Own private',
      client_request_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd13',
      days: [{ name: 'Pull', subtitle: null, exercises: [exercise(Number(privateId))] }],
    })}, false);`),
    'owner can save a private exercise',
  );
  assert.match(ownedPrivate, /^[1-9][0-9]*$/);
  await expectError(
    asUser(userA, `SELECT public.save_owned_program(${payload({
      name: 'Missing exercise',
      client_request_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd14',
      days: [{ name: 'Pull', subtitle: null, exercises: [exercise(99999)] }],
    })}, false);`),
    /invalid_import: unknown_exercise/,
    'unknown exercise',
  );
  assert.equal(await programCount(userA), beforeCrossUser);

  const activateBefore = await functionMd5('activate_owned_program(bigint)');
  await expectError(rollbackSql, /unspecified_targets_rollback_blocked/, 'rollback while null targets exist');
  assert.match(await must(`
    SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.save_owned_program(jsonb, boolean)');
  `, 'marker after blocked rollback'), /unspecified_targets_v1/);
  assert.equal(await must(`
    SELECT string_agg(a.attname || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    FROM pg_attribute a
    WHERE a.attrelid = 'public.program_exercises'::regclass
      AND a.attname IN ('target_sets', 'min_reps', 'max_reps')
      AND a.attnum > 0
      AND NOT a.attisdropped;
  `, 'columns stay nullable'), 'max_reps:false,min_reps:false,target_sets:false');
  await must(`
    UPDATE public.program_exercises
    SET target_sets = COALESCE(target_sets, 3),
        min_reps = COALESCE(min_reps, 8),
        max_reps = COALESCE(max_reps, 8);
  `, 'fill targets for rollback');
  const rolled = await must(rollbackSql, 'roll back unspecified targets');
  assert.match(rolled, /unspecified_targets_rolled_back/);
  assert.equal(await must(`
    SELECT string_agg(a.attname || ':' || a.attnotnull::text, ',' ORDER BY a.attname)
    FROM pg_attribute a
    WHERE a.attrelid = 'public.program_exercises'::regclass
      AND a.attname IN ('target_sets', 'min_reps', 'max_reps')
      AND a.attnum > 0
      AND NOT a.attisdropped;
  `, 'columns required again'), 'max_reps:true,min_reps:true,target_sets:true');
  const restored = await must(`
    SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.save_owned_program(jsonb, boolean)');
  `, 'restored function');
  assert.match(restored, /first_save_idempotent/);
  assert.equal(restored.includes('unspecified_targets_v1'), false);
  assert.match(restored, /day_count > 7/);
  const programsAfterRollback = await programCount(userC);
  await expectError(
    asUser(userC, `SELECT public.save_owned_program(${payload({
      ...weekPlan,
      client_request_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd16',
    })}, false);`),
    /invalid_import: day_count/,
    'eight days after rollback',
  );
  await expectError(
    asUser(userC, `SELECT public.save_owned_program(${payload({
      name: 'Null after rollback',
      client_request_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd15',
      days: [{ name: 'Legs', subtitle: null, exercises: [exercise(3, { target_sets: null, min_reps: null, max_reps: null })] }],
    })}, false);`),
    /invalid_import: sets/,
    'null sets after rollback',
  );
  assert.equal(await programCount(userC), programsAfterRollback);
  await expectError(rollbackSql, /unspecified_targets_not_present/, 'second rollback');
  assert.equal(await functionMd5('activate_owned_program(bigint)'), activateBefore);
  assert.equal(await functionMd5('save_imported_program(jsonb)'), importedBefore);
  assert.equal(await functionMd5('update_owned_program(jsonb)'), updateBefore);
  assert.equal(await historyText(), historyBefore);
  assert.equal(await fingerprint('workout_sessions'), sessionsBefore);
  assert.equal(await fingerprint('workout_sets'), setsBefore);
  console.log(`unspecified targets checks passed ${hash} rollback ${rollbackHash}`);
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
