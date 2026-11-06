import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const host = '127.0.0.1';
const port = 55453;
const database = 'syncsetrep_planned_weight';
if (host !== '127.0.0.1' || port === 5432 || port === 6543) {
  throw new Error('refusing non-disposable database');
}

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');

const forwardSql = await readFile(join(root, 'sql/program-exercise-planned-weight.sql'), 'utf8');
const rollbackSql = await readFile(join(root, 'sql/program-exercise-planned-weight-rollback.sql'), 'utf8');
const loadModeSql = await readFile(join(root, 'sql/load-mode.sql'), 'utf8');

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
assert.equal(rollbackSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(/\bGRANT\b/i.test(stripSql(forwardSql)), false);
assert.equal(/\bREVOKE\b/i.test(stripSql(forwardSql)), false);
assert.equal(/\bDROP\s+FUNCTION\b/i.test(stripSql(forwardSql)), false);
assert.equal(/\bGRANT\b/i.test(stripSql(rollbackSql)), false);
assert.equal(/\bREVOKE\b/i.test(stripSql(rollbackSql)), false);
assert.match(forwardSql, /planned_weight_already_present/);
assert.match(forwardSql, /planned_weight_installed/);
assert.match(rollbackSql, /planned_weight_rollback_blocked/);
assert.match(rollbackSql, /planned_weight_absent/);
assert.equal(loadModeSql.includes('planned_weight'), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.update_owned_program/i.test(forwardSql), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.save_manual_program/i.test(forwardSql), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.save_owned_program/i.test(forwardSql), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.record_tracked_set/i.test(forwardSql), false);

const saveBody = body(forwardSql, 'save');
const writeBody = stripSql(body(forwardSql, 'write'));
assert.equal(saveBody.includes('workout_sessions'), false);
assert.equal(saveBody.includes('workout_sets'), false);
assert.equal((writeBody.match(/FROM public\.workout_sessions/g) ?? []).length, 2);
assert.equal(writeBody.includes('workout_sets'), false);
assert.equal(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+public\.workout_(sessions|sets)\b/i.test(writeBody), false);
assert.match(writeBody, /DISTINCT ON \(exercise_row\.exercise_id\)/);
assert.match(writeBody, /ORDER BY exercise_row\.exercise_id, exercise_row\.exercise_order, exercise_row\.id/);
assert.equal(writeBody.includes('min(exercise_row.planned_weight)'), false);

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

const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-planned-weight-pg-'));
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
    INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}');
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

  async function finishedHistory() {
    return must(`
      SELECT
        (SELECT weight::text || ':' || reps::text FROM public.workout_sets WHERE id = 1)
        || ':' || (SELECT finished_at::text FROM public.workout_sessions WHERE id = 1)
        || ':' || (SELECT finished_at IS NULL FROM public.workout_sessions WHERE id = 2)::text;
    `, 'finished history');
  }

  const before = {
    sessions: await fingerprint('workout_sessions'),
    sets: await fingerprint('workout_sets'),
    programs: await fingerprint('programs'),
    days: await fingerprint('program_days'),
    exercises: await fingerprint('program_exercises'),
    count: await must('SELECT count(*)::text FROM public.program_exercises;', 'exercise count'),
    history: await finishedHistory(),
    functions: await must(`
      SELECT count(*)::text
      FROM pg_catalog.pg_proc AS proc
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
      WHERE namespace.nspname = 'public';
    `, 'function count'),
  };
  const unchanged = ['update_owned_program(jsonb)', 'save_manual_program(jsonb)', 'save_owned_program(jsonb,boolean)', 'record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)'];
  const beforeSources = new Map<string, string>();
  for (const signature of unchanged) {
    beforeSources.set(signature, await must(
      `SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.${signature}');`,
      signature,
    ));
  }
  assert.equal(before.history, '135.5:5:2026-11-01 13:00:00+00:true');

  const installed = await must(forwardSql, 'planned weight install');
  assert.match(installed, /planned_weight_installed/);
  await expectError(forwardSql, /planned_weight_already_present/, 'second install');
  assert.equal(await fingerprint('workout_sessions'), before.sessions);
  assert.equal(await fingerprint('workout_sets'), before.sets);
  assert.equal(await fingerprint('programs'), before.programs);
  assert.equal(await fingerprint('program_days'), before.days);
  assert.notEqual(await fingerprint('program_exercises'), before.exercises);
  assert.equal(await must('SELECT count(*)::text FROM public.program_exercises;', 'count after'), before.count);
  assert.equal(await must(`
    SELECT count(*)::text FROM public.program_exercises
    WHERE planned_weight IS NOT NULL OR planned_weight_unit IS NOT NULL;
  `, 'pre-existing plans'), '0');
  assert.equal(await must(`
    SELECT count(*)::text
    FROM pg_catalog.pg_proc AS proc
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = proc.pronamespace
    WHERE namespace.nspname = 'public';
  `, 'function count after'), before.functions);
  for (const signature of unchanged) {
    assert.equal(await must(
      `SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.${signature}');`,
      `${signature} unchanged`,
    ), beforeSources.get(signature));
  }
  assert.equal(await must(`
    SELECT has_function_privilege('authenticated', 'public.save_imported_program(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('anon', 'public.save_imported_program(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('public', 'public.save_imported_program(jsonb)', 'EXECUTE')::text;
  `, 'save privilege'), 'true:false:false');
  assert.equal(await must(`
    SELECT position('planned_weight' in prosrc) = 0
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)');
  `, 'tracked source'), 't');

  await expectError(
    `UPDATE public.program_exercises SET planned_weight_unit = 'lb' WHERE id = 1;`,
    /program_exercises_planned_weight_check/,
    'unit without number',
  );
  await expectError(
    `UPDATE public.program_exercises SET planned_weight = 2001 WHERE id = 1;`,
    /program_exercises_planned_weight_check/,
    'check 2001',
  );
  await expectError(
    `UPDATE public.program_exercises SET planned_weight = 10, planned_weight_unit = 'lbs' WHERE id = 1;`,
    /program_exercises_planned_weight_check/,
    'check lbs',
  );
  assert.equal(await finishedHistory(), before.history);

  const programCount = () => must('SELECT count(*)::text FROM public.programs;', 'program count');
  const programsBeforeSave = await programCount();
  const savedId = await must(asUser(userA, `
    SELECT public.save_imported_program(${payload({
      name: 'Imported',
      days: [{
        name: 'Push',
        subtitle: 'Monday',
        exercises: [
          { exercise_id: 1, target_sets: 3, min_reps: 8, max_reps: 12, notes: 'Pause', rest_seconds: 90, planned_weight: 135.5 },
          { exercise_id: 2, target_sets: 3, min_reps: 8, max_reps: 12, notes: 'Row', planned_weight: '60', planned_weight_unit: 'kg' },
          { exercise_id: 3, target_sets: 3, min_reps: 8, max_reps: 12, notes: 'Squat', planned_weight: 0, planned_weight_unit: 'lb' },
          { exercise_id: 4, target_sets: 3, min_reps: 8, max_reps: 12, notes: 'Press', planned_weight: '2000.000', planned_weight_unit: null },
        ],
      }],
    })});
  `), 'save planned weights');
  const savedRows = await must(`
    SELECT coalesce(string_agg(
      exercise_id::text || ':' || planned_weight::text || ':' || coalesce(planned_weight_unit, 'null')
      || ':' || (planned_weight = 2000)::text,
      ',' ORDER BY exercise_order
    ), '')
    FROM public.program_exercises
    WHERE program_day_id IN (SELECT id FROM public.program_days WHERE program_id = ${savedId});
  `, 'saved plans');
  assert.equal(savedRows, '1:135.5:null:false,2:60:kg:false,3:0:lb:false,4:2000.000:null:true');
  assert.equal(await must(`
    SELECT rest_seconds::text FROM public.program_exercises
    WHERE program_day_id IN (SELECT id FROM public.program_days WHERE program_id = ${savedId})
      AND exercise_id = 1;
  `, 'saved rest'), '90');

  async function rejects(plan: unknown, pattern: RegExp, label: string) {
    const beforeCount = await programCount();
    await expectError(asUser(userA, `SELECT public.save_imported_program(${payload(plan)});`), pattern, label);
    assert.equal(await programCount(), beforeCount, label);
    assert.equal(await finishedHistory(), before.history, label);
  }

  const baseExercise = {
    exercise_id: 1,
    target_sets: 3,
    min_reps: 8,
    max_reps: 12,
    notes: 'Nope',
  };
  const badProgram = (exerciseRow: Record<string, unknown>) => ({
    name: 'Rejected',
    days: [{ name: 'Push', subtitle: null, exercises: [{ ...baseExercise, ...exerciseRow }] }],
  });
  await rejects(badProgram({ planned_weight: 2001 }), /invalid_import: planned_weight/, '2001');
  await rejects(badProgram({ planned_weight: -1 }), /invalid_import: planned_weight/, '-1');
  await rejects(badProgram({ planned_weight: '1e2' }), /invalid_import: planned_weight/, '1e2');
  await rejects(badProgram({ planned_weight: '135.' }), /invalid_import: planned_weight/, '135.');
  await rejects(badProgram({ planned_weight: null, planned_weight_unit: 'lb' }), /invalid_import: planned_weight/, 'unit with null weight');
  await rejects(badProgram({ planned_weight: 10, planned_weight_unit: 'LB' }), /invalid_import: planned_weight_unit/, 'LB');
  await rejects(badProgram({ planned_weight: 10, planned_weight_unit: 'lbs' }), /invalid_import: planned_weight_unit/, 'lbs');
  await rejects(badProgram({ planned_weight: true }), /invalid_import: planned_weight/, 'boolean');
  await rejects(badProgram({ planned_weight: { n: 1 } }), /invalid_import: planned_weight/, 'object');
  await rejects(badProgram({ notes: 'n'.repeat(281), planned_weight: 10 }), /invalid_import: notes/, 'notes 281');

  const omittedId = await must(asUser(userA, `
    SELECT public.save_imported_program(${payload({
      name: 'No plan',
      days: [{
        name: 'Pull',
        subtitle: 'Tuesday',
        exercises: [{ exercise_id: 1, target_sets: 3, min_reps: 5, max_reps: 8, notes: 'Plain', rest_seconds: 90 }],
      }],
    })});
  `), 'omitted keys');
  assert.equal(await must(`
    SELECT (planned_weight IS NULL AND planned_weight_unit IS NULL)::text || ':' || rest_seconds::text
    FROM public.program_exercises
    WHERE program_day_id IN (SELECT id FROM public.program_days WHERE program_id = ${omittedId});
  `, 'omitted plan'), 'true:90');
  assert.equal(await programCount(), String(Number(programsBeforeSave) + 2));

  await must(`
    UPDATE public.program_exercises
    SET planned_weight = 135.5, planned_weight_unit = 'kg', rest_seconds = 90
    WHERE id = 1;
    GRANT EXECUTE ON FUNCTION public.update_owned_program(jsonb) TO authenticated;
  `, 'store active plan');

  async function activePlans() {
    return must(`
      SELECT coalesce(string_agg(
        exercise_id::text || ':' || coalesce(planned_weight::text, 'null') || ':' ||
        coalesce(planned_weight_unit, 'null') || ':' || coalesce(rest_seconds::text, 'null') || ':' ||
        coalesce(notes, ''),
        ',' ORDER BY exercise_id, id
      ), '')
      FROM public.program_exercises
      WHERE program_day_id = 1;
    `, 'active plans');
  }

  async function edit(bodyJson: unknown, label: string) {
    await must(asUser(userA, `SELECT public.update_owned_program(${payload(bodyJson)});`), label);
    assert.equal(await finishedHistory(), before.history, label);
  }

  const day = (rows: unknown[]) => ({
    program_id: 1,
    name: 'Home',
    days: [{ day_id: 1, name: 'Push', subtitle: null, exercises: rows }],
  });
  await edit(day([exercise(1, { notes: 'Kept' })]), 'omit planned keys');
  assert.equal(await activePlans(), '1:135.5:kg:90:Kept');

  await expectError(
    asUser(userA, `SELECT public.update_owned_program(${payload(day([exercise(1, { notes: 'Kept', planned_weight_unit: 'lb' })]))});`),
    /invalid_import: planned_weight/,
    'unit without weight key',
  );
  assert.equal(await activePlans(), '1:135.5:kg:90:Kept');

  await edit(day([exercise(1, { notes: 'Kept' }), exercise(3, { notes: 'New' })]), 'new exercise omits plan');
  assert.equal(await activePlans(), '1:135.5:kg:90:Kept,3:null:null:null:New');

  await must(`
    INSERT INTO public.program_exercises (
      program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps, notes, rest_seconds,
      planned_weight, planned_weight_unit
    ) VALUES
      (1, 1, 2, 3, 8, 12, 'later', 90, 40, 'lb'),
      (1, 2, 1, 3, 8, 12, 'low-id', NULL, 15, 'kg'),
      (1, 2, 1, 3, 8, 12, 'high-id', NULL, 10, 'lb');
  `, 'duplicate exercise ids');
  await edit(day([
    exercise(1, { notes: 'Kept' }),
    exercise(2, { notes: 'Row' }),
    exercise(3, { notes: 'New' }),
  ]), 'preserve lowest order then lowest id');
  assert.equal(await activePlans(), '1:135.5:kg:90:Kept,2:15:kg:null:Row,3:null:null:null:New');

  await edit(day([
    exercise(1, { notes: 'Cleared', planned_weight: null, planned_weight_unit: null }),
    exercise(2, { notes: 'Row' }),
    exercise(3, { notes: 'New' }),
  ]), 'json null clears one plan');
  assert.equal(await activePlans(), '1:null:null:90:Cleared,2:15:kg:null:Row,3:null:null:null:New');

  const importedBefore = await must(`
    SELECT coalesce(string_agg(planned_weight::text || ':' || coalesce(planned_weight_unit, 'null'), ',' ORDER BY id), '')
    FROM public.program_exercises
    WHERE program_day_id IN (
      SELECT id FROM public.program_days WHERE program_id IN (
        SELECT id FROM public.programs WHERE name = 'Imported'
      )
    );
  `, 'imported plans before manual save');
  await must(`
    GRANT EXECUTE ON FUNCTION public.save_manual_program(jsonb) TO authenticated;
  `, 'disposable save_manual_program grant');
  const manualId = await must(asUser(userA, `
    SELECT public.save_manual_program(${payload({
      name: 'Manual copy',
      days: [{ name: 'Day', subtitle: null, exercises: [exercise(1, { notes: 'Manual' })] }],
    })});
  `), 'manual save omits plan');
  assert.equal(await must(`
    SELECT (planned_weight IS NULL AND planned_weight_unit IS NULL)::text
    FROM public.program_exercises
    WHERE program_day_id IN (SELECT id FROM public.program_days WHERE program_id = ${manualId});
  `, 'manual plan'), 'true');
  assert.equal(await must(`
    SELECT coalesce(string_agg(planned_weight::text || ':' || coalesce(planned_weight_unit, 'null'), ',' ORDER BY id), '')
    FROM public.program_exercises
    WHERE program_day_id IN (
      SELECT id FROM public.program_days WHERE program_id IN (
        SELECT id FROM public.programs WHERE name = 'Imported'
      )
    );
  `, 'imported plans after manual save'), importedBefore);
  assert.equal(await activePlans(), '1:null:null:90:Cleared,2:15:kg:null:Row,3:null:null:null:New');

  const ownedBefore = await must(`SELECT count(*)::text FROM public.programs WHERE user_id = '${userB}';`, 'user B programs');
  await expectError(
    asUser(userB, `SELECT public.save_owned_program(${payload(badProgram({ planned_weight: 135 }))}, true);`),
    /invalid_import: exercise_field/,
    'first program rejects planned key',
  );
  assert.equal(await must(`SELECT count(*)::text FROM public.programs WHERE user_id = '${userB}';`, 'user B after reject'), ownedBefore);

  await must(`
    GRANT EXECUTE ON FUNCTION public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean) TO authenticated;
  `, 'disposable record_tracked_set grant');
  const plansBeforeLog = await activePlans();
  await must(asUser(userA, `
    SELECT public.record_tracked_set(2, 1, 1, 'added', 100, NULL, 'lb', 5, NULL, true);
  `), 'log a set');
  assert.equal(await must(`
    SELECT weight::text FROM public.workout_sets WHERE workout_session_id = 2;
  `, 'logged weight'), '100');
  assert.equal(await finishedHistory(), before.history);
  assert.equal(await activePlans(), plansBeforeLog);

  await expectError(rollbackSql, /planned_weight_rollback_blocked/, 'rollback while a plan is stored');
  assert.equal(await must(`
    SELECT count(*)::text
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'program_exercises' AND column_name = 'planned_weight';
  `, 'column remains'), '1');
  await must(`UPDATE public.program_exercises SET planned_weight = NULL, planned_weight_unit = NULL;`, 'clear plans');
  const rolled = await must(rollbackSql, 'rollback');
  assert.match(rolled, /planned_weight_rolled_back/);
  assert.equal(await must(`
    SELECT count(*)::text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'program_exercises'
      AND column_name IN ('planned_weight', 'planned_weight_unit');
  `, 'columns dropped'), '0');
  await expectError(
    asUser(userA, `SELECT public.save_imported_program(${payload(badProgram({ planned_weight: 135 }))});`),
    /invalid_import: exercise_field/,
    'restored save rejects planned key',
  );
  assert.equal(await finishedHistory(), before.history);
  assert.equal(await must(`
    SELECT has_function_privilege('authenticated', 'public.save_imported_program(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('anon', 'public.save_imported_program(jsonb)', 'EXECUTE')::text;
  `, 'privilege after rollback'), 'true:false');
  console.log('planned weight checks passed');
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
