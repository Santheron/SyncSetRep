import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLANNED_EXERCISES, normalizeExerciseName } from '../lib/import/planned-exercises.ts';

const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const port = 55441;
const database = 'routine_edit_test';
const userA = '11111111-1111-1111-1111-111111111111';
const userB = '22222222-2222-2222-2222-222222222222';
const root = fileURLToPath(new URL('..', import.meta.url));
const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');

const sqlPaths = [
  'sql/load-mode.sql',
  'sql/program-day-archive.sql',
  'sql/exercise-ownership.sql',
  'sql/routine-edit.sql',
];
const rollbackPaths = [
  'sql/routine-edit-rollback.sql',
  'sql/exercise-ownership-rollback.sql',
  'sql/program-day-archive-rollback.sql',
  'sql/load-mode-rollback.sql',
];
const permissionPaths = [
  'sql/routine-write-permission-precheck.sql',
  'sql/routine-write-enablement.sql',
  'sql/routine-write-enablement-rollback.sql',
  'sql/routine-write-step-precheck.sql',
  'sql/routine-write-baseline.sql',
];
const stepMasks: Record<string, string> = {
  'sql/load-mode.sql':
    'routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=absent:update_owned_program=absent:save_manual_program=absent',
  'sql/program-day-archive.sql':
    'routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=absent:update_owned_program=absent:save_manual_program=absent',
  'sql/exercise-ownership.sql':
    'routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=closed:update_owned_program=absent:save_manual_program=absent',
  'sql/routine-edit.sql':
    'routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=closed:update_owned_program=closed:save_manual_program=closed',
};
const schemaAfter: Record<string, string> = {
  'sql/load-mode.sql': '3:1:1:0:0:c:0:1:0',
  'sql/program-day-archive.sql': '3:1:1:1:0:c:0:1:0',
  'sql/exercise-ownership.sql': '3:1:1:1:1:a:3:0:0',
  'sql/routine-edit.sql': '3:1:1:1:1:a:3:0:6',
};
const schemaStateSql = `
  SELECT
    (SELECT count(*)::text FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'workout_sets'
        AND column_name IN ('load_mode', 'assistance', 'weight_unit'))
    || ':' ||
    (SELECT count(*)::text FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'program_exercises'
        AND column_name = 'load_mode')
    || ':' ||
    (SELECT count(*)::text FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = 'record_tracked_set')
    || ':' ||
    (SELECT count(*)::text FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'program_days'
        AND column_name = 'archived_at')
    || ':' ||
    (SELECT count(*)::text FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'exercises'
        AND column_name = 'owner_user_id')
    || ':' ||
    (SELECT confdeltype::text FROM pg_catalog.pg_constraint
      WHERE conname = 'program_exercises_exercise_id_fkey')
    || ':' ||
    (SELECT count(*)::text FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('normalize_exercise_name', 'seed_standard_exercises', 'create_custom_exercise'))
    || ':' ||
    (SELECT count(*)::text FROM pg_catalog.pg_policy
      WHERE polrelid = 'public.exercises'::regclass
        AND polname = 'exercises_select_authenticated')
    || ':' ||
    (SELECT count(*)::text FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN (
          'routine_require_int',
          'routine_normalize_days',
          'resolve_routine_exercise',
          'routine_write_days',
          'update_owned_program',
          'save_manual_program'
        ));
`;
const writePrivilegeSql = `
  SELECT has_function_privilege('authenticated', 'public.update_owned_program(jsonb)', 'EXECUTE')::text
    || ':' || has_function_privilege('anon', 'public.update_owned_program(jsonb)', 'EXECUTE')::text
    || ':' || has_function_privilege('public', 'public.update_owned_program(jsonb)', 'EXECUTE')::text
    || ':' || has_function_privilege('service_role', 'public.update_owned_program(jsonb)', 'EXECUTE')::text
    || ':' || has_function_privilege('authenticated', 'public.seed_standard_exercises(jsonb)', 'EXECUTE')::text
    || ':' || has_function_privilege('authenticated', 'public.resolve_routine_exercise(uuid,jsonb)', 'EXECUTE')::text
    || ':' || has_function_privilege('authenticated', 'public.create_custom_exercise(text)', 'EXECUTE')::text
    || ':' || has_function_privilege('authenticated', 'public.save_manual_program(jsonb)', 'EXECUTE')::text
    || ':' || has_function_privilege('authenticated', 'public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)', 'EXECUTE')::text
    || ':' || has_function_privilege('anon', 'public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)', 'EXECUTE')::text
    || ':' || has_function_privilege('service_role', 'public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)', 'EXECUTE')::text;
`;
const writePrivilegesEnabled = 'true:false:false:false:false:false:true:true:true:false:false';

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
  return run(psqlPath, [
    '-h', '127.0.0.1',
    '-p', String(port),
    '-U', 'postgres',
    '-d', databaseName,
    '-X',
    '-A',
    '-t',
    '-v', 'ON_ERROR_STOP=1',
    '-q',
  ], sql);
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

function asRole(role: string, statement: string) {
  return `
BEGIN;
SET LOCAL ROLE ${role};
${statement}
COMMIT;
`;
}

function abortBeforeCommit(sql: string) {
  const begins = sql.match(/^\s*BEGIN\s*;\s*$/gim) ?? [];
  const commits = sql.match(/^\s*COMMIT\s*;\s*$/gim) ?? [];
  assert.equal(begins.length, 1, 'expected one BEGIN');
  assert.equal(commits.length, 1, 'expected one COMMIT');
  const aborted = sql.replace(/\r?\n[ \t]*COMMIT\s*;\s*$/i, `
DO $atomic$
BEGIN
  RAISE EXCEPTION 'atomic_file_failed';
END
$atomic$;
`);
  assert.equal(/^\s*COMMIT\s*;\s*$/im.test(aborted), false);
  assert.match(aborted, /atomic_file_failed/);
  return aborted;
}

async function assertPermissionDenied(
  runSql: (sql: string) => Promise<{ code: number; stdout: string; stderr: string }>,
  sql: string,
  label: string,
) {
  const result = await runSql(sql);
  assert.notEqual(result.code, 0, label);
  assert.match(result.stderr, /permission denied for function/i, `${label}\n${result.stderr}`);
}

function payload(json: unknown) {
  return `$payload$${JSON.stringify(json)}$payload$::jsonb`;
}

async function exerciseGrantList() {
  const result = await psql(`
    SELECT coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '')
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'exercises'
      AND grantee = 'authenticated';
  `);
  assert.equal(result.code, 0, result.stderr);
  return result.stdout.trim();
}

function assertGrantList(grants: string) {
  for (const privilege of ['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']) {
    assert.equal(grants.split(',').includes(privilege), true, grants);
  }
}

const finishedSetsSql = `
  SELECT coalesce(string_agg(
    id::text || ':' || coalesce(weight::text, 'null') || ':' || coalesce(reps::text, 'null'),
    ',' ORDER BY id
  ), '')
  FROM public.workout_sets
  WHERE workout_session_id IN (
    SELECT id FROM public.workout_sessions WHERE finished_at IS NOT NULL
  );
`;

const sessionsSql = `
  SELECT coalesce(string_agg(
    id::text || ':' || coalesce(program_day_id::text, '') || ':' ||
      CASE WHEN finished_at IS NULL THEN 'open' ELSE 'finished' END,
    ',' ORDER BY id
  ), '')
  FROM public.workout_sessions;
`;

