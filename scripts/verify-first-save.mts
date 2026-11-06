import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = 55454;
const database = 'syncsetrep_first_save';
if (host !== '127.0.0.1' || port === 5432 || port === 6543) {
  throw new Error('refusing non-disposable database');
}

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const userC = '33333333-3333-4333-8333-333333333333';
const userD = '44444444-4444-4444-8444-444444444444';
const userE = '55555555-5555-4555-8555-555555555555';
const requestB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestC = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');

const forwardSql = await readFile(join(root, 'sql/program-first-save-idempotency.sql'), 'utf8');
const plannedSql = await readFile(join(root, 'sql/program-exercise-planned-weight.sql'), 'utf8');

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
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.save_imported_program/i.test(forwardSql), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.update_owned_program/i.test(forwardSql), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.save_manual_program/i.test(forwardSql), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.record_tracked_set/i.test(forwardSql), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.activate_owned_program/i.test(forwardSql), false);
assert.match(forwardSql, /first_save_idempotency_already_present/);
assert.match(forwardSql, /planned_weight_required/);
assert.match(forwardSql, /first_save_idempotent_installed/);
const ownedBody = stripSql(body(forwardSql, 'save_owned'));
assert.equal(ownedBody.includes('workout_sessions'), false);
assert.equal(ownedBody.includes('workout_sets'), false);
assert.equal(/\bUPDATE\s+(public|programs|program_days|program_exercises)\b/i.test(ownedBody), false);
assert.equal(/\bDELETE\s+FROM\b/i.test(ownedBody), false);
assert.equal(/\bTRUNCATE\b/i.test(ownedBody), false);
assert.match(ownedBody, /client_request_id/);
assert.match(ownedBody, /planned_weight_unit/);
assert.equal(plannedSql.includes('first_save_idempotent'), false);

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
    max_reps: 12,
    notes: 'Old',
    ...extra,
  };
}

function program(name: string, requestId: string | null, exerciseRows: Record<string, unknown>[]) {
  return {
    name,
    ...(requestId ? { client_request_id: requestId } : {}),
    days: [{ name: 'Day 1', subtitle: null, exercises: exerciseRows }],
  };
}

const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-first-save-pg-'));
const logFile = join(dataDir, 'server.log');
let started = false;

