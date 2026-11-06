import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { freezeEquipmentTargetRows } from '../lib/import/equipment-targets.ts';
import { OWNED_SAVE_MAX_DAYS } from '../lib/import/limits.ts';
import {
  MANUAL_SETS_SAVE_MESSAGE,
  saveManualProgram,
} from '../lib/import/manual-program.ts';
import {
  materializeCustomExercises,
  missingPrescriptionMessage,
  prepareRoutineForSave,
  runGuardedProgramSave,
} from '../lib/import/one-tap-import.ts';
import {
  createMemoryRoutineDraftStore,
  createRoutineSaveGate,
  decodeRoutineDraft,
  routineDraftKey,
} from '../lib/import/routine-draft.ts';
import {
  programDayIndexLabel,
  scheduledProgramDayCount,
  UNSCHEDULED_PROGRAM_DAY_SUBTITLE,
} from '../lib/program-day-schedule.ts';
import {
  parseStructuredRoutine,
  STRUCTURED_PROGRAM_NAME,
  UNASSIGNED_SECTION_SUBTITLE,
} from '../lib/import/structured-routine.ts';
import type { ProgramReview, ReviewExercise } from '../lib/import/review-editor.ts';
import {
  acceptedProgramExerciseTargets,
  acceptedTodayTarget,
  missingTargetFields,
  plannedRepsLabel,
  prescribedRepsLine,
  readTodayTargets,
  removableSetNumber,
  routineRepsToStore,
  routineSetsToStore,
  SUGGESTED_REPS,
  SUGGESTED_SETS,
  SUGGESTION_NOTE,
  SUGGESTION_REPS_NOTE,
  SUGGESTION_SETS_NOTE,
  visibleSetCount,
  writeTodayTarget,
  type TodayTargetStore,
} from '../lib/workout-today.ts';

const userA = '11111111-1111-4111-8111-111111111111';
const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const serviceGap = 'The save service cannot store this routine yet. Nothing was saved. The original text is still here. Workout history was not changed.';

const source = await readFile(new URL('./fixtures/workout-import/friend-push-pull.txt', import.meta.url), 'utf8');
const catalog = [
  { id: 10, name: 'Bench Press' },
  { id: 12, name: 'Romanian Deadlift' },
  { id: 13, name: 'Pull Up' },
  { id: 14, name: 'Lat Pulldown' },
  { id: 15, name: 'Calf Raise' },
  { id: 16, name: 'Hammer Curl' },
];

function move(review: ProgramReview, name: string): ReviewExercise {
  for (const day of review.days) {
    const found = day.exercises.find((exercise) => exercise.sourceName === name);
    if (found) {
      return found;
    }
  }
  throw new Error(name);
}

function numberValue(exercise: ReviewExercise, field: 'sets' | 'repsMin' | 'repsMax'): number | null {
  return exercise[field].value;
}

assert.equal(parseStructuredRoutine(''), null);
assert.equal(parseStructuredRoutine('Bench press 3 x 8'), null);
assert.equal(parseStructuredRoutine('Push - Pull - Legs - Rest'), null);

const headed = parseStructuredRoutine('Push\nBench Press 3x8\n');
assert.ok(headed);
assert.equal(headed?.days.length, 1);
assert.equal(headed?.days[0]?.name, 'Push');
assert.equal(headed?.days[0]?.exercises.length, 1);
assert.equal(numberValue(headed?.days[0]?.exercises[0] as ReviewExercise, 'sets'), 3);

const pair = parseStructuredRoutine('Bench Press 3x8\nSquat 3x5\n');
assert.equal(pair?.days.length, 1);
assert.equal(pair?.days[0]?.name, 'Day 1');
assert.equal(pair?.days[0]?.exercises.length, 2);

