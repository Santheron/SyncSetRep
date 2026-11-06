import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { equipmentTargetRowsFromReview } from '../lib/import/equipment-target-save.ts';
import { OWNED_SAVE_MAX_DAYS } from '../lib/import/limits.ts';
import {
  ownedProgramUpdatePayload,
  saveManualProgram,
  validateManualRoutine,
} from '../lib/import/manual-program.ts';
import {
  materializeCustomExercises,
  prepareRoutineForSave,
  runGuardedProgramSave,
} from '../lib/import/one-tap-import.ts';
import {
  createMemoryRoutineDraftStore,
  createRoutineSaveGate,
  decodeRoutineDraft,
  routineDraftKey,
} from '../lib/import/routine-draft.ts';
import { parseStructuredRoutine, UNASSIGNED_SECTION_SUBTITLE } from '../lib/import/structured-routine.ts';
import { programDayIndexLabel, scheduledProgramDayCount } from '../lib/program-day-schedule.ts';
import {
  acceptedProgramExerciseTargets,
  missingTargetFields,
} from '../lib/workout-today.ts';

const host = '127.0.0.1';
const port = 55462;
const database = 'syncsetrep_friend_unspecified';
if (host !== '127.0.0.1' || port === 5432 || port === 6543 || (port >= 55450 && port <= 55461)) {
  throw new Error('refusing non-disposable database');
}

const root = fileURLToPath(new URL('..', import.meta.url));
const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const requestSeven = 'dddddddd-dddd-4ddd-8ddd-dddddddddd21';
const requestFriend = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';
const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');
const source = await readFile(new URL('./fixtures/workout-import/friend-push-pull.txt', import.meta.url), 'utf8');

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