try {
  const initialized = await run(initdbPath, ['-D', dataDir, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--no-locale']);
  assert.equal(initialized.code, 0, initialized.stderr);
  await writeFile(join(dataDir, 'postgresql.conf'), `\nlisten_addresses = '${host}'\nport = ${port}\n`, { flag: 'a' });
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
  ]) {
    const applied = await psql(await readFile(join(root, name), 'utf8'));
    assert.equal(applied.code, 0, `${name}\n${applied.stderr}`);
  }

  await must(`
    INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}'), ('${userC}'), ('${userD}'), ('${userE}');
    INSERT INTO public.exercises (name) VALUES ('Bench'), ('Row'), ('Squat'), ('Press');
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
        || ':' || (SELECT weight::text || ':' || reps::text FROM public.workout_sets WHERE id = 1)
        || ':' || (SELECT finished_at::text FROM public.workout_sessions WHERE id = 1)
        || ':' || (SELECT finished_at IS NULL FROM public.workout_sessions WHERE id = 2)::text;
    `, 'history');
  }

  const beforeHistory = await historyText();
  assert.equal(beforeHistory, '2:1:135.5:5:2026-11-01 13:00:00+00:true');
  const sessionsBefore = await fingerprint('workout_sessions');
  const setsBefore = await fingerprint('workout_sets');
  const planned = await must(plannedSql, 'planned weight');
  assert.match(planned, /planned_weight_installed/);
  const installed = await must(forwardSql, 'first save install');
  assert.match(installed, /first_save_idempotent_installed/);
  await expectError(forwardSql, /first_save_idempotency_already_present/, 'second install');
  assert.equal(await fingerprint('workout_sessions'), sessionsBefore);
  assert.equal(await fingerprint('workout_sets'), setsBefore);
  assert.equal(await historyText(), beforeHistory);
  assert.equal(await must(`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'programs' AND column_name = 'client_request_id';
  `, 'request column'), 'YES');
  assert.match(await must(`
    SELECT indexdef FROM pg_catalog.pg_indexes WHERE indexname = 'programs_user_client_request_uidx';
  `, 'request index'), /UNIQUE/i);
  const unchanged = [
    'update_owned_program(jsonb)',
    'save_manual_program(jsonb)',
    'save_imported_program(jsonb)',
    'activate_owned_program(bigint)',
    'record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)',
  ];
  const plannedSources = new Map<string, string>();
  for (const signature of unchanged) {
    plannedSources.set(signature, await must(
      `SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.${signature}');`,
      signature,
    ));
  }
  assert.equal(await must(`
    SELECT has_function_privilege('authenticated', 'public.save_owned_program(jsonb, boolean)', 'EXECUTE')::text
      || ':' || has_function_privilege('anon', 'public.save_owned_program(jsonb, boolean)', 'EXECUTE')::text
      || ':' || has_function_privilege('public', 'public.save_owned_program(jsonb, boolean)', 'EXECUTE')::text;
  `, 'owned privilege'), 'true:false:false');
  assert.equal(await must(`
    SELECT (strpos(prosrc, 'workout_sessions') = 0 AND strpos(prosrc, 'workout_sets') = 0)::text
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.save_owned_program(jsonb, boolean)');
  `, 'owned history names'), 'true');

  async function programCount(userId: string) {
    return must(`SELECT count(*)::text FROM public.programs WHERE user_id = '${userId}';`, `programs ${userId}`);
  }

  async function rejects(userId: string, plan: unknown, pattern: RegExp, label: string) {
    const beforeCount = await programCount(userId);
    const before = await historyText();
    await expectError(
      asUser(userId, `SELECT public.save_owned_program(${payload(plan)}, true);`),
      pattern,
      label,
    );
    assert.equal(await programCount(userId), beforeCount, label);
    assert.equal(await historyText(), before, label);
  }

  const bad = (row: Record<string, unknown>) => program('Rejected', null, [{ ...exercise(1), ...row }]);
  await rejects(userB, bad({ planned_weight: 2001 }), /invalid_import: planned_weight/, '2001');
  await rejects(userB, bad({ planned_weight: -1 }), /invalid_import: planned_weight/, '-1');
  await rejects(userB, bad({ planned_weight: '1e2' }), /invalid_import: planned_weight/, '1e2');
  await rejects(userB, bad({ planned_weight: '135.' }), /invalid_import: planned_weight/, '135.');
  await rejects(userB, bad({ planned_weight: null, planned_weight_unit: 'lb' }), /invalid_import: planned_weight/, 'unit with null weight');
  await rejects(userB, bad({ planned_weight: 10, planned_weight_unit: 'LB' }), /invalid_import: planned_weight_unit/, 'LB');
  await rejects(userB, bad({ planned_weight: 10, planned_weight_unit: 'lbs' }), /invalid_import: planned_weight_unit/, 'lbs');
  await rejects(userB, bad({ planned_weight: true }), /invalid_import: planned_weight/, 'boolean');
  await rejects(userB, bad({ planned_weight: { n: 1 } }), /invalid_import: planned_weight/, 'object');
  await rejects(userB, bad({ notes: 'n'.repeat(281), planned_weight: 10 }), /invalid_import: notes/, 'notes 281');
  await rejects(userB, bad({ rest_seconds: 601 }), /invalid_import: rest/, 'rest 601');
  await rejects(userB, bad({ load_mode: 'added' }), /invalid_import: exercise_field/, 'load mode');
  await rejects(userB, { ...program('Bad key', null, [exercise(1)]), client_request_id: 'not-a-uuid' }, /invalid_import: client_request_id/, 'bad key');
  assert.equal(await programCount(userB), '0');

  const firstPlan = program('First', requestB, [
    exercise(1, { notes: 'Bench', rest_seconds: 90, planned_weight: 135.5 }),
    exercise(2, { notes: 'Row', planned_weight: '60', planned_weight_unit: 'kg' }),
    exercise(3, { notes: 'Squat', planned_weight: 0, planned_weight_unit: 'lb' }),
    exercise(4, { notes: 'Press', planned_weight: '2000.000', planned_weight_unit: null }),
  ]);
  const firstId = await must(
    asUser(userB, `SELECT public.save_owned_program(${payload(firstPlan)}, true);`),
    'first program',
  );
  assert.equal(await must(`
    SELECT name || ':' || is_active::text || ':' || client_request_id::text
    FROM public.programs WHERE id = ${firstId};
  `, 'stored first program'), `First:true:${requestB}`);
  assert.equal(await must(`
    SELECT coalesce(string_agg(
      exercise_id::text || ':' || planned_weight::text || ':' || coalesce(planned_weight_unit, 'null')
      || ':' || coalesce(rest_seconds::text, 'null') || ':' || (planned_weight = 2000)::text,
      ',' ORDER BY exercise_order
    ), '')
    FROM public.program_exercises
    WHERE program_day_id IN (SELECT id FROM public.program_days WHERE program_id = ${firstId});
  `, 'stored plans'), '1:135.5:null:90:false,2:60:kg:null:false,3:0:lb:null:false,4:2000.000:null:null:true');
  const storedStamp = await must(`SELECT updated_at::text FROM public.programs WHERE id = ${firstId};`, 'stamp');
  const storedRows = await must(`
    SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY t.id), ''))
    FROM public.program_exercises t
    WHERE program_day_id IN (SELECT id FROM public.program_days WHERE program_id = ${firstId});
  `, 'exercise fingerprint');
  const userAActive = await must(`SELECT id::text || ':' || is_active::text FROM public.programs WHERE user_id = '${userA}';`, 'user A before retry');

  const retryId = await must(asUser(userB, `
    SELECT public.save_owned_program(${payload({
      client_request_id: requestB,
      name: 'Changed after crash',
      days: [{ name: 'Other', subtitle: null, exercises: [exercise(2, { notes: 'Overwrite', planned_weight: 40, planned_weight_unit: 'lb' })] }],
    })}, true);
  `), 'duplicate submission');
  assert.equal(retryId, firstId);
  assert.equal(await programCount(userB), '1');
  assert.equal(await must(`
    SELECT name || ':' || is_active::text || ':' || client_request_id::text
    FROM public.programs WHERE id = ${firstId};
  `, 'retry leaves program'), `First:true:${requestB}`);
  assert.equal(await must(`SELECT updated_at::text FROM public.programs WHERE id = ${firstId};`, 'stamp after retry'), storedStamp);
  assert.equal(await must(`
    SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY t.id), ''))
    FROM public.program_exercises t
    WHERE program_day_id IN (SELECT id FROM public.program_days WHERE program_id = ${firstId});
  `, 'exercises after retry'), storedRows);
  assert.equal(await must(`SELECT count(*)::text FROM public.programs WHERE user_id = '${userB}' AND is_active;`, 'one current'), '1');
  assert.equal(await must(`SELECT id::text || ':' || is_active::text FROM public.programs WHERE user_id = '${userA}';`, 'user A after retry'), userAActive);

  const invalidRetry = await must(asUser(userB, `
    SELECT public.save_owned_program(${payload({ client_request_id: requestB, name: '' })}, true);
  `), 'invalid retry returns stored id');
  assert.equal(invalidRetry, firstId);
  assert.equal(await must(`SELECT name FROM public.programs WHERE id = ${firstId};`, 'name after invalid retry'), 'First');

  const userACount = await programCount(userA);
  await expectError(asUser(userA, `
    SELECT public.save_owned_program(${payload(program('Other account', requestB, [exercise(1, { notes: 'Nope' })]))}, true);
  `), /active_program_exists/, 'other account key');
  assert.equal(await programCount(userA), userACount);
  assert.equal(await programCount(userB), '1');
  assert.equal(await must(`SELECT client_request_id::text FROM public.programs WHERE user_id = '${userA}';`, 'user A has no borrowed key'), '');

  const interrupted = await psql(`
BEGIN;
SELECT set_config('request.jwt.claim.sub', '${userC}', true);
SET LOCAL ROLE authenticated;
SELECT public.save_owned_program(${payload(program('Rolled back', requestC, [exercise(1, { notes: 'Temp', planned_weight: 10, planned_weight_unit: 'lb' })] ))}, true);
ROLLBACK;
`);
  assert.equal(interrupted.code, 0, interrupted.stderr);
  assert.equal(await programCount(userC), '0');
  const resumed = await must(asUser(userC, `
    SELECT public.save_owned_program(${payload(program('Rolled back', requestC, [exercise(1, { notes: 'Temp', planned_weight: 10, planned_weight_unit: 'lb' })] ))}, true);
  `), 'resume after rollback');
  assert.equal(await programCount(userC), '1');
  assert.equal(await must(`
    SELECT planned_weight::text || ':' || planned_weight_unit
    FROM public.program_exercises
    WHERE program_day_id IN (SELECT id FROM public.program_days WHERE program_id = ${resumed});
  `, 'resumed plan'), '10:lb');

  const omitted = await must(asUser(userE, `
    SELECT public.save_owned_program(${payload(program('No plan', null, [exercise(1, { notes: 'Plain' })] ))}, false);
  `), 'omitted plan');
  const omittedAgain = await must(asUser(userE, `
    SELECT public.save_owned_program(${payload(program('No plan again', null, [exercise(2, { notes: 'Second' })] ))}, false);
  `), 'second omitted plan');
  assert.notEqual(omitted, omittedAgain);
  assert.equal(await programCount(userE), '2');
  assert.equal(await must(`
    SELECT (planned_weight IS NULL AND planned_weight_unit IS NULL AND client_request_id IS NULL)::text
    FROM public.programs AS programs
    JOIN public.program_days AS days ON days.program_id = programs.id
    JOIN public.program_exercises AS exercises ON exercises.program_day_id = days.id
    WHERE programs.id = ${omitted};
  `, 'omitted values'), 'true');

  const concurrentPlan = program('Race', requestD, [exercise(1, { notes: 'Race', planned_weight: 15, planned_weight_unit: 'kg' })]);
  const concurrentSql = asUser(userD, `SELECT public.save_owned_program(${payload(concurrentPlan)}, true);`);
  const [left, right] = await Promise.all([psql(concurrentSql), psql(concurrentSql)]);
  assert.equal(left.code, 0, left.stderr);
  assert.equal(right.code, 0, right.stderr);
  assert.equal(left.stdout.replace(/\r/g, '').trim(), right.stdout.replace(/\r/g, '').trim());
  assert.equal(await programCount(userD), '1');
  assert.equal(await must(`
    SELECT count(*)::text FROM public.program_exercises
    WHERE program_day_id IN (
      SELECT id FROM public.program_days WHERE program_id IN (
        SELECT id FROM public.programs WHERE user_id = '${userD}'
      )
    );
  `, 'concurrent exercises'), '1');

  assert.equal(await historyText(), beforeHistory);
  assert.equal(await fingerprint('workout_sessions'), sessionsBefore);
  assert.equal(await fingerprint('workout_sets'), setsBefore);
  for (const signature of unchanged) {
    assert.equal(await must(
      `SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.${signature}');`,
      `${signature} unchanged`,
    ), plannedSources.get(signature));
  }
  console.log('first save checks passed');
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
