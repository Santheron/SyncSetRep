import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PERSIST_REST_SECONDS } from '../lib/import/flags.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const port = 55446;
const database = 'syncsetrep_rest';
const userId = '11111111-1111-1111-1111-111111111111';
const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');

assert.equal(PERSIST_REST_SECONDS, false);

const restSql = await readFile(join(root, 'sql/program-exercise-rest.sql'), 'utf8');
const rollbackSql = await readFile(join(root, 'sql/program-exercise-rest-rollback.sql'), 'utf8');
const appliedSave = await readFile(join(root, 'sql/ai-import-save-program.sql'), 'utf8');
function stripSql(sql: string) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

assert.equal(restSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(rollbackSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(/\bGRANT\b/i.test(stripSql(restSql)), false);
assert.equal(/\bGRANT\b/i.test(stripSql(rollbackSql)), false);
assert.equal(/\bREVOKE\b/i.test(stripSql(restSql)), false);
assert.equal(stripSql(appliedSave).includes('rest_seconds'), false);
assert.equal(stripSql(restSql).includes('workout_sets'), false);
assert.equal(stripSql(restSql).includes('workout_sessions'), false);
assert.match(restSql, /rest_seconds_already_present/);
assert.match(rollbackSql, /rest_seconds_rollback_blocked/);

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
      '-h',
      '127.0.0.1',
      '-p',
      String(port),
      '-U',
      'postgres',
      '-d',
      databaseName,
      '-X',
      '-A',
      '-t',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
    ],
    sql,
  );
}

function asUser(statement: string) {
  return `
BEGIN;
SELECT set_config('request.jwt.claim.sub', '${userId}', true) \\gset
SET LOCAL ROLE authenticated;
${statement}
COMMIT;
`;
}

const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-rest-pg-'));
const logFile = join(dataDir, 'server.log');
let started = false;

try {
  const initialized = await run(initdbPath, [
    '-D',
    dataDir,
    '-U',
    'postgres',
    '--auth=trust',
    '--encoding=UTF8',
    '--no-locale',
  ]);
  assert.equal(initialized.code, 0, initialized.stderr);
  await writeFile(
    join(dataDir, 'postgresql.conf'),
    `\nlisten_addresses = '127.0.0.1'\nport = ${port}\n`,
    { flag: 'a' },
  );
  const startedResult = await run(pgCtlPath, ['-D', dataDir, '-l', logFile, '-w', 'start']);
  assert.equal(startedResult.code, 0, startedResult.stderr);
  started = true;

  const created = await psql(`CREATE DATABASE ${database};`, 'postgres');
  assert.equal(created.code, 0, created.stderr);
  for (const name of [
    'scripts/fixtures/production-shape.sql',
    'sql/ai-import-day-order.sql',
    'sql/ai-import-save-program.sql',
  ]) {
    const applied = await psql(await readFile(join(root, name), 'utf8'));
    assert.equal(applied.code, 0, `${name}\n${applied.stderr}`);
  }

  const seeded = await psql(`
    INSERT INTO auth.users (id) VALUES ('${userId}');
    INSERT INTO public.exercises (name) VALUES ('Dumbbell Bench Press');
    INSERT INTO public.programs (user_id, name, slug, is_active)
    VALUES ('${userId}', 'Current', NULL, true);
    INSERT INTO public.workout_sessions (user_id, started_at, finished_at)
    VALUES ('${userId}', '2026-10-30 12:00:00+00', '2026-10-30 13:00:00+00');
    INSERT INTO public.workout_sets (
      workout_session_id, exercise_id, set_number, weight, reps, is_completed
    )
    VALUES (1, 1, 1, 135, 5, true);
  `);
  assert.equal(seeded.code, 0, seeded.stderr);

  const before = await psql(`
    SELECT
      (SELECT count(*) FROM public.workout_sessions WHERE finished_at IS NOT NULL)::text
      || ':' || (SELECT count(*) FROM public.workout_sets)::text
      || ':' || (SELECT weight::text || ':' || reps::text FROM public.workout_sets WHERE id = 1)
      || ':' || (SELECT count(*) FROM public.programs)::text;
  `);
  assert.equal(before.stdout.trim(), '1:1:135:5:1');

  const migrated = await psql(restSql);
  assert.equal(migrated.code, 0, migrated.stderr);

  const saved = await psql(
    asUser(`
      SELECT public.save_imported_program($payload$${JSON.stringify({
        name: 'Imported',
        days: [
          {
            name: 'Push',
            subtitle: 'Monday',
            exercises: [
              {
                exercise_id: 1,
                target_sets: 3,
                min_reps: 8,
                max_reps: 12,
                notes: 'Pause',
                rest_seconds: 90,
              },
            ],
          },
        ],
      })}$payload$::jsonb);
    `),
  );
  assert.equal(saved.code, 0, saved.stderr);
  const stored = await psql(`
    SELECT rest_seconds::text
    FROM public.program_exercises
    WHERE notes = 'Pause';
  `);
  assert.equal(stored.stdout.trim(), '90');

  const rejected = await psql(
    asUser(`
      SELECT public.save_imported_program('{"name":"Too Long","days":[{"name":"Push","subtitle":null,"exercises":[{"exercise_id":1,"target_sets":3,"min_reps":8,"max_reps":12,"notes":null,"rest_seconds":601}]}]}'::jsonb);
    `),
  );
  assert.notEqual(rejected.code, 0);
  assert.match(rejected.stderr, /invalid_import: rest/);

  const omitted = await psql(
    asUser(`
      SELECT public.save_imported_program('{"name":"No Rest","days":[{"name":"Pull","subtitle":"Tuesday","exercises":[{"exercise_id":1,"target_sets":3,"min_reps":5,"max_reps":8,"notes":"Plain"}]}]}'::jsonb);
    `),
  );
  assert.equal(omitted.code, 0, omitted.stderr);
  const plain = await psql(`
    SELECT rest_seconds IS NULL
    FROM public.program_exercises
    WHERE notes = 'Plain';
  `);
  assert.equal(plain.stdout.trim(), 't');

  const blocked = await psql(rollbackSql);
  assert.notEqual(blocked.code, 0);
  assert.match(blocked.stderr, /rest_seconds_rollback_blocked/);

  const cleared = await psql(`UPDATE public.program_exercises SET rest_seconds = NULL;`);
  assert.equal(cleared.code, 0, cleared.stderr);
  const rolled = await psql(rollbackSql);
  assert.equal(rolled.code, 0, rolled.stderr);
  const column = await psql(`
    SELECT count(*)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'program_exercises'
      AND column_name = 'rest_seconds';
  `);
  assert.equal(column.stdout.trim(), '0');

  const oldFunction = await psql(
    asUser(`
      SELECT public.save_imported_program('{"name":"Rejected Rest","days":[{"name":"Legs","subtitle":null,"exercises":[{"exercise_id":1,"target_sets":3,"min_reps":8,"max_reps":8,"notes":null,"rest_seconds":30}]}]}'::jsonb);
    `),
  );
  assert.notEqual(oldFunction.code, 0);
  assert.match(oldFunction.stderr, /invalid_import: exercise_field/);

  const after = await psql(`
    SELECT
      (SELECT count(*) FROM public.workout_sessions WHERE finished_at IS NOT NULL)::text
      || ':' || (SELECT count(*) FROM public.workout_sets)::text
      || ':' || (SELECT weight::text || ':' || reps::text FROM public.workout_sets WHERE id = 1);
  `);
  assert.equal(after.stdout.trim(), '1:1:135:5');
  console.log('rest seconds checks passed');
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
