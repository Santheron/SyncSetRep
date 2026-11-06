import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const port = 55447;
const database = 'syncsetrep_rest_preserve';
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');

const preserveSql = await readFile(join(root, 'sql/routine-rest-preserve.sql'), 'utf8');
const rollbackSql = await readFile(join(root, 'sql/routine-rest-preserve-rollback.sql'), 'utf8');
const routineEditSql = await readFile(join(root, 'sql/routine-edit.sql'), 'utf8');
const flagsSql = await readFile(join(root, 'lib/import/flags.ts'), 'utf8');
const clientSql = await readFile(join(root, 'lib/import/manual-program-client.ts'), 'utf8');
const manualSql = await readFile(join(root, 'lib/import/manual-program.ts'), 'utf8');

function stripSql(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

function bodyMd5(sql: string, tag: string, endings: 'lf' | 'crlf') {
  const open = `$${tag}$`;
  const start = sql.lastIndexOf(`AS ${open}`);
  const from = start + `AS ${open}`.length;
  const end = sql.indexOf(`${open};`, from);
  assert.ok(start >= 0 && end > from, tag);
  let body = sql.slice(from, end).replace(/\r\n/g, '\n');
  if (endings === 'crlf') {
    body = body.replace(/\n/g, '\r\n');
  }
  return createHash('md5').update(body).digest('hex');
}

function extractCreate(sql: string, name: string, tag: string) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const endMarker = `$${tag}$;`;
  const end = sql.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, name);
  return sql.slice(start, end + endMarker.length).replace(/\r\n/g, '\n');
}