const parsed = parseStructuredRoutine(source);
assert.ok(parsed);
assert.equal(parsed?.programName, STRUCTURED_PROGRAM_NAME);
assert.deepEqual(
  parsed?.days.map((day) => day.name),
  ['Push', 'Pull', 'Legs', 'Rest', 'Upper body', 'Legs Arms', 'Rest', 'Abs'],
);
assert.equal(parsed?.days[3]?.exercises.length, 0);
assert.equal(parsed?.days[4]?.exercises.length, 0);
assert.equal(parsed?.days[5]?.exercises.length, 0);
assert.equal(parsed?.days[6]?.exercises.length, 0);
assert.equal(parsed?.days[7]?.subtitle, UNASSIGNED_SECTION_SUBTITLE);
assert.equal(parsed?.days[7]?.name, 'Abs');
const counts = parsed?.days.map((day) => day.exercises.length) ?? [];
assert.deepEqual(counts, [8, 9, 6, 0, 0, 0, 0, 5]);
assert.equal(UNSCHEDULED_PROGRAM_DAY_SUBTITLE, UNASSIGNED_SECTION_SUBTITLE);
const scheduleLabels = (parsed?.days ?? []).map((day, index) =>
  programDayIndexLabel({ subtitle: day.subtitle, dayOrder: index + 1 }),
);
assert.deepEqual(scheduleLabels, ['1', '2', '3', '4', '5', '6', '7', null]);
assert.equal(scheduledProgramDayCount((parsed?.days ?? []).map((day) => ({ subtitle: day.subtitle }))), 7);
assert.equal(scheduleLabels.includes('8'), false);
const nineNames = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const nineDays = [nineNames.join(' - '), ...nineNames.flatMap((name) => ['', name, 'Curl 3x8'])].join('\n');
assert.equal(parseStructuredRoutine(nineDays), null);
assert.equal(prescribedRepsLine(0, 0), null);
assert.equal(prescribedRepsLine(0, 8), null);
assert.equal(prescribedRepsLine(6, 8), '6–8 reps');
const progressionSource = await readFile(new URL('../lib/progression.ts', import.meta.url), 'utf8');
assert.equal(progressionSource.includes('${input.minReps}–${input.maxReps} reps'), false);
assert.equal(progressionSource.includes('${item.minReps}–${item.maxReps} reps'), false);
assert.match(progressionSource, /const repRange = prescribedRepsLine\(input\.minReps, input\.maxReps\);/);
assert.match(progressionSource, /repRange \?\? 'Reps not set'/);
assert.match(progressionSource, /prescribedRepsLine\(item\.minReps, item\.maxReps\) \?\? 'Reps not set'/);

const bench = move(parsed as ProgramReview, 'Bench Press');
assert.equal(numberValue(bench, 'sets'), 3);
assert.equal(numberValue(bench, 'repsMin'), 6);
assert.equal(numberValue(bench, 'repsMax'), 6);
assert.equal(bench.weight?.value, 155);
assert.equal(bench.notes, '155 (80 machine)');
assert.equal(bench.sets.acceptance, 'extracted');

const incline = move(parsed as ProgramReview, 'Incline bench');
assert.equal(incline.weight?.value, 50);
assert.equal(incline.notes, '50 (70 machine)');
assert.equal(numberValue(move(parsed as ProgramReview, 'Carter extension'), 'sets'), 3);
assert.equal(numberValue(move(parsed as ProgramReview, 'Carter extension'), 'repsMin'), 8);
assert.equal(move(parsed as ProgramReview, 'Shoulder Press').weight?.value, 35);
assert.equal(move(parsed as ProgramReview, 'Shoulder Press').notes, null);

const single = move(parsed as ProgramReview, 'Single leg');
assert.equal(single.sets.acceptance, 'missing');
assert.equal(single.sets.value, null);
assert.equal(numberValue(single, 'repsMin'), 5);
assert.equal(single.notes, 'each');
assert.equal(move(parsed as ProgramReview, 'Side crunch').notes, 'each');
assert.equal(numberValue(move(parsed as ProgramReview, 'Straight leg'), 'repsMin'), 12);
assert.equal(move(parsed as ProgramReview, 'Straight leg').sets.value, null);

for (const name of ['Barbell Back Squats', 'Hack Squats/Leg Press', 'RDL', 'Quad Extension', 'Hamstring Curl', 'Calf Raises']) {
  const exercise = move(parsed as ProgramReview, name);
  assert.equal(exercise.sets.acceptance, 'missing');
  assert.equal(exercise.sets.value, null);
  assert.equal(exercise.repsMin.value, null);
  assert.equal(exercise.repsMax.value, null);
  assert.notEqual(exercise.sets.value, SUGGESTED_SETS);
  assert.notEqual(exercise.repsMin.value, SUGGESTED_REPS);
}