function sqlText(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-friend-pg-'));
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
    'sql/program-equipment-targets.sql',
    'sql/routine-write-enablement.sql',
    'sql/workout-history-lock.sql',
    'sql/program-unspecified-targets.sql',
  ]) {
    const applied = await psql(await readFile(join(root, name), 'utf8'));
    assert.equal(applied.code, 0, `${name}\n${applied.stderr}`);
  }

  await must(`
    INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}');
    INSERT INTO public.exercises (name) VALUES
      ('Bench Press'),
      ('Romanian Deadlift'),
      ('Pull Up'),
      ('Lat Pulldown'),
      ('Calf Raise'),
      ('Hammer Curl');
  `, 'seed users and catalog');

  const catalogRows = await must(`
    SELECT name || ':' || id::text
    FROM public.exercises
    ORDER BY id;
  `, 'catalog ids');
  const catalog = catalogRows.split('\n').filter(Boolean).map((line) => {
    const splitAt = line.lastIndexOf(':');
    return { id: Number(line.slice(splitAt + 1)), name: line.slice(0, splitAt) };
  });
  const benchId = catalog.find((exercise) => exercise.name === 'Bench Press')?.id;
  assert.ok(benchId);

  async function historyText() {
    return must(`
      SELECT weight::text || ':' || reps::text || ':' || is_completed::text || ':' || finished_at::text
      FROM public.workout_sets s
      JOIN public.workout_sessions w ON w.id = s.workout_session_id
      WHERE w.finished_at = '2026-11-01 13:00:00+00';
    `, 'history');
  }

  const sevenPlan = {
    name: 'Numeric split',
    client_request_id: requestSeven,
    days: ['Push', 'Pull', 'Legs', 'Rest', 'Upper body', 'Arms', 'Rest'].map((name) => ({
      name,
      subtitle: null,
      exercises: name === 'Rest'
        ? []
        : [{ exercise_id: benchId, target_sets: 3, min_reps: 8, max_reps: 12, notes: 'legacy' }],
    })),
  };
  const sevenId = await must(
    asUser(userA, `SELECT public.save_owned_program(${payload(sevenPlan)}, true);`),
    'save seven-day numeric routine',
  );
  assert.equal(await must(`
    SELECT count(*)::text || ':' || count(*) FILTER (WHERE subtitle IS NOT DISTINCT FROM '${UNASSIGNED_SECTION_SUBTITLE}')::text
    FROM public.program_days
    WHERE program_id = ${sevenId};
  `, 'seven scheduled days'), '7:0');
  assert.equal(await must(`
    SELECT string_agg(day_order::text, ',' ORDER BY day_order)
    FROM public.program_days
    WHERE program_id = ${sevenId};
  `, 'seven day orders'), '1,2,3,4,5,6,7');
  const sevenDayId = await must(`
    SELECT id::text FROM public.program_days WHERE program_id = ${sevenId} AND day_order = 1;
  `, 'seven push day');
  await must(`
    INSERT INTO public.workout_sessions (user_id, program_day_id, started_at, finished_at)
    VALUES ('${userA}', ${sevenDayId}, '2026-11-01 12:00:00+00', '2026-11-01 13:00:00+00');
    INSERT INTO public.workout_sets (workout_session_id, exercise_id, set_number, weight, reps, is_completed)
    SELECT id, ${benchId}, 1, 135.5, 5, true
    FROM public.workout_sessions
    WHERE finished_at = '2026-11-01 13:00:00+00';
  `, 'seed finished workout');
  const historyBefore = await historyText();
  assert.equal(historyBefore, '135.5:5:true:2026-11-01 13:00:00+00');
  const sevenTargets = await must(`
    SELECT string_agg(target_sets::text || ':' || min_reps::text || ':' || max_reps::text || ':' || notes, ',' ORDER BY e.id)
    FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${sevenId};
  `, 'seven targets');

  const parsed = parseStructuredRoutine(source);
  assert.ok(parsed);
  assert.equal(parsed.days.length, 8);
  assert.deepEqual(parsed.days.map((day) => day.exercises.length), [8, 9, 6, 0, 0, 0, 0, 5]);
  const labels = parsed.days.map((day, index) => programDayIndexLabel({ subtitle: day.subtitle, dayOrder: index + 1 }));
  assert.deepEqual(labels, ['1', '2', '3', '4', '5', '6', '7', null]);
  assert.equal(labels.includes('8'), false);
  assert.equal(scheduledProgramDayCount(parsed.days.map((day) => ({ subtitle: day.subtitle }))), 7);
  assert.equal(parsed.days[7]?.subtitle, UNASSIGNED_SECTION_SUBTITLE);
  const prepared = prepareRoutineForSave(parsed, catalog, 'import');
  const materialized = await materializeCustomExercises(prepared.review, {
    enabled: true,
    create: async (name) => {
      const created = await must(
        asUser(userA, `SELECT public.create_custom_exercise(${sqlText(name)});`),
        `custom ${name}`,
      );
      return { ok: true, exerciseId: created };
    },
  });
  assert.equal(materialized.ok, true);
  if (!materialized.ok) {
    throw new Error(materialized.error);
  }
  assert.equal(validateManualRoutine(materialized.review).ok, false);
  assert.equal(ownedProgramUpdatePayload(materialized.review, sevenId).ok, false);
  assert.equal(validateManualRoutine(materialized.review, {
    allowUnspecifiedPrescription: true,
    maxDays: OWNED_SAVE_MAX_DAYS,
    subtitleRequired: false,
  }).ok, true);

  let savedPayload: { name?: string; days?: { name: string; subtitle: string | null; exercises: Record<string, unknown>[] }[] } | null = null;
  const captured = await saveManualProgram(materialized.review, {
    userId: userA,
    programs: [{ id: sevenId, name: 'Numeric split', isActive: true }],
    subtitleRequired: false,
    persistPlannedWeight: true,
    allowUnspecifiedPrescription: true,
    maxDays: OWNED_SAVE_MAX_DAYS,
    clientRequestId: requestFriend,
    ownedRpc: async (args) => {
      savedPayload = args.p_program as typeof savedPayload;
      return { data: 1, error: null };
    },
  });
  assert.equal(captured.ok, true);
  assert.ok(savedPayload);
  const programJson = savedPayload as NonNullable<typeof savedPayload>;
  assert.equal(programJson.days?.length, 8);
  const friendId = await must(
    asUser(userA, `SELECT public.save_owned_program(${payload(programJson)}, false);`),
    'save friend routine inactive',
  );
  assert.notEqual(friendId, sevenId);
  assert.equal(await must(`
    SELECT count(*)::text FROM public.programs WHERE user_id = '${userA}';
  `, 'two programs'), '2');
  assert.equal(await must(`
    SELECT is_active::text FROM public.programs WHERE id = ${friendId};
  `, 'friend stays inactive'), 'false');
  assert.equal(await must(`
    SELECT is_active::text FROM public.programs WHERE id = ${sevenId};
  `, 'numeric routine stays current'), 'true');

  function storedLine(dayOrder: number, day: { name: string; subtitle: string | null }, exerciseOrder: number, exercise: Record<string, unknown>) {
    const weight = exercise.planned_weight == null ? 'null' : String(Number(exercise.planned_weight));
    return [
      String(dayOrder),
      day.name,
      day.subtitle ?? '',
      String(exerciseOrder),
      exercise.target_sets == null ? 'null' : String(exercise.target_sets),
      exercise.min_reps == null ? 'null' : String(exercise.min_reps),
      exercise.max_reps == null ? 'null' : String(exercise.max_reps),
      exercise.notes == null ? '' : String(exercise.notes),
      weight,
      exercise.planned_weight_unit == null ? '' : String(exercise.planned_weight_unit),
    ].join(String.fromCharCode(31));
  }
  const expectedRows = (programJson.days ?? []).flatMap((day, dayIndex) =>
    day.exercises.map((exercise, exerciseIndex) => storedLine(dayIndex + 1, day, exerciseIndex + 1, exercise)),
  ).join('\n');
  const reopened = await must(`
    SELECT string_agg(
      d.day_order::text || chr(31) || d.name || chr(31) || coalesce(d.subtitle, '') || chr(31)
      || e.exercise_order::text || chr(31) || coalesce(e.target_sets::text, 'null') || chr(31)
      || coalesce(e.min_reps::text, 'null') || chr(31) || coalesce(e.max_reps::text, 'null') || chr(31)
      || coalesce(e.notes, '') || chr(31) || coalesce(e.planned_weight::float8::text, 'null') || chr(31)
      || coalesce(e.planned_weight_unit, ''),
      chr(10) ORDER BY d.day_order, e.exercise_order
    )
    FROM public.program_days d
    JOIN public.program_exercises e ON e.program_day_id = d.id
    WHERE d.program_id = ${friendId};
  `, 'reopen friend routine');
  assert.equal(reopened, expectedRows);
  const targetCounts = await must(`
    SELECT count(*) FILTER (WHERE e.target_sets IS NULL)::text || ':' || count(*) FILTER (WHERE e.target_sets IS NOT NULL)::text
    FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${friendId};
  `, 'null and numeric targets');
  assert.equal(targetCounts, '11:17');
  assert.equal(await must(`
    SELECT day_order::text || ':' || coalesce(subtitle, '')
    FROM public.program_days
    WHERE program_id = ${friendId} AND name = 'Abs';
  `, 'abs slot'), `8:${UNASSIGNED_SECTION_SUBTITLE}`);
  assert.equal(await must(`
    SELECT count(*)::text FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${friendId};
  `, 'exercise count'), '28');

  const retryId = await must(
    asUser(userA, `SELECT public.save_owned_program(${payload(programJson)}, true);`),
    'retry activates the same program',
  );
  assert.equal(retryId, friendId);
  assert.equal(await must(`SELECT count(*)::text FROM public.programs WHERE user_id = '${userA}';`, 'no duplicate'), '2');
  assert.equal(await must(`
    SELECT (SELECT is_active::text FROM public.programs WHERE id = ${friendId})
      || ':' || (SELECT is_active::text FROM public.programs WHERE id = ${sevenId})
      || ':' || (SELECT count(*)::text FROM public.programs WHERE user_id = '${userA}' AND is_active);
  `, 'retry switches current program'), 'true:false:1');
  assert.equal(await must(`
    SELECT string_agg(target_sets::text || ':' || min_reps::text || ':' || max_reps::text || ':' || notes, ',' ORDER BY e.id)
    FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${sevenId};
  `, 'numeric routine unchanged'), sevenTargets);

  const rowsBeforeEquipment = await must(`
    SELECT count(*)::text FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${friendId};
  `, 'rows before equipment');
  const equipmentRows = equipmentTargetRowsFromReview(materialized.review);
  assert.ok(equipmentRows.length > 0);
  await expectError(
    asUser(userA, `SELECT public.save_equipment_targets(${payload({
      program_id: Number(friendId),
      rows: [{ day_order: 99, exercise_order: 1, targets: [{ equipment: 'machine', weight: 10, unit: 'lb' }] }],
    })});`),
    /equipment_target_not_owned/,
    'failed equipment write',
  );
  assert.equal(await must(`SELECT id::text FROM public.programs WHERE client_request_id = '${requestFriend}';`, 'program id kept'), friendId);
  assert.equal(await must(`
    SELECT count(*)::text FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${friendId} AND e.equipment_targets IS NOT NULL;
  `, 'failed write stores nothing'), '0');
  assert.equal(reopened, await must(`
    SELECT string_agg(
      d.day_order::text || chr(31) || d.name || chr(31) || coalesce(d.subtitle, '') || chr(31)
      || e.exercise_order::text || chr(31) || coalesce(e.target_sets::text, 'null') || chr(31)
      || coalesce(e.min_reps::text, 'null') || chr(31) || coalesce(e.max_reps::text, 'null') || chr(31)
      || coalesce(e.notes, '') || chr(31) || coalesce(e.planned_weight::float8::text, 'null') || chr(31)
      || coalesce(e.planned_weight_unit, ''),
      chr(10) ORDER BY d.day_order, e.exercise_order
    )
    FROM public.program_days d
    JOIN public.program_exercises e ON e.program_day_id = d.id
    WHERE d.program_id = ${friendId};
  `, 'targets unchanged after failed equipment write'));
  const equipmentSaved = await must(
    asUser(userA, `SELECT public.save_equipment_targets(${payload({
      program_id: Number(friendId),
      rows: equipmentRows,
    })})::text;`),
    'save equipment targets',
  );
  assert.match(equipmentSaved, /"ok": true/);
  assert.equal(await must(`
    SELECT count(*)::text FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${friendId} AND e.equipment_targets IS NOT NULL;
  `, 'equipment rows stored'), String(equipmentRows.length));

  const store = createMemoryRoutineDraftStore();
  let frozenCount = 0;
  const partial = await runGuardedProgramSave({
    mode: 'import',
    review: parsed,
    catalog,
    gate: createRoutineSaveGate(),
    store,
    userId: userA,
    scope: 'import',
    programId: null,
    programsLoaded: true,
    hasCurrentProgram: true,
    storedRaw: null,
    ownedProgramRpcEnabled: true,
    customWritesEnabled: true,
    persistTargets: true,
    sourceText: source,
    createCustom: async () => ({ ok: true, exerciseId: '901' }),
    saveProgram: async () => ({ ok: true, programId: friendId }),
    locateSavedRows: async () => null,
    saveTargets: async (_programId, _review, savedRows) => {
      frozenCount = savedRows?.length ?? 0;
      return { ok: false, error: 'target write failed' };
    },
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.programId, friendId);
  assert.equal(partial.editingLocked, true);
  assert.ok(frozenCount > 0);
  const draftKey = routineDraftKey(userA, 'import', null);
  assert.ok(draftKey);
  const draft = decodeRoutineDraft(store.read(draftKey) ?? '');
  assert.equal(draft?.pendingTargetProgramId, friendId);
  assert.equal(draft?.pendingEquipmentTargets?.length, frozenCount);
  assert.equal(await must(`SELECT count(*)::text FROM public.programs WHERE user_id = '${userA}';`, 'partial client save adds nothing'), '2');

  const pushSets = await must(`
    SELECT coalesce(sum(e.target_sets), 0)::text
    FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${friendId} AND d.name = 'Push';
  `, 'push prescribed sets');
  const pushDayId = await must(`
    SELECT id::text FROM public.program_days WHERE program_id = ${friendId} AND name = 'Push';
  `, 'push day');
  const pushSession = await must(asUser(userA, `
    INSERT INTO public.workout_sessions (user_id, program_day_id, started_at)
    VALUES ('${userA}', ${pushDayId}, '2026-11-06 12:00:00+00')
    RETURNING id::text;
  `), 'start push');
  await must(asUser(userA, `
    INSERT INTO public.workout_sets (workout_session_id, exercise_id, set_number, reps, is_completed)
    SELECT ${pushSession}, e.exercise_id, gs.set_number, NULL, false
    FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    JOIN generate_series(1, e.target_sets) AS gs(set_number) ON true
    WHERE d.id = ${pushDayId} AND e.target_sets IS NOT NULL;
  `), 'insert push sets');
  assert.equal(await must(`
    SELECT count(*)::text FROM public.workout_sets WHERE workout_session_id = ${pushSession};
  `, 'push set count'), pushSets);

  const absDayId = await must(`
    SELECT id::text FROM public.program_days WHERE program_id = ${friendId} AND name = 'Abs';
  `, 'abs day');
  const absExercise = await must(`
    SELECT e.id::text || ':' || e.exercise_id::text
    FROM public.program_exercises e
    WHERE e.program_day_id = ${absDayId}
    ORDER BY e.exercise_order
    LIMIT 1;
  `, 'first abs exercise');
  const [absProgramExerciseId, absExerciseId] = absExercise.split(':');
  const absSession = await must(asUser(userA, `
    INSERT INTO public.workout_sessions (user_id, program_day_id, started_at)
    VALUES ('${userA}', ${absDayId}, '2026-11-06 13:00:00+00')
    RETURNING id::text;
  `), 'start abs');
  assert.equal(await must(`
    SELECT count(*)::text FROM public.workout_sets WHERE workout_session_id = ${absSession};
  `, 'abs starts without invented sets'), '0');
  const missing = missingTargetFields({
    todaySets: null,
    todayReps: null,
    prescribedSets: null,
    prescribedRepsMin: 5,
    prescribedRepsMax: 5,
    recordedMax: 0,
  });
  assert.equal(missing.sets, true);
  assert.equal(missing.reps, false);
  await must(asUser(userA, `
    INSERT INTO public.workout_sets (workout_session_id, exercise_id, set_number, reps, is_completed)
    SELECT ${absSession}, ${absExerciseId}, set_number, NULL, false
    FROM generate_series(1, 3) AS set_number;
  `), 'add abs sets during the workout');
  const beforeRoutineSave = await must(`
    SELECT coalesce(target_sets::text, 'null') || ':' || coalesce(min_reps::text, 'null') || ':' || coalesce(max_reps::text, 'null')
    FROM public.program_exercises WHERE id = ${absProgramExerciseId};
  `, 'routine before explicit save');
  await must(asUser(userA, `
    UPDATE public.workout_sets
    SET reps = 5, is_completed = true
    WHERE workout_session_id = ${absSession} AND set_number = 1
    RETURNING id::text;
  `), 'complete one abs set');
  const accepted = acceptedProgramExerciseTargets(absProgramExerciseId, { sets: 3, repsMin: 5, repsMax: 5 });
  assert.equal(accepted.ok, true);
  if (!accepted.ok) {
    throw new Error(accepted.error);
  }
  await must(asUser(userA, `
      UPDATE public.program_exercises
      SET target_sets = ${accepted.sets}, min_reps = ${accepted.repsMin}, max_reps = ${accepted.repsMax}
      WHERE id = ${accepted.id}
      RETURNING id::text;
    `), 'save targets to the routine');
  assert.notEqual(await must(`
    SELECT coalesce(target_sets::text, 'null') || ':' || coalesce(min_reps::text, 'null') || ':' || coalesce(max_reps::text, 'null')
    FROM public.program_exercises WHERE id = ${absProgramExerciseId};
  `, 'routine saved'), beforeRoutineSave);
  assert.equal(await must(`
    SELECT reps::text || ':' || is_completed::text
    FROM public.workout_sets
    WHERE workout_session_id = ${absSession} AND set_number = 1;
  `, 'completed set unchanged by routine save'), '5:true');
  assert.equal(await must(`
    SELECT count(*)::text
    FROM public.program_exercises
    WHERE program_day_id = ${absDayId} AND id <> ${absProgramExerciseId} AND target_sets IS NULL;
  `, 'other abs exercises stay unset'), '4');
  await must(asUser(userA, `
    UPDATE public.workout_sessions
    SET finished_at = '2026-11-06 14:00:00+00'
    WHERE id = ${absSession} AND finished_at IS NULL
    RETURNING id::text;
  `), 'finish abs');
  const finishedRewrite = await must(asUser(userA, `
    UPDATE public.workout_sets
    SET reps = 99
    WHERE workout_session_id = ${absSession} AND set_number = 1
    RETURNING id::text;
  `), 'finished set rewrite');
  assert.equal(finishedRewrite, '');
  assert.equal(await must(`
    SELECT reps::text FROM public.workout_sets WHERE workout_session_id = ${absSession} AND set_number = 1;
  `, 'finished reps stay'), '5');

  const programsBeforeCross = await must(`SELECT count(*)::text FROM public.programs;`, 'programs before cross-user');
  const privateId = await must(
    asUser(userB, `SELECT public.create_custom_exercise('Secret Move');`),
    'user B private exercise',
  );
  await expectError(
    asUser(userA, `SELECT public.save_owned_program(${payload({
      name: 'Cross user',
      client_request_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddd22',
      days: [{ name: 'Pull', subtitle: null, exercises: [{ exercise_id: Number(privateId), target_sets: 3, min_reps: 8, max_reps: 8, notes: null }] }],
    })}, false);`),
    /invalid_import: exercise_owner/,
    'cross-user exercise rejected',
  );
  assert.equal(await must(`SELECT count(*)::text FROM public.programs;`, 'no partial program'), programsBeforeCross);
  assert.equal(await must(`SELECT count(*)::text FROM public.program_days WHERE program_id NOT IN (${sevenId}, ${friendId});`, 'no extra days'), '0');

  const daysBeforeEdit = await must(`SELECT count(*)::text FROM public.program_days WHERE program_id = ${friendId};`, 'days before rejected edit');
  await expectError(
    asUser(userA, `SELECT public.update_owned_program(${payload({
      program_id: Number(friendId),
      name: 'Imported routine',
      days: programJson.days,
    })});`),
    /invalid_import:/,
    'editor rejects eight-day null-target routine',
  );
  assert.equal(await must(`SELECT count(*)::text FROM public.program_days WHERE program_id = ${friendId};`, 'rejected edit keeps days'), daysBeforeEdit);
  assert.equal(await rowsBeforeEquipment, '28');

  const switched = await must(
    asUser(userA, `SELECT public.activate_owned_program(${sevenId});`),
    'switch back to numeric routine',
  );
  assert.equal(switched, sevenId);
  assert.equal(await must(`
    SELECT (SELECT is_active::text FROM public.programs WHERE id = ${sevenId})
      || ':' || (SELECT is_active::text FROM public.programs WHERE id = ${friendId})
      || ':' || (SELECT count(*)::text FROM public.programs WHERE user_id = '${userA}' AND is_active);
  `, 'numeric routine is current again'), 'true:false:1');
  assert.equal(await must(`
    SELECT string_agg(target_sets::text || ':' || min_reps::text || ':' || max_reps::text || ':' || notes, ',' ORDER BY e.id)
    FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${sevenId};
  `, 'numeric targets survive switching'), sevenTargets);
  assert.equal(await historyText(), historyBefore);

  const rollbackSql = await readFile(join(root, 'sql/program-unspecified-targets-rollback.sql'), 'utf8');
  await expectError(rollbackSql, /unspecified_targets_rollback_blocked/, 'rollback guard');
  const remainingNulls = Number(await must(`
    SELECT count(*)::text FROM public.program_exercises e
    JOIN public.program_days d ON d.id = e.program_day_id
    WHERE d.program_id = ${friendId} AND (e.target_sets IS NULL OR e.min_reps IS NULL OR e.max_reps IS NULL);
  `, 'null targets remain after blocked rollback'));
  assert.ok(remainingNulls > 0);
  assert.equal(await historyText(), historyBefore);
  console.log(`friend unspecified checks passed days=8 exercises=28 null_targets=11 numeric_targets=17 equipment_rows=${equipmentRows.length} rollback_blocked=true`);
} finally {
  if (started) {
    const stopped = await run(pgCtlPath, ['-D', dataDir, '-m', 'immediate', '-w', 'stop']);
    if (stopped.code !== 0) {
      console.error(stopped.stderr);
    }
  }
  await rm(dataDir, { recursive: true, force: true });
}