assert.equal(preserveSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(rollbackSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(/\bGRANT\b/i.test(stripSql(preserveSql)), false);
assert.equal(/\bREVOKE\b/i.test(stripSql(preserveSql)), false);
assert.equal(/\bGRANT\b/i.test(stripSql(rollbackSql)), false);
assert.equal(/\bREVOKE\b/i.test(stripSql(rollbackSql)), false);
assert.equal(/\bALTER\s+TABLE\b/i.test(stripSql(preserveSql)), false);
assert.equal(/\bDROP\b/i.test(stripSql(preserveSql)), false);
assert.equal(/\bALTER\s+TABLE\b/i.test(stripSql(rollbackSql)), false);
assert.equal(/\bDROP\b/i.test(stripSql(rollbackSql)), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.update_owned_program/i.test(preserveSql), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.save_manual_program/i.test(preserveSql), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.save_imported_program/i.test(preserveSql), false);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.save_owned_program/i.test(preserveSql), false);
assert.match(preserveSql, /routine_rest_preserve_already_present/);
assert.match(preserveSql, /routine_rest_preserve_installed/);
assert.match(rollbackSql, /routine_rest_preserve_absent/);
assert.match(rollbackSql, /routine_rest_preserve_rollback_blocked/);
assert.equal(/DELETE\s+FROM\s+public\.workout_/i.test(stripSql(preserveSql)), false);
assert.equal(/UPDATE\s+public\.workout_/i.test(stripSql(preserveSql)), false);
assert.equal(
  extractCreate(rollbackSql, 'routine_normalize_days', 'prepare'),
  extractCreate(routineEditSql, 'routine_normalize_days', 'prepare'),
);
assert.equal(
  extractCreate(rollbackSql, 'routine_write_days', 'write'),
  extractCreate(routineEditSql, 'routine_write_days', 'write'),
);
assert.match(flagsSql, /export const PERSIST_REST_SECONDS = RELEASE_CANDIDATE_FEATURES_ENABLED/);
assert.match(clientSql, /export const OWNED_PROGRAM_EDIT_ENABLED = RELEASE_CANDIDATE_FEATURES_ENABLED/);
assert.notEqual(process.env.EXPO_PUBLIC_SYNCSETREP_RC, '1');
assert.equal(manualSql.includes('rest_seconds'), false);

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

function payload(json: unknown) {
  return `$payload$${JSON.stringify(json)}$payload$::jsonb`;
}

function exercise(
  exerciseId: number,
  fields: Record<string, unknown> = {},
) {
  return {
    exercise_id: exerciseId,
    target_sets: 3,
    min_reps: 8,
    max_reps: 10,
    notes: null,
    ...fields,
  };
}

function day2() {
  return {
    day_id: 2,
    name: 'Pull',
    subtitle: null,
    exercises: [
      exercise(3, { target_sets: 2, min_reps: 5, max_reps: 8, notes: 'Day2' }),
    ],
  };
}

const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-rest-preserve-pg-'));
const logFile = join(dataDir, 'server.log');
let started = false;
let historySessions = '';
let historySets = '';

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
  ]) {
    const applied = await psql(await readFile(join(root, name), 'utf8'));
    assert.equal(applied.code, 0, `${name}\n${applied.stderr}`);
  }

  const sourceMd5 = async (signature: string) => must(
    `SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('${signature}');`,
    signature,
  );
  const beforeUpdate = await sourceMd5('public.update_owned_program(jsonb)');
  const beforeNormalize = await sourceMd5('public.routine_normalize_days(jsonb,boolean)');
  const beforeWrite = await sourceMd5('public.routine_write_days(uuid,bigint,jsonb,boolean)');
  assert.equal(beforeUpdate, bodyMd5(routineEditSql, 'update', 'lf'));
  assert.equal(beforeNormalize, bodyMd5(routineEditSql, 'prepare', 'lf'));
  assert.equal(beforeWrite, bodyMd5(routineEditSql, 'write', 'lf'));
  assert.equal(bodyMd5(routineEditSql, 'update', 'crlf'), '23db0166c3eca6ff985450224592fd07');
  assert.equal(bodyMd5(routineEditSql, 'prepare', 'crlf'), '4496f7801ef746d1d835e216ddf9d5bd');
  assert.equal(bodyMd5(routineEditSql, 'write', 'crlf'), '79444b1e371b632334d1a18b2234e588');
  assert.equal(
    await sourceMd5('public.enforce_program_activation()'),
    '677d392087cde86ceaa5744ebe108f99',
  );
  assert.equal(
    await sourceMd5('public.save_imported_program(jsonb)'),
    'e30fba2f089c3a31634a332097290cbd',
  );

  const deletePrivileges = `
    SELECT has_table_privilege('authenticated', 'public.workout_sessions', 'DELETE')::text
      || ':' || has_table_privilege('authenticated', 'public.workout_sets', 'DELETE')::text
      || ':' || has_table_privilege('authenticated', 'public.programs', 'DELETE')::text
      || ':' || has_table_privilege('authenticated', 'public.program_days', 'DELETE')::text
      || ':' || has_table_privilege('authenticated', 'public.program_exercises', 'DELETE')::text;
  `;
  const deletesBefore = await must(deletePrivileges, 'delete privileges before');
  assert.equal(deletesBefore, 'true:true:true:true:true');
  const nameKey = await must(
    `SELECT pg_catalog.pg_get_constraintdef(oid) FROM pg_catalog.pg_constraint WHERE conname = 'exercises_name_key';`,
    'name constraint',
  );
  assert.equal(nameKey, 'UNIQUE (name)');
  const trigger = await must(`
    SELECT pg_get_triggerdef(oid)
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'programs_activation_rpc'
      AND tgrelid = 'public.programs'::regclass
      AND NOT tgisinternal;
  `, 'activation trigger');
  assert.match(trigger, /BEFORE INSERT OR UPDATE ON public\.programs/);
  assert.match(trigger, /enforce_program_activation/);

  const preserved = await must(preserveSql, 'preserve install');
  assert.match(preserved, /routine_rest_preserve_installed/);
  await expectError(preserveSql, /routine_rest_preserve_already_present/, 'second preserve');
  assert.equal(await sourceMd5('public.update_owned_program(jsonb)'), beforeUpdate);
  assert.notEqual(await sourceMd5('public.routine_normalize_days(jsonb,boolean)'), beforeNormalize);
  assert.notEqual(await sourceMd5('public.routine_write_days(uuid,bigint,jsonb,boolean)'), beforeWrite);
  const marker = await must(`
    SELECT position('routine_rest_preserve' in write_fn.prosrc)::text
      || ':' || position('rest_seconds' in update_fn.prosrc)::text
      || ':' || position('routine_rest_preserve' in normalize_fn.prosrc)::text
    FROM pg_catalog.pg_proc write_fn, pg_catalog.pg_proc update_fn, pg_catalog.pg_proc normalize_fn
    WHERE write_fn.oid = to_regprocedure('public.routine_write_days(uuid,bigint,jsonb,boolean)')
      AND update_fn.oid = to_regprocedure('public.update_owned_program(jsonb)')
      AND normalize_fn.oid = to_regprocedure('public.routine_normalize_days(jsonb,boolean)');
  `, 'marker');
  assert.equal(marker, `${marker.split(':')[0]}:0:${marker.split(':')[2]}`);
  assert.notEqual(marker.split(':')[0], '0');
  assert.notEqual(marker.split(':')[2], '0');

  const closedExecute = await must(`
    SELECT has_function_privilege('authenticated', 'public.update_owned_program(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('authenticated', 'public.save_manual_program(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('authenticated', 'public.routine_write_days(uuid,bigint,jsonb,boolean)', 'EXECUTE')::text
      || ':' || has_function_privilege('authenticated', 'public.routine_normalize_days(jsonb,boolean)', 'EXECUTE')::text
      || ':' || has_function_privilege('anon', 'public.update_owned_program(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('public', 'public.routine_write_days(uuid,bigint,jsonb,boolean)', 'EXECUTE')::text
      || ':' || has_function_privilege('service_role', 'public.update_owned_program(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('authenticated', 'public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)', 'EXECUTE')::text
      || ':' || has_function_privilege('authenticated', 'public.create_custom_exercise(text)', 'EXECUTE')::text;
  `, 'closed execute');
  assert.equal(closedExecute, 'false:false:false:false:false:false:false:false:false');
  await expectError(
    asUser(userA, `SELECT public.update_owned_program('{}'::jsonb);`),
    /permission denied for function/i,
    'authenticated update before test grant',
  );

  const normalized = await must(`
    WITH days AS (
      SELECT public.routine_normalize_days(
        '[{"name":"Push","exercises":[
          {"exercise_id":1,"target_sets":3,"min_reps":8,"max_reps":10,"notes":null},
          {"exercise_id":2,"target_sets":3,"min_reps":8,"max_reps":10,"notes":null,"rest_seconds":null},
          {"exercise_id":3,"target_sets":3,"min_reps":8,"max_reps":10,"notes":null,"rest_seconds":0},
          {"exercise_id":4,"target_sets":3,"min_reps":8,"max_reps":10,"notes":null,"rest_seconds":"600"}
        ]}]'::jsonb,
        false
      ) AS value
    )
    SELECT (value->0->'exercises'->0 ? 'rest_seconds')::text
      || ':' || (value->0->'exercises'->1 ? 'rest_seconds')::text
      || ':' || coalesce(value->0->'exercises'->1->>'rest_seconds', 'null')
      || ':' || coalesce(value->0->'exercises'->2->>'rest_seconds', 'null')
      || ':' || coalesce(value->0->'exercises'->3->>'rest_seconds', 'null')
    FROM days;
  `, 'normalize omit and explicit');
  assert.equal(normalized, 'false:true:null:0:600');
  await expectError(
    `SELECT public.routine_normalize_days('[{"name":"Push","exercises":[{"exercise_id":1,"target_sets":3,"min_reps":8,"max_reps":10,"notes":null,"rest_seconds":601}]}]'::jsonb, false);`,
    /invalid_import: rest/,
    'normalize 601',
  );

  // Disposable test grant only. This is not sql/routine-write-enablement.sql.
  const granted = await must(`
    GRANT EXECUTE ON FUNCTION public.update_owned_program(jsonb) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.save_manual_program(jsonb) TO authenticated;
    SELECT has_function_privilege('authenticated', 'public.update_owned_program(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('authenticated', 'public.save_manual_program(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('authenticated', 'public.routine_write_days(uuid,bigint,jsonb,boolean)', 'EXECUTE')::text
      || ':' || has_function_privilege('authenticated', 'public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)', 'EXECUTE')::text;
  `, 'test-only grant');
  assert.equal(granted, 'true:true:false:false');

  await must(`
    INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}');
    INSERT INTO public.exercises (name) VALUES ('Bench'), ('Row'), ('Squat');
    INSERT INTO public.programs (user_id, name, slug, is_active)
    VALUES ('${userA}', 'Home', NULL, true);
    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (1, 'Push', NULL, 1), (1, 'Pull', NULL, 2);
    INSERT INTO public.program_exercises (
      program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps, notes, load_mode, rest_seconds
    ) VALUES
      (1, 1, 1, 3, 8, 12, 'Old', 'added', 90),
      (1, 2, 2, 3, 8, 12, NULL, NULL, 120),
      (2, 3, 1, 2, 5, 8, 'Day2', NULL, 45);
    INSERT INTO public.workout_sessions (user_id, program_day_id, started_at, finished_at)
    VALUES ('${userA}', 1, '2026-10-30 12:00:00+00', '2026-10-30 13:00:00+00');
    INSERT INTO public.workout_sets (
      workout_session_id, exercise_id, set_number, weight, reps, is_completed
    ) VALUES
      (1, 1, 1, 135, 5, true),
      (1, 1, 2, -4, 3, true),
      (1, 1, 3, 0, 8, true),
      (1, 1, 4, NULL, 4, true);
  `, 'seed');

  async function assertHistory() {
    const sessions = await must(`
      SELECT coalesce(string_agg(
        id::text || ':' || coalesce(program_day_id::text, 'null') || ':' ||
        coalesce(finished_at::text, 'null') || ':' || coalesce(user_id::text, 'null'),
        ',' ORDER BY id
      ), '')
      FROM public.workout_sessions;
    `, 'sessions');
    const sets = await must(`
      SELECT coalesce(string_agg(
        id::text || ':' || coalesce(workout_session_id::text, 'null') || ':' ||
        set_number::text || ':' || coalesce(weight::text, 'null') || ':' ||
        coalesce(reps::text, 'null') || ':' || coalesce(is_completed::text, 'null'),
        ',' ORDER BY id
      ), '')
      FROM public.workout_sets;
    `, 'sets');
    if (historySessions === '') {
      historySessions = sessions;
      historySets = sets;
    }
    assert.equal(sessions, historySessions);
    assert.equal(sets, historySets);
  }
  await assertHistory();
  assert.equal(historySets, '1:1:1:135:5:true,2:1:2:-4:3:true,3:1:3:0:8:true,4:1:4:null:4:true');

  await expectError(
    `UPDATE public.program_exercises SET rest_seconds = 601 WHERE program_day_id = 2;`,
    /program_exercises_rest_seconds_range/,
    'check 601',
  );
  assert.equal(await must(
    `SELECT rest_seconds::text FROM public.program_exercises WHERE program_day_id = 2;`,
    'day 2 rest after check',
  ), '45');

  const duplicateName = await psql(`
    INSERT INTO public.exercises (name, owner_user_id) VALUES ('Shared Custom', '${userA}');
    INSERT INTO public.exercises (name, owner_user_id) VALUES ('Shared Custom', '${userB}');
  `);
  assert.notEqual(duplicateName.code, 0);
  assert.match(duplicateName.stderr, /duplicate key value violates unique constraint "exercises_name_key"/);

  async function mustEdit(user: string, body: unknown, label: string) {
    const result = await psql(asUser(user, `SELECT public.update_owned_program(${payload(body)});`));
    assert.equal(result.code, 0, `${label}\n${result.stderr}`);
    await assertHistory();
  }

  async function dayOne() {
    return must(`
      SELECT coalesce(string_agg(
        exercise_order::text || ':' || exercise_id::text || ':' ||
        coalesce(rest_seconds::text, 'null') || ':' || target_sets::text || ':' ||
        min_reps::text || ':' || max_reps::text || ':' || coalesce(notes, '') || ':' ||
        coalesce(load_mode, ''),
        ',' ORDER BY exercise_order
      ), '')
      FROM public.program_exercises
      WHERE program_day_id = 1;
    `, 'day 1 exercises');
  }

  await mustEdit(userA, {
    program_id: 1,
    name: 'Home edited',
    days: [
      {
        day_id: 1,
        name: 'Push day',
        subtitle: 'Upper',
        exercises: [
          exercise(2, { target_sets: 4, min_reps: 6, max_reps: 10, notes: 'Row note', load_mode: 'assisted' }),
          exercise(1, { target_sets: 5, min_reps: 5, max_reps: 8, notes: 'Pause', load_mode: 'added' }),
        ],
      },
      day2(),
    ],
  }, 'omit rest while editing other fields');
  assert.equal(
    await dayOne(),
    '1:2:120:4:6:10:Row note:assisted,2:1:90:5:5:8:Pause:added',
  );
  assert.equal(await must(
    `SELECT (archived_at IS NULL)::text || ':' || day_order::text FROM public.program_days WHERE id = 1;`,
    'edited day stays active',
  ), 'true:1');
  assert.equal(await must(
    `SELECT exercise_id::text || ':' || coalesce(rest_seconds::text, 'null') FROM public.program_exercises WHERE program_day_id = 2;`,
    'untouched day rest',
  ), '3:45');
  assert.equal(await must(
    `SELECT name || ':' || is_active::text FROM public.programs WHERE id = 1;`,
    'program stays active',
  ), 'Home edited:true');

  await mustEdit(userA, {
    program_id: 1,
    name: 'Home edited',
    days: [
      {
        day_id: 1,
        name: 'Push day',
        subtitle: 'Upper',
        exercises: [
          exercise(2, { target_sets: 4, min_reps: 6, max_reps: 10, notes: 'Row note', load_mode: 'assisted' }),
          exercise(1, { target_sets: 5, min_reps: 5, max_reps: 8, notes: 'Pause', load_mode: 'added' }),
          exercise(3, { target_sets: 1, min_reps: 8, max_reps: 8, notes: 'New' }),
        ],
      },
      day2(),
    ],
  }, 'new exercise omits rest');
  assert.equal(
    await dayOne(),
    '1:2:120:4:6:10:Row note:assisted,2:1:90:5:5:8:Pause:added,3:3:null:1:8:8:New:',
  );

  await mustEdit(userA, {
    program_id: 1,
    name: 'Home edited',
    days: [
      {
        day_id: 1,
        name: 'Push day',
        subtitle: 'Upper',
        exercises: [
          exercise(2, { rest_seconds: 0, target_sets: 4, min_reps: 6, max_reps: 10, notes: 'Row note', load_mode: 'assisted' }),
          exercise(1, { rest_seconds: 45, target_sets: 5, min_reps: 5, max_reps: 8, notes: 'Pause', load_mode: 'added' }),
          exercise(3, { target_sets: 1, min_reps: 8, max_reps: 8, notes: 'New' }),
        ],
      },
      day2(),
    ],
  }, 'explicit 0 and 45');
  assert.match(await dayOne(), /^1:2:0:.*2:1:45:.*3:3:null:/);

  await mustEdit(userA, {
    program_id: 1,
    name: 'Home edited',
    days: [
      {
        day_id: 1,
        name: 'Push day',
        subtitle: 'Upper',
        exercises: [
          exercise(2, { target_sets: 4, min_reps: 6, max_reps: 10, notes: 'Row note', load_mode: 'assisted' }),
          exercise(1, { rest_seconds: null, target_sets: 5, min_reps: 5, max_reps: 8, notes: 'Pause', load_mode: 'added' }),
          exercise(3, { target_sets: 1, min_reps: 8, max_reps: 8, notes: 'New' }),
        ],
      },
      day2(),
    ],
  }, 'explicit null clears one value');
  assert.match(await dayOne(), /^1:2:0:.*2:1:null:.*3:3:null:/);

  await mustEdit(userA, {
    program_id: 1,
    name: 'Home edited',
    days: [
      {
        day_id: 1,
        name: 'Push day',
        subtitle: 'Upper',
        exercises: [
          exercise(2, { rest_seconds: 600, target_sets: 4, min_reps: 6, max_reps: 10, notes: 'Row note', load_mode: 'assisted' }),
          exercise(1, { rest_seconds: '00090', target_sets: 5, min_reps: 5, max_reps: 8, notes: 'Pause', load_mode: 'added' }),
          exercise(3, { target_sets: 1, min_reps: 8, max_reps: 8, notes: 'New' }),
        ],
      },
      day2(),
    ],
  }, 'explicit 600 and padded 90');
  assert.match(await dayOne(), /^1:2:600:.*2:1:90:.*3:3:null:/);

  await mustEdit(userA, {
    program_id: 1,
    name: 'Home edited',
    days: [
      {
        day_id: 1,
        name: 'Push day',
        subtitle: 'Upper',
        exercises: [
          exercise(2, { target_sets: 4, min_reps: 6, max_reps: 10, notes: 'Kept', load_mode: 'assisted' }),
          exercise(1, { target_sets: 5, min_reps: 5, max_reps: 8, notes: 'Pause', load_mode: 'added' }),
          exercise(3, { target_sets: 1, min_reps: 8, max_reps: 8, notes: 'New' }),
        ],
      },
      day2(),
    ],
  }, 'later omit keeps 600 and 90');
  assert.match(await dayOne(), /^1:2:600:4:6:10:Kept:assisted,2:1:90:.*3:3:null:/);

  const beforeReject = await dayOne();
  for (const [label, rest] of [
    ['601', 601],
    ['negative', -1],
    ['fraction', 1.5],
    ['text', 'no'],
    ['blank', ''],
    ['boolean', true],
  ] as const) {
    await expectError(asUser(userA, `SELECT public.update_owned_program(${payload({
      program_id: 1,
      name: 'Should Not Stick',
      days: [
        {
          day_id: 1,
          name: 'Push day',
          subtitle: 'Upper',
          exercises: [
            exercise(2, { rest_seconds: rest, target_sets: 4, min_reps: 6, max_reps: 10, notes: 'Kept', load_mode: 'assisted' }),
            exercise(1, { target_sets: 5, min_reps: 5, max_reps: 8, notes: 'Pause', load_mode: 'added' }),
            exercise(3, { target_sets: 1, min_reps: 8, max_reps: 8, notes: 'New' }),
          ],
        },
        day2(),
      ],
    })});`), /invalid_import: rest/, label);
    assert.equal(await dayOne(), beforeReject, label);
    assert.equal(await must(
      `SELECT name FROM public.programs WHERE id = 1;`,
      `${label} name`,
    ), 'Home edited');
    await assertHistory();
  }

  await expectError(asUser(userB, `SELECT public.update_owned_program(${payload({
    program_id: 1,
    name: 'Stolen',
    days: [
      {
        day_id: 1,
        name: 'Push day',
        subtitle: null,
        exercises: [exercise(1)],
      },
    ],
  })});`), /program_not_found/, 'other user');
  assert.equal(await must(`SELECT name FROM public.programs WHERE id = 1;`, 'name after stranger'), 'Home edited');
  assert.equal(await dayOne(), beforeReject);
  await assertHistory();

  const manual = await psql(asUser(userA, `SELECT public.save_manual_program(${payload({
    name: 'Manual',
    days: [
      {
        name: 'Extra',
        subtitle: null,
        exercises: [
          exercise(1, { rest_seconds: 30 }),
          exercise(2),
        ],
      },
    ],
  })});`));
  assert.equal(manual.code, 0, manual.stderr);
  await assertHistory();
  assert.equal(await must(`
    SELECT name || ':' || is_active::text
    FROM public.programs
    ORDER BY id;
  `, 'manual program active flag'), 'Home edited:true\nManual:false');
  assert.equal(await must(`
    SELECT exercise_order::text || ':' || exercise_id::text || ':' || coalesce(rest_seconds::text, 'null')
    FROM public.program_exercises
    WHERE program_day_id = (
      SELECT id FROM public.program_days WHERE name = 'Extra'
    )
    ORDER BY exercise_order;
  `, 'manual rest'), '1:1:30\n2:2:null');

  await expectError(asUser(userA, `
    INSERT INTO public.programs (user_id, name)
    VALUES ('${userA}', 'Blocked Active');
  `), /program_activation_rpc_required/, 'direct active insert');
  assert.equal(await must(
    `SELECT count(*)::text FROM public.programs WHERE name = 'Blocked Active';`,
    'blocked insert absent',
  ), '0');
  assert.equal(await must(
    `SELECT count(*)::text FROM public.programs WHERE is_active;`,
    'one active program',
  ), '1');

  const archivedIdentity = await must(`
    SELECT coalesce(string_agg(
      id::text || ':' || exercise_id::text || ':' || coalesce(rest_seconds::text, 'null'),
      ',' ORDER BY exercise_order
    ), '')
    FROM public.program_exercises
    WHERE program_day_id = 1;
  `, 'identity before archive');
  await mustEdit(userA, {
    program_id: 1,
    name: 'Home kept',
    days: [
      {
        name: 'Legs',
        subtitle: null,
        exercises: [exercise(1, { rest_seconds: 15, notes: 'Legs' })],
      },
    ],
  }, 'archive day with history and delete day without history');
  assert.equal(await must(`
    SELECT coalesce(string_agg(
      id::text || ':' || exercise_id::text || ':' || coalesce(rest_seconds::text, 'null'),
      ',' ORDER BY exercise_order
    ), '')
    FROM public.program_exercises
    WHERE program_day_id = 1;
  `, 'archived exercises'), archivedIdentity);
  assert.equal(await must(`
    SELECT (archived_at IS NOT NULL)::text || ':' || day_order::text
    FROM public.program_days WHERE id = 1;
  `, 'archived day order'), 'true:100001');
  assert.equal(await must(
    `SELECT count(*)::text FROM public.program_days WHERE id = 2;`,
    'sessionless day deleted',
  ), '0');
  assert.equal(await must(`
    SELECT name || ':' || (archived_at IS NULL)::text || ':' || day_order::text
      || ':' || (
        SELECT coalesce(rest_seconds::text, 'null')
        FROM public.program_exercises
        WHERE program_day_id = program_days.id
      )
    FROM public.program_days
    WHERE program_id = 1 AND name = 'Legs';
  `, 'new day'), 'Legs:true:1:15');
  assert.equal(await must(
    `SELECT name || ':' || is_active::text FROM public.programs WHERE id = 1;`,
    'archive keeps program active',
  ), 'Home kept:true');

  await expectError(asUser(userA, `SELECT public.update_owned_program(${payload({
    program_id: 1,
    name: 'Should Not Unlock',
    days: [
      {
        day_id: 1,
        name: 'Push day',
        subtitle: null,
        exercises: [exercise(1)],
      },
    ],
  })});`), /archived_day_locked/, 'archived day');
  assert.equal(await must(`SELECT name FROM public.programs WHERE id = 1;`, 'name after archived reject'), 'Home kept');
  await assertHistory();

  await expectError(rollbackSql, /routine_rest_preserve_rollback_blocked/, 'rollback blocked');
  assert.notEqual(await must(`
    SELECT count(*)::text FROM public.program_exercises WHERE rest_seconds IS NOT NULL;
  `, 'rest still stored'), '0');

  await must(`UPDATE public.program_exercises SET rest_seconds = NULL;`, 'clear disposable rest');
  const rolled = await must(rollbackSql, 'rollback');
  assert.match(rolled, /routine_rest_preserve_rolled_back/);
  assert.equal(await sourceMd5('public.routine_normalize_days(jsonb,boolean)'), beforeNormalize);
  assert.equal(await sourceMd5('public.routine_write_days(uuid,bigint,jsonb,boolean)'), beforeWrite);
  assert.equal(await sourceMd5('public.update_owned_program(jsonb)'), beforeUpdate);
  assert.equal(await must(`
    SELECT count(*)::text
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'program_exercises'
      AND column_name = 'rest_seconds';
  `, 'column remains'), '1');
  assert.equal(await must(`
    SELECT position('routine_rest_preserve' in prosrc)::text
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.routine_write_days(uuid,bigint,jsonb,boolean)');
  `, 'marker removed'), '0');

  const legsId = await must(`
    SELECT id::text FROM public.program_days
    WHERE program_id = 1 AND name = 'Legs' AND archived_at IS NULL;
  `, 'legs id');
  await must(`
    UPDATE public.program_exercises
    SET rest_seconds = 90
    WHERE program_day_id = ${legsId};
  `, 'restore one disposable rest');
  await expectError(asUser(userA, `SELECT public.update_owned_program(${payload({
    program_id: 1,
    name: 'Nope',
    days: [
      {
        day_id: Number(legsId),
        name: 'Legs',
        subtitle: null,
        exercises: [exercise(1, { rest_seconds: 30, notes: 'Legs' })],
      },
    ],
  })});`), /invalid_import: exercise_field/, 'old function rejects rest');
  assert.equal(await must(`
    SELECT name || ':' || coalesce((
      SELECT rest_seconds::text FROM public.program_exercises WHERE program_day_id = ${legsId}
    ), 'null')
    FROM public.programs WHERE id = 1;
  `, 'rejected explicit rest left the row'), 'Home kept:90');

  await mustEdit(userA, {
    program_id: 1,
    name: 'Wiped',
    days: [
      {
        day_id: Number(legsId),
        name: 'Legs',
        subtitle: null,
        exercises: [exercise(1, { notes: 'Legs' })],
      },
    ],
  }, 'old omit stores null');
  assert.equal(await must(`
    SELECT coalesce(rest_seconds::text, 'null')
    FROM public.program_exercises
    WHERE program_day_id = ${legsId};
  `, 'old writer cleared rest'), 'null');
  assert.equal(await must(`
    SELECT (archived_at IS NOT NULL)::text
    FROM public.program_days WHERE id = 1;
  `, 'history day still archived'), 'true');
  await assertHistory();
  assert.equal(await must(deletePrivileges, 'delete privileges after'), deletesBefore);
  assert.equal(await must(`
    SELECT has_function_privilege('authenticated', 'public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)', 'EXECUTE')::text
      || ':' || has_function_privilege('authenticated', 'public.create_custom_exercise(text)', 'EXECUTE')::text
      || ':' || has_function_privilege('authenticated', 'public.routine_write_days(uuid,bigint,jsonb,boolean)', 'EXECUTE')::text;
  `, 'enablement still closed'), 'false:false:false');
  assert.equal(await must(`
    SELECT pg_get_triggerdef(oid)
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'programs_activation_rpc'
      AND tgrelid = 'public.programs'::regclass
      AND NOT tgisinternal;
  `, 'trigger remains'), trigger);

  console.log(`routine rest preserve checks passed; finished sets preserved: ${historySets}`);
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