for (const day of parsed?.days ?? []) {
  for (const exercise of day.exercises) {
    assert.notEqual(exercise.sets.acceptance, 'accepted_suggestion');
    assert.notEqual(exercise.repsMin.acceptance, 'accepted_suggestion');
  }
}

const prepared = prepareRoutineForSave(parsed as ProgramReview, catalog, 'import');
assert.deepEqual(prepared.errors, []);
assert.equal(String(move(prepared.review, 'Bench Press').exerciseId), '10');
assert.equal(move(prepared.review, 'Bench Press').equipmentTargets?.[0]?.equipment, 'barbell');
assert.equal(move(prepared.review, 'Bench Press').equipmentTargets?.[0]?.weight, 155);
assert.equal(move(prepared.review, 'Bench Press').equipmentTargets?.[1]?.equipment, 'machine');
assert.equal(move(prepared.review, 'Bench Press').equipmentTargets?.[1]?.weight, 80);
assert.equal(
  move(prepared.review, 'Incline bench').equipmentTargets?.find((target) => target.equipment === 'machine')?.weight,
  70,
);
assert.equal(move(prepared.review, 'Incline bench').exerciseId, null);
assert.equal(String(move(prepared.review, 'RDL').exerciseId), '12');
assert.equal(move(prepared.review, 'RDL').sourceName, 'RDL');
assert.equal(String(move(prepared.review, 'Pull up').exerciseId), '13');
assert.equal(String(move(prepared.review, 'Lat Pulldown').exerciseId), '14');
assert.equal(String(move(prepared.review, 'Calf Raises').exerciseId), '15');
assert.equal(move(prepared.review, 'Calf Raises').sourceName, 'Calf Raises');
assert.equal(String(move(prepared.review, 'Hammer Curl').exerciseId), '16');
assert.equal(move(prepared.review, 'Carter extension').exerciseId, null);
assert.equal(move(prepared.review, 'Barbell Back Squats').exerciseId, null);
assert.equal(move(prepared.review, 'Hack Squats/Leg Press').exerciseId, null);
assert.equal(move(prepared.review, 'Single leg').exerciseId, null);
assert.equal(move(prepared.review, 'Preacher Barbell Curl').notes, '35 (60 bar)');
assert.equal(move(prepared.review, 'Preacher Barbell Curl').equipmentTargets, undefined);
assert.equal(prepared.review.days.length, 8);
const frozen = freezeEquipmentTargetRows(prepared.review.days);
assert.equal(frozen.length > 0, true);
assert.equal(frozen[0]?.dayOrder, 1);
assert.equal(frozen[0]?.targets[0]?.weight, 155);
assert.equal(frozen[0]?.targets[1]?.weight, 80);

const blockedNames = [
  'Barbell Back Squats',
  'Hack Squats/Leg Press',
  'RDL',
  'Quad Extension',
  'Hamstring Curl',
  'Calf Raises',
  'Single leg',
  'Straight leg',
  'Around world',
  'Side crunch',
  'Crunch and hold',
];
let manualSaves = 0;
let manualCustoms = 0;
const manual = await runGuardedProgramSave({
  mode: 'manual',
  review: parsed as ProgramReview,
  catalog,
  gate: createRoutineSaveGate(),
  store: createMemoryRoutineDraftStore(),
  userId: userA,
  scope: 'new',
  programId: null,
  programsLoaded: true,
  hasCurrentProgram: true,
  storedRaw: null,
  ownedProgramRpcEnabled: true,
  customWritesEnabled: true,
  persistTargets: true,
  sourceText: source,
  createCustom: async () => {
    manualCustoms += 1;
    return { ok: true, exerciseId: '70' };
  },
  saveProgram: async () => {
    manualSaves += 1;
    return { ok: true, programId: '9' };
  },
  saveTargets: async () => ({ ok: true }),
});
assert.equal(manual.status, 'failed');
assert.equal(manualSaves, 0);
assert.equal(manualCustoms, 0);
assert.equal(manual.errors[0], missingPrescriptionMessage(blockedNames));