async function main() {
  for (const path of [...sqlPaths, ...rollbackPaths, ...permissionPaths]) {
    const text = await readFile(join(root, path), 'utf8');
    assert.equal(text.startsWith('-- NOT APPLIED.'), true, path);
    assert.equal(/supabase\.co|postgres:\/\/|password\s*=/i.test(text), false, path);
  }
  for (const path of sqlPaths) {
    const text = await readFile(join(root, path), 'utf8');
    assert.equal(/\bGRANT\s+EXECUTE\b/i.test(text), false, path);
    abortBeforeCommit(text);
  }
  for (const path of ['sql/load-mode.sql', 'sql/exercise-ownership.sql', 'sql/routine-edit.sql']) {
    const text = await readFile(join(root, path), 'utf8');
    assert.match(text, /FROM PUBLIC, anon, authenticated, service_role/);
  }
  const precheckText = await readFile(join(root, permissionPaths[0]), 'utf8');
  assert.match(precheckText, /default_transaction_read_only = on/);
  assert.match(precheckText, /routine_write_permission_open/);
  assert.match(precheckText, /routine_write_overload/);
  assert.match(precheckText, /routine_write_signature_missing/);
  assert.match(precheckText, /service_role/);
  assert.equal(/^\s*(GRANT|REVOKE)\b/im.test(precheckText), false);
  const stepPrecheckText = await readFile(join(root, permissionPaths[3]), 'utf8');
  assert.match(stepPrecheckText, /default_transaction_read_only = on/);
  assert.match(stepPrecheckText, /routine_write_step_closed/);
  assert.match(stepPrecheckText, /routine_write_permission_open/);
  assert.match(stepPrecheckText, /routine_write_overload/);
  assert.equal(/^\s*(GRANT|REVOKE)\b/im.test(stepPrecheckText), false);
  const baselineText = await readFile(join(root, permissionPaths[4]), 'utf8');
  assert.match(baselineText, /default_transaction_read_only = on/);
  assert.match(baselineText, /routine_write_baseline_ready/);
  assert.match(baselineText, /routine_write_function_present/);
  assert.match(baselineText, /routine_write_overload/);
  assert.match(baselineText, /routine_write_baseline_differs/);
  assert.equal(/^\s*(GRANT|REVOKE)\b/im.test(baselineText), false);
  assert.equal(
    /SELECT\s+public\.(record_tracked_set|create_custom_exercise|update_owned_program|save_manual_program)\s*\(/i.test(baselineText),
    false,
  );
  async function expectBaselineReady(
    runSql: (sql: string) => Promise<{ code: number; stdout: string; stderr: string }>,
    label: string,
  ) {
    const baseline = await runSql(baselineText);
    assert.equal(baseline.code, 0, `${label}\n${baseline.stderr}`);
    assert.equal(baseline.stdout.trim(), 'routine_write_baseline_ready', label);
  }
  async function expectBaselineRejects(
    runSql: (sql: string) => Promise<{ code: number; stdout: string; stderr: string }>,
    token: RegExp,
    label: string,
  ) {
    const baseline = await runSql(baselineText);
    assert.notEqual(baseline.code, 0, label);
    assert.match(baseline.stderr, token, `${label}\n${baseline.stderr}`);
    assert.equal(baseline.stdout.includes('routine_write_baseline_ready'), false, baseline.stdout);
  }
  async function expectStep(
    runSql: (sql: string) => Promise<{ code: number; stdout: string; stderr: string }>,
    path: string,
  ) {
    const step = await runSql(stepPrecheckText);
    assert.equal(step.code, 0, `${path}\n${step.stderr}`);
    assert.equal(step.stdout.trim(), stepMasks[path], path);
  }
  async function expectFullPrecheckIncomplete(
    runSql: (sql: string) => Promise<{ code: number; stdout: string; stderr: string }>,
    label: string,
  ) {
    const full = await runSql(precheckText);
    assert.notEqual(full.code, 0, label);
    assert.match(full.stderr, /routine_write_signature_missing/, `${label}\n${full.stderr}`);
    assert.equal(full.stdout.includes('routine_write_permissions_closed'), false, full.stdout);
  }
  const enablementText = await readFile(join(root, permissionPaths[1]), 'utf8');
  assert.match(enablementText, /GRANT EXECUTE ON FUNCTION public\.record_tracked_set/);
  assert.match(enablementText, /GRANT EXECUTE ON FUNCTION public\.create_custom_exercise\(text\) TO authenticated/);
  assert.match(enablementText, /GRANT EXECUTE ON FUNCTION public\.update_owned_program\(jsonb\) TO authenticated/);
  assert.match(enablementText, /GRANT EXECUTE ON FUNCTION public\.save_manual_program\(jsonb\) TO authenticated/);
  assert.equal(/GRANT\s+EXECUTE[\s\S]*\bTO\s+(anon|PUBLIC|service_role)\b/i.test(enablementText), false);
  const enablementRollbackText = await readFile(join(root, permissionPaths[2]), 'utf8');
  assert.equal(/\bGRANT\s+EXECUTE\b/i.test(enablementRollbackText), false);
  assert.equal(/\bDROP\s+(FUNCTION|TABLE|COLUMN|POLICY)\b/i.test(enablementRollbackText), false);
  assert.match(enablementRollbackText, /FROM PUBLIC, anon, authenticated, service_role/);
  const deploymentText = await readFile(join(root, 'sql/routine-write-deployment.md'), 'utf8');
  assert.match(deploymentText, /routine_write_permissions_closed/);
  assert.match(deploymentText, /load_mode_rollback_blocked/);
  assert.match(deploymentText, /exercise_owner_rollback_blocked/);
  assert.match(deploymentText, /archive_order_rollback_blocked/);
  assert.match(deploymentText, /Out of scope/);
  assert.match(deploymentText, /service_role/);
  assert.match(deploymentText, /Failure-recovery matrix/);
  assert.match(deploymentText, /routine_write_baseline_ready/);
  assert.match(deploymentText, /has_function_privilege/);
  assert.match(deploymentText, /Do not execute the functions/);
  assert.equal(
    /SELECT\s+public\.(record_tracked_set|create_custom_exercise|update_owned_program|save_manual_program)\s*\(/i.test(deploymentText),
    false,
  );
  for (const mask of new Set(Object.values(stepMasks))) {
    assert.match(deploymentText, new RegExp(mask.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  const ownershipRollbackText = await readFile(join(root, 'sql/exercise-ownership-rollback.sql'), 'utf8');
  assert.match(ownershipRollbackText, /exercise_owner_rollback_blocked/);
  assert.match(ownershipRollbackText, /owner_user_id was not dropped/);
  assert.equal(/DROP\s+CONSTRAINT\s+exercises_name_key/i.test(ownershipRollbackText), false);
  const archiveRollbackText = await readFile(join(root, 'sql/program-day-archive-rollback.sql'), 'utf8');
  assert.match(archiveRollbackText, /archive_order_rollback_blocked/);
  assert.match(archiveRollbackText, /archived_at was not dropped/);
  const loadRollbackText = await readFile(join(root, 'sql/load-mode-rollback.sql'), 'utf8');
  assert.match(loadRollbackText, /load_mode_rollback_blocked/);
  assert.match(loadRollbackText, /tracking columns were not dropped/);
  assert.equal(/UPDATE\s+public\.workout_sets\s+SET\s+weight/i.test(loadRollbackText), false);
  assert.match(archiveRollbackText, /day_order >= 100000/);

  const plannedNames = PLANNED_EXERCISES.map((item) => item.name);
  const normalizedNames = plannedNames.map((name) => normalizeExerciseName(name));
  assert.equal(new Set(normalizedNames).size, normalizedNames.length);
  assert.ok(plannedNames.length >= 300 && plannedNames.length <= 500);
  const bench = 'Barbell Bench Press';
  assert.equal(plannedNames.includes(bench), true);
  const customPlanned = plannedNames.find((name) => normalizeExerciseName(name) !== normalizeExerciseName(bench));
  assert.ok(customPlanned);
  assert.equal(normalizeExerciseName('  Band-Fly  '), 'band fly');

  const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-routine-pg-'));
  const logFile = join(dataDir, 'server.log');
  let started = false;
  try {
    const initialized = await run(initdbPath, [
      '-D', dataDir,
      '-U', 'postgres',
      '--auth=trust',
      '--encoding=UTF8',
      '--no-locale',
    ]);
    assert.equal(initialized.code, 0, initialized.stderr);
    await writeFile(
      join(dataDir, 'postgresql.conf'),
      "\nlisten_addresses = '127.0.0.1'\nport = 55441\n",
      { flag: 'a' },
    );
    const startedResult = await run(pgCtlPath, ['-D', dataDir, '-l', logFile, '-w', 'start']);
    assert.equal(
      startedResult.code,
      0,
      `${startedResult.stderr}\n${await readFile(logFile, 'utf8').catch(() => '')}`,
    );
    started = true;

    const created = await psql(`CREATE DATABASE ${database};`, 'postgres');
    assert.equal(created.code, 0, created.stderr);

    const fixture = await psql(await readFile(join(root, 'scripts/fixtures/production-shape.sql'), 'utf8'));
    assert.equal(fixture.code, 0, fixture.stderr);

    const backupDayOrder = await psql(`
      SELECT pg_catalog.pg_get_constraintdef(oid)
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.program_days'::regclass
        AND conname = 'program_days_day_order_key';
    `);
    assert.equal(backupDayOrder.code, 0, backupDayOrder.stderr);
    assert.equal(backupDayOrder.stdout.trim(), 'UNIQUE (day_order)');
    const perProgramBefore = await psql(`
      SELECT count(*)
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.program_days'::regclass
        AND conname = 'program_days_program_id_day_order_key';
    `);
    assert.equal(perProgramBefore.stdout.trim(), '0');
    const policyBefore = await psql(`
      SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
      FROM pg_catalog.pg_policy pol
      WHERE pol.polrelid = 'public.exercises'::regclass
        AND pol.polname = 'exercises_select_authenticated';
    `);
    assert.equal(policyBefore.stdout.trim(), 'true');
    const confirmedLiveDayOrder = 'UNIQUE NULLS NOT DISTINCT (program_id, day_order)';
    const deleteActions = await psql(`
      SELECT conname || ':' || confdeltype::text
      FROM pg_catalog.pg_constraint
      WHERE conname IN (
        'program_exercises_exercise_id_fkey',
        'program_exercises_program_day_id_fkey',
        'program_template_exercises_exercise_id_fkey',
        'workout_sets_exercise_id_fkey'
      )
      ORDER BY conname;
    `);
    assert.deepEqual(deleteActions.stdout.trim().split(/\r?\n/), [
      'program_exercises_exercise_id_fkey:c',
      'program_exercises_program_day_id_fkey:c',
      'program_template_exercises_exercise_id_fkey:a',
      'workout_sets_exercise_id_fkey:a',
    ]);
    const grantsBefore = await exerciseGrantList();
    assertGrantList(grantsBefore);
    const anonSelect = await psql(`
      SELECT has_table_privilege('anon', 'public.exercises', 'SELECT')::text;
    `);
    assert.equal(anonSelect.stdout.trim(), 'false');

    const reportedProduction = [
      'sql/ai-import-day-order.sql',
      'sql/ai-import-quota.sql',
      'sql/ai-import-save-program.sql',
    ];
    for (const path of reportedProduction) {
      const applied = await psql(await readFile(join(root, path), 'utf8'));
      assert.equal(applied.code, 0, `${path}\n${applied.stderr}`);
    }
    const currentDayOrder = await psql(`
      SELECT pg_catalog.pg_get_constraintdef(oid)
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.program_days'::regclass
        AND conname = 'program_days_program_id_day_order_key';
    `);
    assert.equal(currentDayOrder.stdout.trim(), confirmedLiveDayOrder);
    const oldDayOrder = await psql(`
      SELECT count(*)
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.program_days'::regclass
        AND conname = 'program_days_day_order_key';
    `);
    assert.equal(oldDayOrder.stdout.trim(), '0');
    console.log(
      `disposable day_order matches confirmed live production: ${confirmedLiveDayOrder}`,
    );

    const synthetic = await psql(`
      INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}');
      INSERT INTO public.exercises (name) VALUES ('${bench}');
      INSERT INTO public.programs (user_id, name, slug, is_active)
      VALUES
        ('${userA}', 'Home', NULL, true),
        ('${userB}', 'Other', NULL, true);
      INSERT INTO public.program_days (program_id, name, subtitle, day_order)
      VALUES
        (1, 'Push', NULL, 1),
        (1, 'Pull', 'Keep', 2),
        (1, 'Rest', NULL, 3);
      INSERT INTO public.program_exercises (
        program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps, notes
      )
      VALUES
        (1, 1, 1, 3, 8, 10, NULL),
        (2, 1, 1, 3, 5, 8, NULL);
      INSERT INTO public.workout_sessions (user_id, program_day_id, started_at, finished_at)
      VALUES
        ('${userA}', 2, timestamptz '2026-01-02T00:00:00Z', timestamptz '2026-01-02T01:00:00Z'),
        ('${userA}', 2, timestamptz '2026-03-01T00:00:00Z', NULL);
      INSERT INTO public.workout_sets (
        workout_session_id, exercise_id, set_number, weight, reps, rir, is_completed
      )
      VALUES
        (1, 1, 1, 135, 5, 2, true),
        (1, 1, 2, -4, 3, NULL, true),
        (1, 1, 3, 0, 8, NULL, true),
        (1, 1, 4, NULL, 4, NULL, true),
        (2, 1, 1, 100, 5, 1, false);
    `);
    assert.equal(synthetic.code, 0, synthetic.stderr);
    const programIds = await psql(`
      SELECT user_id::text || ':' || id::text
      FROM public.programs
      ORDER BY id;
    `);
    assert.deepEqual(programIds.stdout.trim().split(/\r?\n/), [`${userA}:1`, `${userB}:2`]);
    const benchDefaults = await psql(`
      SELECT exercise_type || '|' || equipment_type
      FROM public.exercises
      WHERE id = 1;
    `);
    assert.equal(benchDefaults.stdout.trim(), 'weighted|machine');

    const finishedBefore = await psql(finishedSetsSql);
    const sessionsBefore = await psql(sessionsSql);
    assert.equal(finishedBefore.code, 0, finishedBefore.stderr);
    assert.equal(sessionsBefore.code, 0, sessionsBefore.stderr);
    const finishedSnapshot = finishedBefore.stdout.trim();
    const sessionSnapshot = sessionsBefore.stdout.trim();
    assert.match(finishedSnapshot, /135/);
    assert.match(finishedSnapshot, /-4/);

    const aclProbe = await psql(`
      CREATE FUNCTION public.routine_write_acl_probe()
      RETURNS void
      LANGUAGE sql
      AS 'SELECT NULL';
      SELECT 'new_public:' || has_function_privilege('public', 'public.routine_write_acl_probe()', 'EXECUTE')::text
        || ':new_authenticated:' || has_function_privilege('authenticated', 'public.routine_write_acl_probe()', 'EXECUTE')::text;
      REVOKE ALL ON FUNCTION public.routine_write_acl_probe() FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.routine_write_acl_probe() TO authenticated;
      CREATE OR REPLACE FUNCTION public.routine_write_acl_probe()
      RETURNS void
      LANGUAGE sql
      AS 'SELECT NULL';
      SELECT 'replaced_public:' || has_function_privilege('public', 'public.routine_write_acl_probe()', 'EXECUTE')::text
        || ':replaced_authenticated:' || has_function_privilege('authenticated', 'public.routine_write_acl_probe()', 'EXECUTE')::text;
      REVOKE ALL ON FUNCTION public.routine_write_acl_probe() FROM PUBLIC;
      SELECT 'revoke_public_only:' || has_function_privilege('public', 'public.routine_write_acl_probe()', 'EXECUTE')::text
        || ':' || has_function_privilege('authenticated', 'public.routine_write_acl_probe()', 'EXECUTE')::text;
      CREATE FUNCTION public.routine_write_acl_probe(integer)
      RETURNS void
      LANGUAGE sql
      AS 'SELECT NULL';
      SELECT 'overload_public:' || has_function_privilege('public', 'public.routine_write_acl_probe(integer)', 'EXECUTE')::text
        || ':original_public:' || has_function_privilege('public', 'public.routine_write_acl_probe()', 'EXECUTE')::text
        || ':original_authenticated:' || has_function_privilege('authenticated', 'public.routine_write_acl_probe()', 'EXECUTE')::text;
      DROP FUNCTION public.routine_write_acl_probe();
      DROP FUNCTION public.routine_write_acl_probe(integer);
    `);
    assert.equal(aclProbe.code, 0, aclProbe.stderr);
    assert.deepEqual(aclProbe.stdout.trim().split(/\r?\n/), [
      'new_public:true:new_authenticated:true',
      'replaced_public:false:replaced_authenticated:true',
      'revoke_public_only:false:true',
      'overload_public:true:original_public:false:original_authenticated:true',
    ]);
    await expectBaselineReady(psql, 'main baseline');
    const defaultPrivileges = await psql(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    `);
    assert.equal(defaultPrivileges.code, 0, defaultPrivileges.stderr);

    for (const path of sqlPaths) {
      const applied = await psql(await readFile(join(root, path), 'utf8'));
      assert.equal(applied.code, 0, `${path}\n${applied.stderr}`);
      await expectStep(psql, path);
      if (path === 'sql/load-mode.sql') {
        await expectBaselineRejects(psql, /routine_write_function_present/, 'baseline after load-mode');
      }
      if (path !== 'sql/routine-edit.sql') {
        await expectFullPrecheckIncomplete(psql, path);
      }
    }
    assert.equal(await exerciseGrantList(), grantsBefore);
    const fkAfter = await psql(`
      SELECT confdeltype::text
      FROM pg_catalog.pg_constraint
      WHERE conname = 'program_exercises_exercise_id_fkey';
    `);
    assert.equal(fkAfter.stdout.trim(), 'a');
    const nameKey = await psql(`
      SELECT pg_catalog.pg_get_constraintdef(oid)
      FROM pg_catalog.pg_constraint
      WHERE conname = 'exercises_name_key';
    `);
    assert.equal(nameKey.stdout.trim(), 'UNIQUE (name)');

    const finishedAfterMigration = await psql(finishedSetsSql);
    const sessionsAfterMigration = await psql(sessionsSql);
    assert.equal(finishedAfterMigration.stdout.trim(), finishedSnapshot);
    assert.equal(sessionsAfterMigration.stdout.trim(), sessionSnapshot);

    const normalized = await psql(`SELECT public.normalize_exercise_name('  Band-Fly  ');`);
    assert.equal(normalized.code, 0, normalized.stderr);
    assert.equal(normalized.stdout.trim(), 'band fly');

    const legacyNegative = await psql(`
      INSERT INTO public.workout_sets (
        workout_session_id, exercise_id, set_number, weight, reps, is_completed
      )
      VALUES (2, 1, 9, -9, 1, false);
    `);
    assert.equal(legacyNegative.code, 0, legacyNegative.stderr);
    const mixedMode = await psql(`
      INSERT INTO public.workout_sets (
        workout_session_id, exercise_id, set_number, weight, assistance, load_mode, weight_unit, reps, is_completed
      )
      VALUES (2, 1, 10, 10, 5, 'added', 'lb', 5, false);
    `);
    assert.notEqual(mixedMode.code, 0);
    assert.match(mixedMode.stderr, /workout_sets_tracked_load_check/);

    const closed = await psql(precheckText);
    assert.equal(closed.code, 0, closed.stderr);
    assert.match(closed.stdout, /routine_write_permissions_closed/);
    const blockedCall = `SELECT public.record_tracked_set(2, 1, 1, 'added', 10, NULL, 'lb', 8, 2, true);`;
    await assertPermissionDenied(psql, asUser(userA, blockedCall), 'authenticated record_tracked_set');
    await assertPermissionDenied(psql, asRole('anon', blockedCall), 'anon record_tracked_set');
    await assertPermissionDenied(psql, asRole('service_role', blockedCall), 'service_role record_tracked_set');
    await assertPermissionDenied(
      psql,
      asUser(userA, `SELECT public.create_custom_exercise('Should Not Run');`),
      'authenticated create_custom_exercise',
    );
    await assertPermissionDenied(
      psql,
      asUser(userA, `SELECT public.update_owned_program('{}'::jsonb);`),
      'authenticated update_owned_program',
    );
    await assertPermissionDenied(
      psql,
      asUser(userA, `SELECT public.save_manual_program('{}'::jsonb);`),
      'authenticated save_manual_program',
    );
    const unchangedSet = await psql(`
      SELECT weight::text
      FROM public.workout_sets
      WHERE workout_session_id = 2 AND set_number = 1;
    `);
    assert.equal(unchangedSet.stdout.trim(), '100');
    const customNotInserted = await psql(`
      SELECT count(*) FROM public.exercises WHERE name = 'Should Not Run';
    `);
    assert.equal(customNotInserted.stdout.trim(), '0');
    const enabled = await psql(enablementText);
    assert.equal(enabled.code, 0, enabled.stderr);
    assert.match(enabled.stdout, /routine_write_permissions_enabled/);
    const openAfterEnablement = await psql(precheckText);
    assert.notEqual(openAfterEnablement.code, 0);
    assert.match(openAfterEnablement.stderr, /routine_write_permission_open/);
    const enabledPrivileges = await psql(writePrivilegeSql);
    assert.equal(enabledPrivileges.stdout.trim(), writePrivilegesEnabled);

    const trackedCall = (userId: string, args: string) => psql(asUser(
      userId,
      `SELECT public.record_tracked_set(${args});`,
    ));
    const historyLocked = await trackedCall(
      userA,
      '1, 1, 1, \'added\', 10, NULL, \'lb\', 5, 2, true',
    );
    assert.notEqual(historyLocked.code, 0);
    assert.match(historyLocked.stderr, /history_locked/);
    const stranger = await trackedCall(
      userB,
      '2, 1, 1, \'added\', 10, NULL, \'lb\', 5, NULL, false',
    );
    assert.notEqual(stranger.code, 0);
    assert.match(stranger.stderr, /session_not_found/);
    const badAmount = await trackedCall(
      userA,
      '2, 1, 4, \'added\', 10, 5, \'lb\', 5, NULL, false',
    );
    assert.notEqual(badAmount.code, 0);
    assert.match(badAmount.stderr, /invalid_load_amount/);
    const missingSet = await psql(`
      SELECT count(*) FROM public.workout_sets WHERE workout_session_id = 2 AND set_number = 4;
    `);
    assert.equal(missingSet.stdout.trim(), '0');

    const added = await trackedCall(
      userA,
      '2, 1, 1, \'added\', 10, NULL, \'lb\', 8, 2, true',
    );
    assert.equal(added.code, 0, added.stderr);
    const addedAgain = await trackedCall(
      userA,
      '2, 1, 1, \'added\', 15, NULL, \'kg\', 8, 1, true',
    );
    assert.equal(addedAgain.code, 0, addedAgain.stderr);
    assert.equal(added.stdout.trim(), addedAgain.stdout.trim());
    const addedRow = await psql(`
      SELECT load_mode || ':' || weight::text || ':' || coalesce(assistance::text, 'null') || ':' || weight_unit
      FROM public.workout_sets
      WHERE workout_session_id = 2 AND set_number = 1;
    `);
    assert.equal(addedRow.stdout.trim(), 'added:15:null:kg');
    const assisted = await trackedCall(
      userA,
      '2, 1, 2, \'assisted\', NULL, 20, \'lb\', 6, NULL, true',
    );
    assert.equal(assisted.code, 0, assisted.stderr);
    const assistedRow = await psql(`
      SELECT load_mode || ':' || coalesce(weight::text, 'null') || ':' || assistance::text || ':' || weight_unit
      FROM public.workout_sets
      WHERE id = ${assisted.stdout.trim()};
    `);
    assert.equal(assistedRow.stdout.trim(), 'assisted:null:20:lb');
    const bodyweight = await trackedCall(
      userA,
      '2, 1, 3, \'bodyweight\', NULL, NULL, \'lb\', 8, NULL, true',
    );
    assert.equal(bodyweight.code, 0, bodyweight.stderr);
    const bodyweightRow = await psql(`
      SELECT load_mode || ':' || coalesce(weight::text, 'null') || ':' || coalesce(assistance::text, 'null')
      FROM public.workout_sets
      WHERE id = ${bodyweight.stdout.trim()};
    `);
    assert.equal(bodyweightRow.stdout.trim(), 'bodyweight:null:null');

    const emptyEdit = await psql(asUser(userA, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Home',
        days: [],
      })});
    `));
    assert.notEqual(emptyEdit.code, 0);
    assert.match(emptyEdit.stderr, /invalid_import: day_count/);
    const dayCount = await psql(`SELECT count(*) FROM public.program_days WHERE program_id = 1;`);
    assert.equal(dayCount.stdout.trim(), '3');

    const stolen = await psql(asUser(userB, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Stolen',
        days: [{ day_id: 1, name: 'Push', subtitle: null, exercises: [] }],
      })});
    `));
    assert.notEqual(stolen.code, 0);
    assert.match(stolen.stderr, /program_not_found/);
    const stillHome = await psql(`SELECT name || ':' || is_active::text FROM public.programs WHERE id = 1;`);
    assert.equal(stillHome.stdout.trim(), 'Home:true');

    const rolledBack = await psql(asUser(userA, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Should Not Stick',
        days: [
          {
            day_id: 1,
            name: 'Renamed',
            subtitle: null,
            exercises: [
              {
                custom_name: 'Band Fly',
                target_sets: 3,
                min_reps: 8,
                max_reps: 12,
                notes: null,
                load_mode: 'bodyweight',
              },
            ],
          },
          {
            name: 'Broken',
            subtitle: null,
            exercises: [
              { exercise_id: 99999, target_sets: 3, min_reps: 8, max_reps: 12, notes: null },
            ],
          },
        ],
      })});
    `));
    assert.notEqual(rolledBack.code, 0);
    assert.match(rolledBack.stderr, /unknown_exercise/);
    const afterRollbackAttempt = await psql(`
      SELECT
        (SELECT name FROM public.programs WHERE id = 1) || '|' ||
        (SELECT name FROM public.program_days WHERE id = 1) || '|' ||
        (SELECT count(*) FROM public.exercises WHERE public.normalize_exercise_name(name) = 'band fly')::text || '|' ||
        (SELECT count(*) FROM public.program_days)::text;
    `);
    assert.equal(afterRollbackAttempt.stdout.trim(), 'Home|Push|0|3');
    const finishedAfterFailure = await psql(finishedSetsSql);
    const sessionsAfterFailure = await psql(sessionsSql);
    assert.equal(finishedAfterFailure.stdout.trim(), finishedSnapshot);
    assert.equal(sessionsAfterFailure.stdout.trim(), sessionSnapshot);

    const edited = await psql(asUser(userA, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Home edited',
        days: [
          {
            day_id: 1,
            name: 'Push day',
            subtitle: 'Upper',
            exercises: [
              {
                exercise_id: 1,
                target_sets: 4,
                min_reps: 6,
                max_reps: 10,
                notes: 'Pause',
                load_mode: 'added',
              },
            ],
          },
          { name: 'Legs', subtitle: null, exercises: [] },
        ],
      })});
    `));
    assert.equal(edited.code, 0, edited.stderr);
    const shape = await psql(`
      SELECT id::text || ':' || name || ':' || coalesce(archived_at::text, 'active') || ':' || day_order::text
      FROM public.program_days
      WHERE program_id = 1
      ORDER BY id;
    `);
    assert.match(shape.stdout, /^1:Push day:active:1/m);
    assert.match(shape.stdout, /^2:Pull:/m);
    assert.match(shape.stdout, /:10000/);
    assert.equal(shape.stdout.includes('\n3:'), false);
    const archived = await psql(`
      SELECT (archived_at IS NOT NULL)::text || ':' || (day_order >= 100000)::text
      FROM public.program_days
      WHERE id = 2;
    `);
    assert.equal(archived.stdout.trim(), 'true:true');
    const prescription = await psql(`
      SELECT exercise_id::text || ':' || target_sets::text || ':' || min_reps::text || ':' ||
        max_reps::text || ':' || coalesce(notes, '') || ':' || coalesce(load_mode, '')
      FROM public.program_exercises
      WHERE program_day_id = 1;
    `);
    assert.equal(prescription.stdout.trim(), '1:4:6:10:Pause:added');
    const legs = await psql(`
      SELECT id::text
      FROM public.program_days
      WHERE program_id = 1 AND name = 'Legs' AND archived_at IS NULL;
    `);
    const legsId = Number(legs.stdout.trim());
    assert.equal(Number.isInteger(legsId) && legsId > 0, true);
    const archivedAt = await psql(`SELECT archived_at::text FROM public.program_days WHERE id = 2;`);
    const sessionLink = await psql(`SELECT program_day_id::text FROM public.workout_sessions WHERE id = 1;`);
    assert.equal(sessionLink.stdout.trim(), '2');
    const activeFlag = await psql(`SELECT is_active::text FROM public.programs WHERE id = 1;`);
    assert.equal(activeFlag.stdout.trim(), 'true');

    const repeat = await psql(asUser(userA, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Home edited',
        days: [
          {
            day_id: 1,
            name: 'Push day',
            subtitle: 'Upper',
            exercises: [
              {
                exercise_id: 1,
                target_sets: 4,
                min_reps: 6,
                max_reps: 10,
                notes: 'Pause',
                load_mode: 'added',
              },
            ],
          },
          { day_id: legsId, name: 'Legs', subtitle: null, exercises: [] },
        ],
      })});
    `));
    assert.equal(repeat.code, 0, repeat.stderr);
    const shapeAgain = await psql(`
      SELECT id::text || ':' || name || ':' || coalesce(archived_at::text, 'active') || ':' || day_order::text
      FROM public.program_days
      WHERE program_id = 1
      ORDER BY id;
    `);
    assert.equal(shapeAgain.stdout.trim(), shape.stdout.trim());
    const archivedAtAgain = await psql(`SELECT archived_at::text FROM public.program_days WHERE id = 2;`);
    assert.equal(archivedAtAgain.stdout.trim(), archivedAt.stdout.trim());
    const dayCountAgain = await psql(`SELECT count(*) FROM public.program_days WHERE program_id = 1;`);
    assert.equal(dayCountAgain.stdout.trim(), '3');

    const lockedDay = await psql(asUser(userA, `
      SELECT public.update_owned_program(${payload({
        program_id: 1,
        name: 'Home edited',
        days: [
          { day_id: 2, name: 'Pull again', subtitle: null, exercises: [] },
          { day_id: legsId, name: 'Legs', subtitle: null, exercises: [] },
        ],
      })});
    `));
    assert.notEqual(lockedDay.code, 0);
    assert.match(lockedDay.stderr, /archived_day_locked/);
    const nameAfterLock = await psql(`SELECT name FROM public.programs WHERE id = 1;`);
    assert.equal(nameAfterLock.stdout.trim(), 'Home edited');

    const ownerDay = await psql(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${userA}', true) \\gset
      SET LOCAL ROLE authenticated;
      WITH updated AS (
        UPDATE public.program_days SET name = 'Temp rename' WHERE id = 1 RETURNING id
      )
      SELECT count(*)::text FROM updated;
      ROLLBACK;
    `);
    assert.equal(ownerDay.code, 0, ownerDay.stderr);
    assert.equal(ownerDay.stdout.trim(), '1');
    const strangerDay = await psql(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${userB}', true) \\gset
      SET LOCAL ROLE authenticated;
      WITH updated AS (
        UPDATE public.program_days SET name = 'Hacked' WHERE id = 1 RETURNING id
      )
      SELECT count(*)::text FROM updated;
      ROLLBACK;
    `);
    assert.equal(strangerDay.code, 0, strangerDay.stderr);
    assert.equal(strangerDay.stdout.trim(), '0');
    const dayName = await psql(`SELECT name FROM public.program_days WHERE id = 1;`);
    assert.equal(dayName.stdout.trim(), 'Push day');

    const custom = await psql(asUser(
      userA,
      `SELECT public.create_custom_exercise('${customPlanned.replace(/'/g, "''")}');`,
    ));
    assert.equal(custom.code, 0, custom.stderr);
    const customAgain = await psql(asUser(
      userA,
      `SELECT public.create_custom_exercise('  ${customPlanned.replace(/'/g, "''")}  ');`,
    ));
    assert.equal(customAgain.code, 0, customAgain.stderr);
    assert.equal(custom.stdout.trim(), customAgain.stdout.trim());
    const customId = custom.stdout.trim();
    const customCount = await psql(`
      SELECT count(*)
      FROM public.exercises
      WHERE owner_user_id = '${userA}'
        AND public.normalize_exercise_name(name) = public.normalize_exercise_name('${customPlanned.replace(/'/g, "''")}');
    `);
    assert.equal(customCount.stdout.trim(), '1');
    const catalogClash = await psql(asUser(
      userA,
      `SELECT public.create_custom_exercise('  barbell   bench press ');`,
    ));
    assert.notEqual(catalogClash.code, 0);
    assert.match(catalogClash.stderr, /use_catalog_exercise/);
    const hidden = await psql(asUser(
      userB,
      `SELECT count(*) FROM public.exercises WHERE id = ${customId};`,
    ));
    assert.equal(hidden.code, 0, hidden.stderr);
    assert.equal(hidden.stdout.trim(), '0');
    const visible = await psql(asUser(
      userA,
      `SELECT count(*) FROM public.exercises WHERE id = ${customId};`,
    ));
    assert.equal(visible.stdout.trim(), '1');
    const sharedInsert = await psql(asUser(
      userA,
      `INSERT INTO public.exercises (name, owner_user_id) VALUES ('Shared Fake', NULL);`,
    ));
    assert.notEqual(sharedInsert.code, 0);
    assert.match(sharedInsert.stderr, /row-level security|new row violates/);
    const sharedUpdate = await psql(asUser(
      userA,
      `UPDATE public.exercises SET name = 'Hacked Bench' WHERE id = 1;`,
    ));
    assert.equal(sharedUpdate.code, 0, sharedUpdate.stderr);
    const benchName = await psql(`SELECT name || ':' || coalesce(owner_user_id::text, 'shared') FROM public.exercises WHERE id = 1;`);
    assert.equal(benchName.stdout.trim(), `${bench}:shared`);
    const beforeSeed = await psql(`
      SELECT id::text || '|' || name || '|' || coalesce(owner_user_id::text, 'shared')
      FROM public.exercises
      WHERE id IN (1, ${customId})
      ORDER BY id;
    `);

    const seeded = await psql(`
      SELECT public.seed_standard_exercises($planned$${JSON.stringify(PLANNED_EXERCISES)}$planned$::jsonb);
    `);
    assert.equal(seeded.code, 0, seeded.stderr);
    assert.equal(seeded.stdout.trim(), String(plannedNames.length - 2));
    const afterSeed = await psql(`
      SELECT id::text || '|' || name || '|' || coalesce(owner_user_id::text, 'shared')
      FROM public.exercises
      WHERE id IN (1, ${customId})
      ORDER BY id;
    `);
    assert.equal(afterSeed.stdout.trim(), beforeSeed.stdout.trim());
    const benchUnchanged = await psql(`
      SELECT exercise_type || '|' || equipment_type
      FROM public.exercises
      WHERE id = 1;
    `);
    assert.equal(benchUnchanged.stdout.trim(), 'weighted|machine');
    const pullUp = await psql(`
      SELECT exercise_type || '|' || equipment_type || '|' || category || '|' || warmup_enabled::text
      FROM public.exercises
      WHERE name = 'Pull-Up';
    `);
    assert.equal(pullUp.stdout.trim(), 'bodyweight|bodyweight|Back|false');
    const pushUp = await psql(`
      SELECT exercise_type || '|' || equipment_type || '|' || category
      FROM public.exercises
      WHERE name = 'Push-Up';
    `);
    assert.equal(pushUp.stdout.trim(), 'bodyweight|bodyweight|Chest');
    const bandFlyTaken = await psql(asUser(
      userA,
      `SELECT public.create_custom_exercise('Band Fly');`,
    ));
    assert.notEqual(bandFlyTaken.code, 0);
    assert.match(bandFlyTaken.stderr, /use_catalog_exercise/);
    const seededAgain = await psql(`
      SELECT public.seed_standard_exercises($planned$${JSON.stringify(plannedNames)}$planned$::jsonb);
    `);
    assert.equal(seededAgain.code, 0, seededAgain.stderr);
    assert.equal(seededAgain.stdout.trim(), '0');
    const seedDenied = await psql(asUser(
      userA,
      `SELECT public.seed_standard_exercises('[]'::jsonb);`,
    ));
    assert.notEqual(seedDenied.code, 0);
    assert.match(seedDenied.stderr, /permission denied/);
    const resolveDenied = await psql(asUser(
      userA,
      `SELECT public.resolve_routine_exercise('${userA}'::uuid, '{}'::jsonb);`,
    ));
    assert.notEqual(resolveDenied.code, 0);
    assert.match(resolveDenied.stderr, /permission denied/);

    const badSave = await psql(asUser(userA, `
      SELECT public.save_manual_program(${payload({
        name: 'Nope',
        days: [
          {
            name: 'A',
            subtitle: null,
            exercises: [
              { custom_name: 'Only Once', target_sets: 3, min_reps: 8, max_reps: 12, notes: null },
            ],
          },
          {
            name: 'B',
            subtitle: null,
            exercises: [
              { exercise_id: 99999, target_sets: 3, min_reps: 8, max_reps: 12, notes: null },
            ],
          },
        ],
      })});
    `));
    assert.notEqual(badSave.code, 0);
    assert.match(badSave.stderr, /unknown_exercise/);
    const noNope = await psql(`
      SELECT
        (SELECT count(*) FROM public.programs WHERE name = 'Nope')::text || '|' ||
        (SELECT count(*) FROM public.exercises WHERE name = 'Only Once')::text;
    `);
    assert.equal(noNope.stdout.trim(), '0|0');

    const privateName = 'SyncSetRep Private Fly';
    assert.equal(
      plannedNames.some((name) => normalizeExerciseName(name) === normalizeExerciseName(privateName)),
      false,
    );
    const band = await psql(asUser(userA, `SELECT public.create_custom_exercise('${privateName}');`));
    assert.equal(band.code, 0, band.stderr);
    const bandAgain = await psql(asUser(userA, `SELECT public.create_custom_exercise('syncsetrep private fly');`));
    assert.equal(bandAgain.stdout.trim(), band.stdout.trim());
    const bandShape = await psql(`
      SELECT coalesce(category, 'null') || '|' || coalesce(exercise_type, 'null') || '|' ||
        coalesce(equipment_type, 'null') || '|' || warmup_enabled::text
      FROM public.exercises
      WHERE id = ${band.stdout.trim()};
    `);
    assert.equal(bandShape.stdout.trim(), 'null|null|null|false');
    const nameTaken = await psql(asUser(
      userB,
      `SELECT public.create_custom_exercise('  syncsetrep   private-fly ');`,
    ));
    assert.notEqual(nameTaken.code, 0);
    assert.match(nameTaken.stderr, /exercise_name_taken/);
    assert.equal(/exercises_name_key/i.test(nameTaken.stderr), false);
    const manualPayload = {
      name: 'Manual Arms',
      days: [
        {
          name: 'Arms',
          subtitle: null,
          exercises: [
            {
              custom_name: privateName,
              target_sets: 3,
              min_reps: 8,
              max_reps: 12,
              notes: null,
              load_mode: 'assisted',
            },
          ],
        },
      ],
    };
    const firstManual = await psql(asUser(
      userA,
      `SELECT public.save_manual_program(${payload(manualPayload)});`,
    ));
    assert.equal(firstManual.code, 0, firstManual.stderr);
    const secondManual = await psql(asUser(
      userA,
      `SELECT public.save_manual_program(${payload(manualPayload)});`,
    ));
    assert.equal(secondManual.code, 0, secondManual.stderr);
    assert.notEqual(firstManual.stdout.trim(), secondManual.stdout.trim());
    const manualState = await psql(`
      SELECT
        (SELECT count(*) FROM public.programs WHERE user_id = '${userA}' AND is_active)::text || '|' ||
        (SELECT count(*) FROM public.programs WHERE user_id = '${userA}' AND NOT is_active)::text || '|' ||
        (SELECT is_active::text FROM public.programs WHERE id = 1);
    `);
    assert.equal(manualState.stdout.trim(), '1|2|true');
    const manualExercise = await psql(`
      SELECT exercise_id::text || ':' || coalesce(load_mode, '')
      FROM public.program_exercises
      WHERE program_day_id IN (
        SELECT id FROM public.program_days WHERE program_id = ${firstManual.stdout.trim()}
      );
    `);
    assert.equal(manualExercise.stdout.trim(), `${band.stdout.trim()}:assisted`);

    const otherManual = await psql(asUser(userB, `
      SELECT public.save_manual_program(${payload({
        name: 'Other manual',
        days: [
          {
            name: 'Day',
            subtitle: null,
            exercises: [
              { exercise_id: 1, target_sets: 3, min_reps: 8, max_reps: 10, notes: null },
            ],
          },
        ],
      })});
    `));
    assert.equal(otherManual.code, 0, otherManual.stderr);
    const otherActive = await psql(`
      SELECT count(*) FILTER (WHERE is_active)::text || ':' || count(*)::text
      FROM public.programs
      WHERE user_id = '${userB}';
    `);
    assert.equal(otherActive.stdout.trim(), '1:2');
    const hiddenExercise = await psql(asUser(userB, `
      SELECT public.save_manual_program(${payload({
        name: 'Hidden',
        days: [
          {
            name: 'Day',
            subtitle: null,
            exercises: [
              { exercise_id: Number(customId), target_sets: 3, min_reps: 8, max_reps: 10, notes: null },
            ],
          },
        ],
      })});
    `));
    assert.notEqual(hiddenExercise.code, 0);
    assert.match(hiddenExercise.stderr, /unknown_exercise/);
    const noHidden = await psql(`SELECT count(*) FROM public.programs WHERE name = 'Hidden';`);
    assert.equal(noHidden.stdout.trim(), '0');

    const activeDays = await psql(`
      SELECT id::text
      FROM public.program_days
      WHERE program_id = 1 AND archived_at IS NULL
      ORDER BY day_order, id;
    `);
    const activeDayIds = activeDays.stdout.trim().split(/\s+/).filter(Boolean).map(Number);
    assert.deepEqual(activeDayIds, [1, legsId]);
    const namedPayload = (name: string) => payload({
      program_id: 1,
      name,
      days: [
        {
          day_id: 1,
          name: 'Push day',
          subtitle: 'Upper',
          exercises: [
            {
              exercise_id: 1,
              target_sets: 4,
              min_reps: 6,
              max_reps: 10,
              notes: 'Pause',
              load_mode: 'added',
            },
          ],
        },
        { day_id: legsId, name: 'Legs', subtitle: null, exercises: [] },
      ],
    });

    const holder = spawn(psqlPath, [
      '-h', '127.0.0.1',
      '-p', String(port),
      '-U', 'postgres',
      '-d', database,
      '-X',
      '-v', 'ON_ERROR_STOP=1',
      '-A',
      '-t',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let holderOut = '';
    let holderErr = '';
    holder.stdout.on('data', (chunk) => {
      holderOut += chunk.toString();
    });
    holder.stderr.on('data', (chunk) => {
      holderErr += chunk.toString();
    });
    const waitFor = async (text: string) => {
      const deadline = Date.now() + 15000;
      while (!holderOut.includes(text)) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for ${text}. stdout=${holderOut} stderr=${holderErr}`);
        }
        await sleep(25);
      }
    };
    holder.stdin.write(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${userA}', true);
      SET LOCAL ROLE authenticated;
      SELECT public.update_owned_program(${namedPayload('Hold Name')});
      SELECT 'EDIT_LOCK_HELD';
    `);
    await waitFor('EDIT_LOCK_HELD');
    const duringHold = await psql(`SELECT name FROM public.programs WHERE id = 1;`);
    assert.equal(duringHold.stdout.trim(), 'Home edited');
    let secondDone = false;
    const second = psql(asUser(
      userA,
      `SELECT public.update_owned_program(${namedPayload('Final Name')});`,
    )).then((result) => {
      secondDone = true;
      return result;
    });
    await sleep(400);
    assert.equal(secondDone, false);
    const finishedDuring = await psql(finishedSetsSql);
    assert.equal(finishedDuring.stdout.trim(), finishedSnapshot);
    holder.stdin.write(`COMMIT;\nSELECT 'EDIT_LOCK_RELEASED';\n`);
    await waitFor('EDIT_LOCK_RELEASED');
    const secondResult = await second;
    assert.equal(secondResult.code, 0, secondResult.stderr);
    holder.stdin.end();
    const holderExit = await new Promise<number>((resolve, reject) => {
      holder.on('error', reject);
      holder.on('exit', (status) => resolve(status ?? 1));
    });
    assert.equal(holderExit, 0, holderErr);
    const finalName = await psql(`SELECT name || ':' || is_active::text FROM public.programs WHERE id = 1;`);
    assert.equal(finalName.stdout.trim(), 'Final Name:true');
    const dayCountFinal = await psql(`SELECT count(*) FROM public.program_days WHERE program_id = 1;`);
    assert.equal(dayCountFinal.stdout.trim(), '3');

    const definitions = await psql(`
      SELECT proname || ':' || prosecdef::text || ':' || coalesce(array_to_string(proconfig, ','), '')
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN (
          'record_tracked_set',
          'seed_standard_exercises',
          'create_custom_exercise',
          'resolve_routine_exercise',
          'routine_write_days',
          'update_owned_program',
          'save_manual_program'
        )
      ORDER BY 1;
    `);
    assert.equal(definitions.code, 0, definitions.stderr);
    for (const line of definitions.stdout.trim().split(/\r?\n/)) {
      assert.match(line, /:true:/);
      assert.match(line, /search_path=/);
    }
    const updateDef = await psql(`SELECT pg_get_functiondef('public.update_owned_program(jsonb)'::regprocedure);`);
    assert.equal(updateDef.code, 0, updateDef.stderr);
    assert.equal(/is_active|workout_sets/i.test(updateDef.stdout), false);
    assert.match(updateDef.stdout, /archived_day_locked/);
    const saveDef = await psql(`SELECT pg_get_functiondef('public.save_manual_program(jsonb)'::regprocedure);`);
    assert.match(saveDef.stdout, /is_active/);
    assert.match(saveDef.stdout, /false/);
    assert.equal(/workout_sessions|workout_sets/i.test(saveDef.stdout), false);
    const writeDef = await psql(`SELECT pg_get_functiondef('public.routine_write_days(uuid,bigint,jsonb,boolean)'::regprocedure);`);
    assert.match(writeDef.stdout, /workout_sessions/);
    assert.equal(/workout_sets|is_active/i.test(writeDef.stdout), false);
    const grants = await psql(writePrivilegeSql);
    assert.equal(grants.stdout.trim(), writePrivilegesEnabled);

    const bandId = band.stdout.trim();
    const routinesBeforeDelete = await psql(`
      SELECT count(*) FROM public.program_exercises WHERE exercise_id = ${bandId};
    `);
    assert.notEqual(routinesBeforeDelete.stdout.trim(), '0');
    const authenticatedDelete = await psql(asUser(
      userA,
      `DELETE FROM public.exercises WHERE id = ${bandId};`,
    ));
    assert.equal(authenticatedDelete.code, 0, authenticatedDelete.stderr);
    const customRemains = await psql(`SELECT count(*) FROM public.exercises WHERE id = ${bandId};`);
    assert.equal(customRemains.stdout.trim(), '1');
    const routinesAfterAuthenticatedDelete = await psql(`
      SELECT count(*) FROM public.program_exercises WHERE exercise_id = ${bandId};
    `);
    assert.equal(routinesAfterAuthenticatedDelete.stdout.trim(), routinesBeforeDelete.stdout.trim());
    const ownerDelete = await psql(`DELETE FROM public.exercises WHERE id = ${bandId};`);
    assert.notEqual(ownerDelete.code, 0);
    assert.match(ownerDelete.stderr, /program_exercises_exercise_id_fkey/);
    const customStillThere = await psql(`SELECT count(*) FROM public.exercises WHERE id = ${bandId};`);
    assert.equal(customStillThere.stdout.trim(), '1');

    const finishedBeforeRollback = await psql(finishedSetsSql);
    const sessionsBeforeRollback = await psql(sessionsSql);
    assert.equal(finishedBeforeRollback.stdout.trim(), finishedSnapshot);
    assert.equal(sessionsBeforeRollback.stdout.trim(), sessionSnapshot);

    const ownerBeforeRefusal = await psql(`
      SELECT owner_user_id::text FROM public.exercises WHERE id = ${bandId};
    `);
    assert.equal(ownerBeforeRefusal.stdout.trim(), userA);
    const ownershipRollback = await psql(ownershipRollbackText);
    assert.notEqual(ownershipRollback.code, 0);
    assert.match(ownershipRollback.stderr, /exercise_owner_rollback_blocked/);
    assert.match(ownershipRollback.stderr, /owner_user_id was not dropped/);
    const ownerAfterRefusal = await psql(`
      SELECT owner_user_id::text FROM public.exercises WHERE id = ${bandId};
    `);
    assert.equal(ownerAfterRefusal.stdout.trim(), userA);
    const visiblePolicy = await psql(`
      SELECT count(*)
      FROM pg_catalog.pg_policy
      WHERE polrelid = 'public.exercises'::regclass
        AND polname = 'exercises_select_visible';
    `);
    assert.equal(visiblePolicy.stdout.trim(), '1');
    const oldPolicyAbsent = await psql(`
      SELECT count(*)
      FROM pg_catalog.pg_policy
      WHERE polrelid = 'public.exercises'::regclass
        AND polname = 'exercises_select_authenticated';
    `);
    assert.equal(oldPolicyAbsent.stdout.trim(), '0');
    const fkStillNoAction = await psql(`
      SELECT confdeltype::text
      FROM pg_catalog.pg_constraint
      WHERE conname = 'program_exercises_exercise_id_fkey';
    `);
    assert.equal(fkStillNoAction.stdout.trim(), 'a');

    const archiveRollback = await psql(archiveRollbackText);
    assert.notEqual(archiveRollback.code, 0);
    assert.match(archiveRollback.stderr, /archive_order_rollback_blocked/);
    assert.match(archiveRollback.stderr, /archived_at was not dropped/);
    const archivedStill = await psql(`
      SELECT (archived_at IS NOT NULL)::text || ':' || (day_order >= 100000)::text || ':' || id::text
      FROM public.program_days
      WHERE id = 2;
    `);
    assert.equal(archivedStill.stdout.trim(), 'true:true:2');

    const routineRollback = await psql(await readFile(join(root, 'sql/routine-edit-rollback.sql'), 'utf8'));
    assert.equal(routineRollback.code, 0, routineRollback.stderr);
    const trackedBeforeRefusal = await psql(`
      SELECT load_mode || ':' || weight::text || ':' || coalesce(assistance::text, 'null') || ':' || weight_unit
      FROM public.workout_sets
      WHERE workout_session_id = 2 AND set_number = 1;
    `);
    assert.equal(trackedBeforeRefusal.stdout.trim(), 'added:15:null:kg');
    const prescriptionsBeforeRefusal = await psql(`
      SELECT count(*) FROM public.program_exercises WHERE load_mode IS NOT NULL;
    `);
    assert.notEqual(prescriptionsBeforeRefusal.stdout.trim(), '0');
    const loadRollback = await psql(loadRollbackText);
    assert.notEqual(loadRollback.code, 0);
    assert.match(loadRollback.stderr, /load_mode_rollback_blocked/);
    assert.match(loadRollback.stderr, /tracking columns were not dropped/);
    const trackedAfterRefusal = await psql(`
      SELECT load_mode || ':' || weight::text || ':' || coalesce(assistance::text, 'null') || ':' || weight_unit
      FROM public.workout_sets
      WHERE workout_session_id = 2 AND set_number = 1;
    `);
    assert.equal(trackedAfterRefusal.stdout.trim(), trackedBeforeRefusal.stdout.trim());
    const prescriptionsAfterRefusal = await psql(`
      SELECT count(*) FROM public.program_exercises WHERE load_mode IS NOT NULL;
    `);
    assert.equal(prescriptionsAfterRefusal.stdout.trim(), prescriptionsBeforeRefusal.stdout.trim());
    const trackedFunctionRemains = await psql(`
      SELECT count(*)
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'record_tracked_set';
    `);
    assert.equal(trackedFunctionRemains.stdout.trim(), '1');
    const trackedGrantRemains = await psql(`
      SELECT has_function_privilege(
        'authenticated',
        'public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)',
        'EXECUTE'
      )::text
        || ':' || has_function_privilege(
          'service_role',
          'public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)',
          'EXECUTE'
        )::text;
    `);
    assert.equal(trackedGrantRemains.stdout.trim(), 'true:false');

    const routineFunctionsGone = await psql(`
      SELECT count(*)
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN (
          'resolve_routine_exercise',
          'routine_write_days',
          'routine_normalize_days',
          'routine_require_int',
          'update_owned_program',
          'save_manual_program'
        );
    `);
    assert.equal(routineFunctionsGone.stdout.trim(), '0');
    const ownershipFunctionsRemain = await psql(`
      SELECT count(*)
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN (
          'seed_standard_exercises',
          'create_custom_exercise',
          'normalize_exercise_name'
        );
    `);
    assert.equal(ownershipFunctionsRemain.stdout.trim(), '3');
    const preservedColumns = await psql(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'program_days' AND column_name = 'archived_at')
          OR (table_name = 'exercises' AND column_name = 'owner_user_id')
        )
      ORDER BY column_name;
    `);
    assert.deepEqual(preservedColumns.stdout.trim().split(/\r?\n/), ['archived_at', 'owner_user_id']);
    const loadColumnsRemain = await psql(`
      SELECT count(*)
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'workout_sets' AND column_name IN ('load_mode', 'assistance', 'weight_unit'))
          OR (table_name = 'program_exercises' AND column_name = 'load_mode')
        );
    `);
    assert.equal(loadColumnsRemain.stdout.trim(), '4');
    const stillLinked = await psql(`SELECT program_day_id::text FROM public.workout_sessions WHERE id = 1;`);
    assert.equal(stillLinked.stdout.trim(), '2');
    const finishedAfterRefusal = await psql(finishedSetsSql);
    const sessionsAfterRefusal = await psql(sessionsSql);
    assert.equal(finishedAfterRefusal.stdout.trim(), finishedSnapshot);
    assert.equal(sessionsAfterRefusal.stdout.trim(), sessionSnapshot);
    assert.equal(await exerciseGrantList(), grantsBefore);
    const nameKeyRemains = await psql(`
      SELECT pg_catalog.pg_get_constraintdef(oid)
      FROM pg_catalog.pg_constraint
      WHERE conname = 'exercises_name_key';
    `);
    assert.equal(nameKeyRemains.stdout.trim(), 'UNIQUE (name)');
    const dayOrderRemains = await psql(`
      SELECT pg_catalog.pg_get_constraintdef(oid)
      FROM pg_catalog.pg_constraint
      WHERE conname = 'program_days_program_id_day_order_key';
    `);
    assert.equal(
      dayOrderRemains.stdout.trim(),
      'UNIQUE NULLS NOT DISTINCT (program_id, day_order)',
    );
    const routinesAfterRefusal = await psql(`
      SELECT count(*) FROM public.program_exercises WHERE exercise_id = ${bandId};
    `);
    assert.equal(routinesAfterRefusal.stdout.trim(), routinesBeforeDelete.stdout.trim());
    const benchRemains = await psql(`SELECT name FROM public.exercises WHERE id = 1;`);
    assert.equal(benchRemains.stdout.trim(), bench);

    const safeDatabase = 'routine_edit_safe';
    const createdSafe = await psql(`CREATE DATABASE ${safeDatabase};`, 'postgres');
    assert.equal(createdSafe.code, 0, createdSafe.stderr);
    const safe = (sql: string) => psql(sql, safeDatabase);
    const safeFixture = await safe(await readFile(join(root, 'scripts/fixtures/production-shape.sql'), 'utf8'));
    assert.equal(safeFixture.code, 0, safeFixture.stderr);
    const safeDayOrder = await safe(await readFile(join(root, 'sql/ai-import-day-order.sql'), 'utf8'));
    assert.equal(safeDayOrder.code, 0, safeDayOrder.stderr);
    const safeGrants = await safe(`
      SELECT coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '')
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'exercises'
        AND grantee = 'authenticated';
    `);
    assert.equal(safeGrants.code, 0, safeGrants.stderr);
    assertGrantList(safeGrants.stdout.trim());
    const safeRows = await safe(`
      INSERT INTO auth.users (id) VALUES ('${userA}');
      INSERT INTO public.exercises (name) VALUES ('${bench}');
      INSERT INTO public.programs (user_id, name, slug, is_active)
      VALUES ('${userA}', 'Home', NULL, true);
      INSERT INTO public.program_days (program_id, name, subtitle, day_order)
      VALUES (1, 'Push', NULL, 1);
      INSERT INTO public.program_exercises (
        program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps, notes
      )
      VALUES (1, 1, 1, 3, 8, 10, NULL);
      INSERT INTO public.workout_sessions (user_id, program_day_id, started_at, finished_at)
      VALUES ('${userA}', 1, timestamptz '2026-01-02T00:00:00Z', timestamptz '2026-01-02T01:00:00Z');
      INSERT INTO public.workout_sets (
        workout_session_id, exercise_id, set_number, weight, reps, rir, is_completed
      )
      VALUES (1, 1, 1, 135, 5, 2, true);
    `);
    assert.equal(safeRows.code, 0, safeRows.stderr);
    await expectBaselineReady(safe, 'safe baseline');
    const presentProbe = await safe(`
      CREATE FUNCTION public.record_tracked_set(integer)
      RETURNS void
      LANGUAGE sql
      AS 'SELECT NULL';
    `);
    assert.equal(presentProbe.code, 0, presentProbe.stderr);
    await expectBaselineRejects(safe, /routine_write_function_present/, 'existing signature');
    const dropPresent = await safe(`DROP FUNCTION public.record_tracked_set(integer);`);
    assert.equal(dropPresent.code, 0, dropPresent.stderr);
    const overloadProbe = await safe(`
      CREATE FUNCTION public.save_manual_program(jsonb)
      RETURNS void
      LANGUAGE sql
      AS 'SELECT NULL';
      CREATE FUNCTION public.save_manual_program(jsonb, boolean)
      RETURNS void
      LANGUAGE sql
      AS 'SELECT NULL';
    `);
    assert.equal(overloadProbe.code, 0, overloadProbe.stderr);
    await expectBaselineRejects(safe, /routine_write_overload/, 'unexpected overload');
    const dropOverloadProbe = await safe(`
      DROP FUNCTION public.save_manual_program(jsonb, boolean);
      DROP FUNCTION public.save_manual_program(jsonb);
    `);
    assert.equal(dropOverloadProbe.code, 0, dropOverloadProbe.stderr);
    const policyProbe = await safe(`
      CREATE POLICY exercises_select_visible ON public.exercises
        FOR SELECT TO authenticated
        USING (true);
    `);
    assert.equal(policyProbe.code, 0, policyProbe.stderr);
    await expectBaselineRejects(safe, /routine_write_baseline_differs/, 'extra exercise policy');
    const dropPolicyProbe = await safe(`DROP POLICY exercises_select_visible ON public.exercises;`);
    assert.equal(dropPolicyProbe.code, 0, dropPolicyProbe.stderr);
    const triggerProbe = await safe(`
      CREATE FUNCTION public.routine_write_baseline_probe()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $probe$ BEGIN RETURN NEW; END $probe$;
      CREATE TRIGGER routine_write_baseline_probe
        BEFORE UPDATE ON public.exercises
        FOR EACH ROW EXECUTE FUNCTION public.routine_write_baseline_probe();
    `);
    assert.equal(triggerProbe.code, 0, triggerProbe.stderr);
    await expectBaselineRejects(safe, /routine_write_baseline_differs/, 'exercise trigger');
    const dropTriggerProbe = await safe(`
      DROP TRIGGER routine_write_baseline_probe ON public.exercises;
      DROP FUNCTION public.routine_write_baseline_probe();
    `);
    assert.equal(dropTriggerProbe.code, 0, dropTriggerProbe.stderr);
    const grantProbe = await safe(`REVOKE SELECT ON TABLE public.exercises FROM authenticated;`);
    assert.equal(grantProbe.code, 0, grantProbe.stderr);
    await expectBaselineRejects(safe, /routine_write_baseline_differs/, 'missing exercise grant');
    const restoreGrant = await safe(`GRANT SELECT ON TABLE public.exercises TO authenticated;`);
    assert.equal(restoreGrant.code, 0, restoreGrant.stderr);
    await expectBaselineReady(safe, 'safe baseline restored');
    const safeDefaults = await safe(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    `);
    assert.equal(safeDefaults.code, 0, safeDefaults.stderr);
    const safeState = async () => {
      const result = await safe(schemaStateSql);
      assert.equal(result.code, 0, result.stderr);
      return result.stdout.trim();
    };
    let previousState = await safeState();
    assert.equal(previousState, '0:0:0:0:0:c:0:1:0');
    for (const path of sqlPaths) {
      const text = await readFile(join(root, path), 'utf8');
      const aborted = await safe(abortBeforeCommit(text));
      assert.notEqual(aborted.code, 0, path);
      assert.match(aborted.stderr, /atomic_file_failed/, `${path}\n${aborted.stderr}`);
      assert.equal(await safeState(), previousState, path);
      const safeWeightDuring = await safe(`
        SELECT weight::text || ':' || reps::text
        FROM public.workout_sets
        WHERE id = 1;
      `);
      assert.equal(safeWeightDuring.stdout.trim(), '135:5');
      const applied = await safe(text);
      assert.equal(applied.code, 0, `${path}\n${applied.stderr}`);
      previousState = schemaAfter[path];
      assert.equal(await safeState(), previousState, path);
      await expectStep(safe, path);
      if (path === 'sql/load-mode.sql') {
        await expectBaselineRejects(safe, /routine_write_function_present/, 'safe baseline after load-mode');
      }
      if (path === 'sql/load-mode.sql') {
        const opened = await safe(`
          GRANT EXECUTE ON FUNCTION public.record_tracked_set(
            bigint, bigint, integer, text, numeric, numeric, text, integer, integer, boolean
          ) TO authenticated;
        `);
        assert.equal(opened.code, 0, opened.stderr);
        const stepOpen = await safe(stepPrecheckText);
        assert.notEqual(stepOpen.code, 0);
        assert.match(stepOpen.stderr, /routine_write_permission_open/);
        assert.equal(stepOpen.stdout.includes('routine_write_step_closed'), false);
        const closedGrant = await safe(`
          REVOKE ALL ON FUNCTION public.record_tracked_set(
            bigint, bigint, integer, text, numeric, numeric, text, integer, integer, boolean
          ) FROM authenticated;
        `);
        assert.equal(closedGrant.code, 0, closedGrant.stderr);
        await expectStep(safe, path);
      }
      if (path === 'sql/routine-edit.sql') {
        const full = await safe(precheckText);
        assert.equal(full.code, 0, full.stderr);
        assert.match(full.stdout, /routine_write_permissions_closed/);
      } else {
        await expectFullPrecheckIncomplete(safe, path);
      }
    }
    const safeEmpty = await safe(`
      SELECT
        (SELECT count(*) FROM public.exercises WHERE owner_user_id IS NOT NULL)::text || ':' ||
        (SELECT count(*) FROM public.program_days WHERE archived_at IS NOT NULL OR day_order >= 100000)::text || ':' ||
        (SELECT count(*) FROM public.workout_sets
          WHERE load_mode IS NOT NULL OR assistance IS NOT NULL OR weight_unit IS NOT NULL)::text || ':' ||
        (SELECT count(*) FROM public.program_exercises WHERE load_mode IS NOT NULL)::text;
    `);
    assert.equal(safeEmpty.stdout.trim(), '0:0:0:0');
    const safeClosed = await safe(precheckText);
    assert.equal(safeClosed.code, 0, safeClosed.stderr);
    assert.match(safeClosed.stdout, /routine_write_permissions_closed/);
    const droppedSave = await safe(`DROP FUNCTION public.save_manual_program(jsonb);`);
    assert.equal(droppedSave.code, 0, droppedSave.stderr);
    await expectFullPrecheckIncomplete(safe, 'missing save_manual_program');
    const stepAfterDrop = await safe(stepPrecheckText);
    assert.equal(stepAfterDrop.code, 0, stepAfterDrop.stderr);
    assert.equal(
      stepAfterDrop.stdout.trim(),
      'routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=closed:update_owned_program=closed:save_manual_program=absent',
    );
    const restoredEdit = await safe(await readFile(join(root, 'sql/routine-edit.sql'), 'utf8'));
    assert.equal(restoredEdit.code, 0, restoredEdit.stderr);
    await expectStep(safe, 'sql/routine-edit.sql');
    const overload = await safe(`
      CREATE FUNCTION public.save_manual_program(jsonb, boolean)
      RETURNS void
      LANGUAGE sql
      AS 'SELECT NULL';
    `);
    assert.equal(overload.code, 0, overload.stderr);
    for (const sql of [precheckText, stepPrecheckText]) {
      const rejected = await safe(sql);
      assert.notEqual(rejected.code, 0);
      assert.match(rejected.stderr, /routine_write_overload/);
      assert.equal(rejected.stdout.includes('routine_write_permissions_closed'), false);
      assert.equal(rejected.stdout.includes('routine_write_step_closed'), false);
    }
    const dropOverload = await safe(`DROP FUNCTION public.save_manual_program(jsonb, boolean);`);
    assert.equal(dropOverload.code, 0, dropOverload.stderr);
    const unexpectedGrants = [
      [
        `GRANT EXECUTE ON FUNCTION public.create_custom_exercise(text) TO anon;`,
        `REVOKE ALL ON FUNCTION public.create_custom_exercise(text) FROM anon;`,
      ],
      [
        `GRANT EXECUTE ON FUNCTION public.save_manual_program(jsonb) TO authenticated;`,
        `REVOKE ALL ON FUNCTION public.save_manual_program(jsonb) FROM authenticated;`,
      ],
      [
        `GRANT EXECUTE ON FUNCTION public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean) TO service_role;`,
        `REVOKE ALL ON FUNCTION public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean) FROM service_role;`,
      ],
      [
        `GRANT EXECUTE ON FUNCTION public.update_owned_program(jsonb) TO PUBLIC;`,
        `REVOKE ALL ON FUNCTION public.update_owned_program(jsonb) FROM PUBLIC;`,
      ],
    ];
    for (const [grant, revoke] of unexpectedGrants) {
      const granted = await safe(grant);
      assert.equal(granted.code, 0, `${grant}\n${granted.stderr}`);
      for (const sql of [precheckText, stepPrecheckText]) {
        const rejected = await safe(sql);
        assert.notEqual(rejected.code, 0, grant);
        assert.match(rejected.stderr, /routine_write_permission_open/, `${grant}\n${rejected.stderr}`);
        assert.equal(rejected.stdout.includes('routine_write_permissions_closed'), false);
        assert.equal(rejected.stdout.includes('routine_write_step_closed'), false);
      }
      const revoked = await safe(revoke);
      assert.equal(revoked.code, 0, `${revoke}\n${revoked.stderr}`);
    }
    const restoredPrecheck = await safe(precheckText);
    assert.equal(restoredPrecheck.code, 0, restoredPrecheck.stderr);
    assert.match(restoredPrecheck.stdout, /routine_write_permissions_closed/);
    await expectStep(safe, 'sql/routine-edit.sql');
    const safeBlockedCall = `SELECT public.record_tracked_set(1, 1, 1, 'added', 10, NULL, 'lb', 5, 2, true);`;
    await assertPermissionDenied(safe, asUser(userA, safeBlockedCall), 'safe authenticated record_tracked_set');
    await assertPermissionDenied(safe, asRole('anon', safeBlockedCall), 'safe anon record_tracked_set');
    await assertPermissionDenied(safe, asRole('service_role', safeBlockedCall), 'safe service_role record_tracked_set');
    const safeWeight = await safe(`
      SELECT weight::text || ':' || reps::text
      FROM public.workout_sets
      WHERE id = 1;
    `);
    assert.equal(safeWeight.stdout.trim(), '135:5');
    const safeEnabled = await safe(enablementText);
    assert.equal(safeEnabled.code, 0, safeEnabled.stderr);
    assert.match(safeEnabled.stdout, /routine_write_permissions_enabled/);
    const safeOpen = await safe(precheckText);
    assert.notEqual(safeOpen.code, 0);
    assert.match(safeOpen.stderr, /routine_write_permission_open/);
    const safeRevoked = await safe(enablementRollbackText);
    assert.equal(safeRevoked.code, 0, safeRevoked.stderr);
    assert.match(safeRevoked.stdout, /routine_write_permissions_closed/);
    const safeClosedAgain = await safe(precheckText);
    assert.equal(safeClosedAgain.code, 0, safeClosedAgain.stderr);
    assert.match(safeClosedAgain.stdout, /routine_write_permissions_closed/);
    const safeFunctionBeforeRollback = await safe(`
      SELECT count(*)
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'record_tracked_set';
    `);
    assert.equal(safeFunctionBeforeRollback.stdout.trim(), '1');
    for (const path of rollbackPaths) {
      const applied = await safe(await readFile(join(root, path), 'utf8'));
      assert.equal(applied.code, 0, `${path}\n${applied.stderr}`);
    }
    const safeColumns = await safe(`
      SELECT count(*)
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          (table_name = 'workout_sets' AND column_name IN ('load_mode', 'assistance', 'weight_unit'))
          OR (table_name = 'program_exercises' AND column_name = 'load_mode')
          OR (table_name = 'program_days' AND column_name = 'archived_at')
          OR (table_name = 'exercises' AND column_name = 'owner_user_id')
        );
    `);
    assert.equal(safeColumns.stdout.trim(), '0');
    const safeTrackedFunction = await safe(`
      SELECT count(*)
      FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = 'record_tracked_set';
    `);
    assert.equal(safeTrackedFunction.stdout.trim(), '0');
    const safePolicy = await safe(`
      SELECT pol.polname || ':' || pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
      FROM pg_catalog.pg_policy pol
      WHERE pol.polrelid = 'public.exercises'::regclass
        AND pol.polname = 'exercises_select_authenticated';
    `);
    assert.equal(safePolicy.stdout.trim(), 'exercises_select_authenticated:true');
    const safeGrantsAfter = await safe(`
      SELECT coalesce(string_agg(privilege_type, ',' ORDER BY privilege_type), '')
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = 'exercises'
        AND grantee = 'authenticated';
    `);
    assert.equal(safeGrantsAfter.stdout.trim(), safeGrants.stdout.trim());
    const safeFk = await safe(`
      SELECT confdeltype::text
      FROM pg_catalog.pg_constraint
      WHERE conname = 'program_exercises_exercise_id_fkey';
    `);
    assert.equal(safeFk.stdout.trim(), 'c');
    const safeNameKey = await safe(`
      SELECT pg_catalog.pg_get_constraintdef(oid)
      FROM pg_catalog.pg_constraint
      WHERE conname = 'exercises_name_key';
    `);
    assert.equal(safeNameKey.stdout.trim(), 'UNIQUE (name)');
    const safeHistory = await safe(`
      SELECT weight::text || ':' || reps::text
      FROM public.workout_sets
      WHERE id = 1;
    `);
    assert.equal(safeHistory.stdout.trim(), '135:5');
    const safeProbe = await safe(`
      INSERT INTO public.exercises (name) VALUES ('Cascade Probe') RETURNING id;
    `);
    assert.equal(safeProbe.code, 0, safeProbe.stderr);
    const probeId = safeProbe.stdout.trim();
    const safeLink = await safe(`
      INSERT INTO public.program_exercises (
        program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps
      )
      VALUES (1, ${probeId}, 2, 3, 8, 10);
    `);
    assert.equal(safeLink.code, 0, safeLink.stderr);
    const safeCascade = await safe(`
      BEGIN;
      DELETE FROM public.exercises WHERE id = ${probeId};
      SELECT count(*)::text FROM public.program_exercises WHERE exercise_id = ${probeId};
      ROLLBACK;
    `);
    assert.equal(safeCascade.code, 0, safeCascade.stderr);
    assert.equal(safeCascade.stdout.trim(), '0');
    const safeRestored = await safe(`
      SELECT
        (SELECT count(*) FROM public.exercises WHERE id = ${probeId})::text || ':' ||
        (SELECT count(*) FROM public.program_exercises WHERE exercise_id = ${probeId})::text;
    `);
    assert.equal(safeRestored.stdout.trim(), '1:1');

    console.log('routine edit checks passed');
    console.log(`finished sets preserved: ${finishedSnapshot}`);
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