const invalid = parseStructuredRoutine('Push\nCarter extension 13x8\n');
assert.ok(invalid);
let invalidCustoms = 0;
const invalidSave = await runGuardedProgramSave({
  mode: 'import',
  review: invalid as ProgramReview,
  catalog,
  gate: createRoutineSaveGate(),
  store: createMemoryRoutineDraftStore(),
  userId: userA,
  scope: 'import',
  programId: null,
  programsLoaded: true,
  hasCurrentProgram: true,
  storedRaw: null,
  ownedProgramRpcEnabled: true,
  customWritesEnabled: true,
  persistTargets: false,
  createCustom: async () => {
    invalidCustoms += 1;
    return { ok: true, exerciseId: '71' };
  },
  saveProgram: async () => ({ ok: true, programId: '9' }),
  saveTargets: async () => ({ ok: true }),
});
assert.equal(invalidSave.status, 'failed');
assert.equal(invalidCustoms, 0);
assert.equal(invalidSave.errors.includes(MANUAL_SETS_SAVE_MESSAGE), true);
assert.equal(invalidSave.errors.some((error) => error.includes('no sets or reps')), false);

const created: string[] = [];
const requestIds: Array<string | undefined> = [];
const gate = createRoutineSaveGate();
const store = createMemoryRoutineDraftStore();
let programCalls = 0;
let nextCustomId = 400;
const failed = await runGuardedProgramSave({
  mode: 'import',
  review: parsed as ProgramReview,
  catalog,
  gate,
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
  createCustom: async (name) => {
    created.push(name);
    nextCustomId += 1;
    return { ok: true, exerciseId: String(nextCustomId) };
  },
  saveProgram: async (_review, clientRequestId) => {
    programCalls += 1;
    requestIds.push(clientRequestId);
    return { ok: false, errors: [serviceGap] };
  },
  saveTargets: async () => ({ ok: true }),
});
assert.equal(failed.status, 'failed');
assert.equal(programCalls, 1);
assert.equal(created.includes('Carter extension'), true);
assert.equal(created.includes('Bench Press'), false);
assert.equal(created.includes('Barbell Back Squats'), true);
assert.equal(created.includes('Single leg'), true);
assert.equal(failed.errors.some((error) => error.includes('no sets or reps')), false);
assert.equal(failed.errors[0], serviceGap);
const draftKey = routineDraftKey(userA, 'import', null) ?? '';
const kept = decodeRoutineDraft(store.read(draftKey) ?? '');
assert.equal(kept?.review.days.length, 8);
assert.equal(kept?.review.days[7]?.name, 'Abs');
assert.equal(kept?.sourceText, source);
assert.ok(kept?.saveRequestId);

const retried = await runGuardedProgramSave({
  mode: 'import',
  review: failed.review,
  catalog,
  gate,
  store,
  userId: userA,
  scope: 'import',
  programId: null,
  programsLoaded: true,
  hasCurrentProgram: true,
  storedRaw: store.read(draftKey),
  ownedProgramRpcEnabled: true,
  customWritesEnabled: true,
  persistTargets: true,
  sourceText: source,
  createCustom: async (name) => {
    created.push(name);
    return { ok: true, exerciseId: String(800 + name.length) };
  },
  saveProgram: async (_review, clientRequestId) => {
    programCalls += 1;
    requestIds.push(clientRequestId);
    return { ok: true, programId: '9' };
  },
  saveTargets: async () => ({ ok: true }),
});
assert.equal(retried.status, 'saved');
assert.equal(retried.programId, '9');
assert.equal(requestIds[1], requestIds[0]);
assert.equal(created.filter((name) => name === 'Carter extension').length, 1);
const skipped = await runGuardedProgramSave({
  mode: 'import',
  review: retried.review,
  catalog,
  gate,
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
  createCustom: async () => ({ ok: true, exerciseId: '1' }),
  saveProgram: async () => {
    programCalls += 1;
    return { ok: true, programId: '10' };
  },
  saveTargets: async () => ({ ok: true }),
});
assert.equal(skipped.status, 'skipped');
assert.equal(programCalls, 2);

let materialId = 300;
const materialized = await materializeCustomExercises(prepared.review, {
  enabled: true,
  create: async () => {
    materialId += 1;
    return { ok: true, exerciseId: String(materialId) };
  },
});
assert.equal(materialized.ok, true);
if (materialized.ok) {
  let rpcCalls = 0;
  const rejected = await saveManualProgram(materialized.review, {
    userId: userA,
    programs: [{ id: '1', name: 'Current split', isActive: true }],
    subtitleRequired: false,
    persistPlannedWeight: true,
    allowUnspecifiedPrescription: true,
    maxDays: OWNED_SAVE_MAX_DAYS,
    clientRequestId: requestId,
    ownedRpc: async () => {
      rpcCalls += 1;
      return { data: null, error: { message: 'invalid_import: sets' } };
    },
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(rejected.errors[0], serviceGap);
  }
  assert.equal(rpcCalls, 1);
  const ownerRejected = await saveManualProgram(materialized.review, {
    userId: userA,
    programs: [{ id: '1', name: 'Current split', isActive: true }],
    subtitleRequired: false,
    persistPlannedWeight: true,
    allowUnspecifiedPrescription: true,
    maxDays: OWNED_SAVE_MAX_DAYS,
    clientRequestId: requestId,
    ownedRpc: async () => ({ data: null, error: { message: 'invalid_import: exercise_owner' } }),
  });
  assert.equal(ownerRejected.ok, false);
  if (!ownerRejected.ok) {
    assert.equal(
      ownerRejected.errors[0],
      'This routine includes an exercise from another account. Nothing was saved. Workout history was not changed.',
    );
    assert.equal(ownerRejected.errors[0].includes('11111111'), false);
  }

  let payload: { name?: string; days?: { name: string; subtitle: string | null; exercises: Record<string, unknown>[] }[] } | null = null;
  const saved = await saveManualProgram(materialized.review, {
    userId: userA,
    programs: [{ id: '1', name: 'Current split', isActive: true }],
    subtitleRequired: false,
    persistPlannedWeight: true,
    allowUnspecifiedPrescription: true,
    maxDays: OWNED_SAVE_MAX_DAYS,
    clientRequestId: requestId,
    ownedRpc: async (args) => {
      payload = args.p_program as typeof payload;
      return { data: 9, error: null };
    },
  });
  assert.equal(saved.ok, true);
  assert.equal(payload?.name, STRUCTURED_PROGRAM_NAME);
  assert.equal(payload?.days?.length, 8);
  const legs = payload?.days?.find((day) => day.name === 'Legs');
  const squat = legs?.exercises.find((row) => String(row.exercise_id) === String(move(materialized.review, 'Barbell Back Squats').exerciseId));
  assert.equal(squat?.target_sets, null);
  assert.equal(squat?.min_reps, null);
  assert.equal(squat?.max_reps, null);
  const abs = payload?.days?.find((day) => day.name === 'Abs');
  assert.equal(abs?.subtitle, UNASSIGNED_SECTION_SUBTITLE);
  const legRaise = abs?.exercises.find((row) => String(row.exercise_id) === String(move(materialized.review, 'Single leg').exerciseId));
  assert.equal(legRaise?.target_sets, null);
  assert.equal(legRaise?.min_reps, 5);
  assert.equal(legRaise?.max_reps, 5);
  assert.equal(legRaise?.notes, 'each');
  const push = payload?.days?.[0];
  const savedBench = push?.exercises[0];
  assert.equal(savedBench?.target_sets, 3);
  assert.equal(savedBench?.min_reps, 6);
  assert.equal(savedBench?.max_reps, 6);
  assert.equal(savedBench?.planned_weight, 155);
  assert.equal(savedBench?.notes, '155 (80 machine)');

  const strict = await saveManualProgram(materialized.review, {
    userId: userA,
    programs: [{ id: '1', name: 'Current split', isActive: true }],
    subtitleRequired: true,
    persistPlannedWeight: true,
    ownedRpc: async () => {
      throw new Error('strict save should not call the database');
    },
  });
  assert.equal(strict.ok, false);
  if (!strict.ok) {
    assert.equal(strict.errors.includes(MANUAL_SETS_SAVE_MESSAGE), true);
  }
}

assert.equal(SUGGESTED_SETS, 3);
assert.equal(SUGGESTED_REPS, 8);
assert.match(SUGGESTION_NOTE, /Suggestion, not from the import/);
assert.match(SUGGESTION_SETS_NOTE, /3 sets/);
assert.match(SUGGESTION_REPS_NOTE, /8 reps/);
assert.deepEqual(
  missingTargetFields({
    todaySets: null,
    todayReps: null,
    prescribedSets: 3,
    prescribedRepsMin: 6,
    prescribedRepsMax: 6,
    recordedMax: 0,
  }),
  { sets: false, reps: false },
);
assert.deepEqual(
  missingTargetFields({
    todaySets: null,
    todayReps: null,
    prescribedSets: null,
    prescribedRepsMin: 5,
    prescribedRepsMax: 5,
    recordedMax: 0,
  }),
  { sets: true, reps: false },
);
assert.deepEqual(
  missingTargetFields({
    todaySets: null,
    todayReps: null,
    prescribedSets: null,
    prescribedRepsMin: null,
    prescribedRepsMax: null,
    recordedMax: 0,
  }),
  { sets: true, reps: true },
);
assert.deepEqual(
  missingTargetFields({
    todaySets: null,
    todayReps: null,
    prescribedSets: null,
    prescribedRepsMin: null,
    prescribedRepsMax: null,
    recordedMax: 2,
  }),
  { sets: false, reps: true },
);
const repsOnly = acceptedTodayTarget({
  askSets: false,
  askReps: true,
  setsText: '3',
  repsText: '8',
  existingSets: 3,
  existingReps: null,
});
assert.deepEqual(repsOnly, { ok: true, sets: 3, reps: 8 });
const bothMissing = acceptedTodayTarget({
  askSets: true,
  askReps: true,
  setsText: '',
  repsText: '8',
  existingSets: null,
  existingReps: null,
});
assert.equal(bothMissing.ok, false);
assert.equal(visibleSetCount({ todaySets: null, prescribedSets: null, recordedMax: 0 }), 0);
assert.equal(visibleSetCount({ todaySets: 4, prescribedSets: 3, recordedMax: 2 }), 4);
assert.equal(plannedRepsLabel({ todayReps: null, prescribedRepsMin: 6, prescribedRepsMax: 8 }), '6–8');
assert.deepEqual(
  routineRepsToStore({ todayReps: null, prescribedRepsMin: 6, prescribedRepsMax: 8 }),
  { min: 6, max: 8 },
);
assert.deepEqual(routineRepsToStore({ todayReps: 10, prescribedRepsMin: 6, prescribedRepsMax: 8 }), { min: 10, max: 10 });
assert.equal(routineSetsToStore({ todaySets: null, prescribedSets: null, recordedMax: 4 }), 4);
assert.equal(removableSetNumber([{ setNumber: 1, isCompleted: false }, { setNumber: 2, isCompleted: true }], false), null);
assert.equal(removableSetNumber([{ setNumber: 1, isCompleted: true }, { setNumber: 2, isCompleted: false }], false), 2);
assert.equal(removableSetNumber([{ setNumber: 1, isCompleted: false }], true), null);

const memory = new Map<string, string>();
const todayStore: TodayTargetStore = {
  read: (sessionId) => memory.get(sessionId) ?? null,
  write: (sessionId, value) => {
    memory.set(sessionId, value);
  },
};
const written = writeTodayTarget(todayStore, '15', '44', { sets: 3, reps: 8 });
assert.deepEqual(written['44'], { sets: 3, reps: 8 });
assert.deepEqual(readTodayTargets(todayStore, '15')['44'], { sets: 3, reps: 8 });
const rejectedId = writeTodayTarget(todayStore, '15', 'session:44', { sets: 1, reps: 1 });
assert.equal(rejectedId['session:44'], undefined);
assert.deepEqual(readTodayTargets(todayStore, '15')['44'], { sets: 3, reps: 8 });
const routineWrite = acceptedProgramExerciseTargets('44', { sets: 3, repsMin: 8, repsMax: 8 });
assert.deepEqual(routineWrite, { ok: true, id: '44', sets: 3, repsMin: 8, repsMax: 8 });
assert.equal(acceptedProgramExerciseTargets('session:44', { sets: 3, repsMin: 8, repsMax: 8 }).ok, false);
assert.equal(acceptedProgramExerciseTargets('44:swap', { sets: 3, repsMin: 8, repsMax: 8 }).ok, false);
assert.equal(acceptedProgramExerciseTargets('44', { sets: 0, repsMin: 8, repsMax: 8 }).ok, false);
assert.equal(acceptedProgramExerciseTargets('44', { sets: 13, repsMin: 8, repsMax: 8 }).ok, false);
assert.equal(acceptedProgramExerciseTargets('44', { sets: 3, repsMin: 10, repsMax: 8 }).ok, false);

console.log('structured routine checks passed');
