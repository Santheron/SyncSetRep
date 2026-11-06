import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { establishedEquipmentKind, resolveEquipmentExercise } from '../lib/equipment-identity.ts';
import { planReplacementSets } from '../lib/exercise-swap.ts';
import { loadEquipmentSuggestions } from '../lib/equipment-suggestion-load.ts';
import { suggestLinkedEquipmentProgress, type LinkedHistorySet } from '../lib/equipment-progression.ts';
import { createCustomExercise, CUSTOM_EXERCISE_TAKEN_MESSAGE } from '../lib/import/custom-exercise.ts';
import { CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE, MANUAL_SETS_SAVE_MESSAGE, saveManualProgram } from '../lib/import/manual-program.ts';
import { IMPORT_BLANK_SUBTITLE_MESSAGE } from '../lib/import/save-plan.ts';
import {
  saveEquipmentTargetRow,
  saveEquipmentTargetsForSavedRows,
  equipmentTargetRowsFromReview,
  equipmentTargetRowsFromSaved,
  locateOwnedProgramExerciseIds,
} from '../lib/import/equipment-target-save.ts';
import {
  describePlateLoad,
  formatEquipmentTarget,
  freezeEquipmentTargetRows,
  parseEquipmentWeightText,
  parsePlateSetup,
  sanitizeEquipmentTargets,
  savedRowsWithExerciseIds,
  EQUIPMENT_WEIGHT_MESSAGE,
  MIXED_UNIT_MESSAGE,
  type SavedEquipmentTargetRow,
} from '../lib/import/equipment-targets.ts';
import { matchImportedExercises } from '../lib/import/match-exercises.ts';
import {
  isRestDayLabel,
  materializeCustomExercises,
  missingPrescriptionMessage,
  ONE_TAP_DUPLICATE_MESSAGE,
  ONE_TAP_PARTIAL_MESSAGE,
  ONE_TAP_TARGET_MAPPING_MESSAGE,
  prepareRoutineForSave,
  runGuardedProgramSave,
} from '../lib/import/one-tap-import.ts';
import {
  createProgramReview,
  type ProgramReview,
  type ReviewDay,
  type ReviewExercise,
} from '../lib/import/review-editor.ts';
import {
  createMemoryRoutineDraftStore,
  createRoutineSaveGate,
  decodeRoutineDraft,
  encodeRoutineDraft,
  resolveRoutineScreenDraft,
  ROUTINE_DRAFT_PARTIAL_TARGET_MESSAGE,
  routineDraftKey,
  storeRoutineReview,
} from '../lib/import/routine-draft.ts';
import { validateImportModelOutput } from '../lib/import/validate-draft.ts';
import type { WorkoutExercise } from '../lib/workout-session.ts';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

function field(value: number | null) {
  return value == null
    ? { acceptance: 'missing' as const, value: null }
    : { acceptance: 'extracted' as const, value, suggestion: null };
}

function exercise(overrides: Partial<ReviewExercise> = {}): ReviewExercise {
  return {
    source: 'imported',
    sourceName: 'Bench Press',
    exerciseId: null,
    matchStatus: 'unmatched',
    sets: field(3),
    repsMin: field(8),
    repsMax: field(8),
    restSeconds: field(null),
    notes: 'Pause',
    ...overrides,
  };
}

function day(name: string, exercises: ReviewExercise[]): ReviewDay {
  return { name, subtitle: null, exercises };
}

function review(days: ReviewDay[], origin: ProgramReview['origin'] = 'import'): ProgramReview {
  return createProgramReview({ origin, programName: 'Imported Week', days });
}

function setsOf(weight: number, reps: number, count = 3): LinkedHistorySet[] {
  return Array.from({ length: count }, (_, index) => ({
    setNumber: index + 1,
    weight,
    reps,
    isCompleted: true,
  }));
}

const both = parseEquipmentWeightText('155 (80 machine)');
assert.equal(both.ok, true);
if (both.ok) {
  assert.equal(both.plannedWeight, 155);
  assert.equal(both.unit, null);
  assert.deepEqual(
    both.targets?.map((target) => [target.equipment, target.weight]),
    [
      ['barbell', 155],
      ['machine', 80],
    ],
  );
}
for (const text of ['155', '155 lb']) {
  const parsed = parseEquipmentWeightText(text);
  assert.equal(parsed.ok, true, text);
  if (parsed.ok) {
    assert.equal(parsed.plannedWeight, 155, text);
    assert.equal(parsed.targets, null, text);
  }
}
const machineOnly = parseEquipmentWeightText('80 machine');
assert.equal(machineOnly.ok, true);
if (machineOnly.ok) {
  assert.equal(machineOnly.plannedWeight, 80);
  assert.equal(machineOnly.targets?.[0]?.equipment, 'machine');
  assert.equal(machineOnly.targets?.[0]?.weight, 80);
}
const mixed = parseEquipmentWeightText('155 lb (80 kg machine)');
assert.equal(mixed.ok, false);
if (!mixed.ok) {
  assert.equal(mixed.error, MIXED_UNIT_MESSAGE);
}
const unnamedSecond = parseEquipmentWeightText('155 (80)');
assert.equal(unnamedSecond.ok, false);
if (!unnamedSecond.ok) {
  assert.equal(unnamedSecond.error, EQUIPMENT_WEIGHT_MESSAGE);
}
const dumbbell = parseEquipmentWeightText('40 lb dumbbell');
assert.equal(dumbbell.ok, true);
if (dumbbell.ok) {
  assert.equal(dumbbell.targets?.[0]?.weight, 40);
  assert.equal(formatEquipmentTarget(dumbbell.targets?.[0] ?? { equipment: 'dumbbell', weight: 40, unit: 'lb' }), '40 lb per dumbbell');
  assert.equal(String(dumbbell.targets?.[0]?.weight).includes('80'), false);
}
const lowBar = parseEquipmentWeightText('20 barbell');
assert.equal(lowBar.ok, true);
if (lowBar.ok) {
  assert.equal(lowBar.targets?.[0]?.weight, 20);
}
assert.match(describePlateLoad(20), /below the 45 lb bar/);
const customPlates = parsePlateSetup('35', '25, 10, 5, 2.5');
assert.equal(customPlates.ok, true);
if (customPlates.ok) {
  assert.equal(customPlates.setup.barWeightLb, 35);
  assert.equal(customPlates.setup.platesLb.includes(45), false);
  assert.match(describePlateLoad(20, customPlates.setup), /below the 35 lb bar/);
}
const roundTrip = sanitizeEquipmentTargets([
  { equipment: 'machine', weight: 80, unit: 'lb', variation_exercise_id: 44 },
]);
assert.equal(roundTrip?.[0]?.variationExerciseId, '44');
assert.equal(roundTrip?.[0]?.weight, 80);

const catalog = [
  { id: 10, name: 'Bench Press' },
  { id: 11, name: 'Incline Barbell Bench Press' },
];
assert.equal(matchImportedExercises(catalog, 'Bench').method, 'subset');
assert.equal(matchImportedExercises(catalog, 'Incline Bench Press').method, 'alias-suggestion');
assert.equal(matchImportedExercises(catalog, 'incline barbell bench').method, 'alias');

const prepared = prepareRoutineForSave(
  review([
    day('Rest Day', [exercise({ sourceName: 'Should not train', notes: 'rest' })]),
    day('Rest Pause', [exercise({ sourceName: 'Bench Press', exerciseId: 99, matchStatus: 'matched' })]),
    day('Push', [
      exercise({ sourceName: 'Bench Press' }),
      exercise({
        sourceName: 'Bench',
        exerciseId: 10,
        matchStatus: 'matched',
        equipmentTargets: [{ equipment: 'machine', weight: 80, unit: 'lb' }],
      }),
      exercise({
        sourceName: 'Incline Bench Press',
        exerciseId: 11,
        matchStatus: 'matched',
      }),
      exercise({
        sourceName: 'incline barbell bench',
        exerciseId: null,
        matchStatus: 'unmatched',
      }),
      exercise({
        sourceName: 'My Custom Press',
        exerciseId: 42,
        matchStatus: 'manual',
      }),
    ]),
    day('Off', [exercise({ sourceName: 'Row' })]),
  ]),
  catalog,
  'import',
);
assert.equal(prepared.errors.length, 0);
assert.equal(prepared.review.days[0]?.exercises.length, 0);
assert.equal(prepared.review.days[1]?.name, 'Rest Pause');
assert.equal(prepared.review.days[1]?.exercises.length, 1);
assert.equal(prepared.review.days[1]?.exercises[0]?.sourceName, 'Bench Press');
assert.equal(prepared.review.days[2]?.exercises[0]?.exerciseId, '10');
assert.equal(prepared.review.days[2]?.exercises[1]?.exerciseId, null);
assert.equal(prepared.review.days[2]?.exercises[1]?.sourceName, 'Bench');
assert.equal(prepared.review.days[2]?.exercises[2]?.exerciseId, null);
assert.equal(prepared.review.days[2]?.exercises[2]?.sourceName, 'Incline Bench Press');
assert.equal(String(prepared.review.days[2]?.exercises[3]?.exerciseId), '11');
assert.equal(prepared.review.days[2]?.exercises[4]?.exerciseId, 42);
assert.equal(prepared.review.days[3]?.exercises.length, 0);
assert.equal(isRestDayLabel('rest pause'), false);
assert.equal(isRestDayLabel('  Rest   day '), true);

const manualKept = prepareRoutineForSave(
  review([day('Push', [exercise({ sourceName: 'Bench', exerciseId: 10, matchStatus: 'matched' })])], 'manual'),
  catalog,
  'manual',
);
assert.equal(manualKept.review.days[0]?.exercises[0]?.exerciseId, 10);

const merged = prepareRoutineForSave(
  review([
    day('Push', [
      exercise({
        exerciseId: 10,
        matchStatus: 'manual',
        sourceName: 'Bench Press',
        equipmentTargets: [{ equipment: 'barbell', weight: 155, unit: 'lb' }],
      }),
      exercise({
        exerciseId: 10,
        matchStatus: 'manual',
        sourceName: 'Bench Press',
        equipmentTargets: [{ equipment: 'machine', weight: 80, unit: 'lb' }],
      }),
    ]),
  ]),
  catalog,
  'manual',
);
assert.equal(merged.errors.length, 0);
assert.equal(merged.review.days[0]?.exercises.length, 1);
assert.deepEqual(
  merged.review.days[0]?.exercises[0]?.equipmentTargets?.map((target) => [target.equipment, target.weight]),
  [
    ['barbell', 155],
    ['machine', 80],
  ],
);
assert.equal(merged.review.days[0]?.exercises[0]?.weight?.value, 155);

const conflicted = prepareRoutineForSave(
  review([
    day('Push', [
      exercise({
        exerciseId: 10,
        matchStatus: 'manual',
        equipmentTargets: [{ equipment: 'machine', weight: 80, unit: 'lb' }],
      }),
      exercise({
        exerciseId: 10,
        matchStatus: 'manual',
        equipmentTargets: [{ equipment: 'machine', weight: 70, unit: 'lb' }],
      }),
    ]),
  ]),
  catalog,
  'manual',
);
assert.equal(conflicted.errors.includes(ONE_TAP_DUPLICATE_MESSAGE), true);

const duplicateNames = prepareRoutineForSave(
  review([
    day('Push', [
      exercise({ sourceName: 'My Lift', exerciseId: null, matchStatus: 'unmatched' }),
      exercise({ sourceName: 'my   lift', exerciseId: null, matchStatus: 'unmatched' }),
    ]),
  ]),
  catalog,
  'import',
);
assert.equal(duplicateNames.errors.includes(ONE_TAP_DUPLICATE_MESSAGE), true);

function model(weight: string) {
  return {
    programName: { origin: 'extracted', value: 'Upper Lower' },
    warnings: [],
    days: [
      {
        name: { origin: 'extracted', value: 'Upper' },
        subtitle: { origin: 'extracted', value: 'Monday' },
        exercises: [
          {
            sourceName: 'Bench Press',
            sets: { origin: 'extracted', value: 3, suggestion: null },
            repsMin: { origin: 'extracted', value: 8, suggestion: null },
            repsMax: { origin: 'extracted', value: 8, suggestion: null },
            restSeconds: { origin: 'extracted', value: 90, suggestion: null },
            weight: { origin: 'extracted', value: weight, suggestion: null },
            notes: { origin: 'extracted', value: 'Pause' },
          },
        ],
      },
    ],
  };
}

const importedBoth = validateImportModelOutput(model('155 (80 machine)'));
assert.equal(importedBoth.ok, true);
if (importedBoth.ok) {
  const row = importedBoth.data.days[0]?.exercises[0];
  assert.equal(row?.weight.value, 155);
  assert.equal(row?.notes.value, 'Pause');
  assert.deepEqual(
    row?.equipmentTargets?.map((target) => [target.equipment, target.weight]),
    [
      ['barbell', 155],
      ['machine', 80],
    ],
  );
  assert.equal(importedBoth.data.issues.some((issue) => issue.code === 'weight_dropped'), false);
}
const importedBodyweight = validateImportModelOutput(model('bodyweight'));
assert.equal(importedBodyweight.ok, true);
if (importedBodyweight.ok) {
  assert.equal(importedBodyweight.data.days[0]?.exercises[0]?.weight.value, null);
  assert.equal(importedBodyweight.data.days[0]?.exercises[0]?.equipmentTargets, undefined);
  assert.equal(importedBodyweight.data.issues.some((issue) => issue.code === 'weight_dropped'), true);
}
const importedStack = validateImportModelOutput(model('225 lb stack 8'));
assert.equal(importedStack.ok, true);
if (importedStack.ok) {
  assert.equal(importedStack.data.days[0]?.exercises[0]?.equipmentTargets, undefined);
}

const wireRows = equipmentTargetRowsFromReview(
  review([
    day('Push', [
      exercise({
        equipmentTargets: [{ equipment: 'machine', weight: 80, unit: 'lb', variationExerciseId: '44' }],
      }),
    ]),
  ]),
);
assert.equal(wireRows[0]?.targets[0]?.variation_exercise_id, 44);
assert.equal(Object.hasOwn(wireRows[0]?.targets[0] ?? {}, 'variationExerciseId'), false);

let rpcCalls = 0;
const blockedRow = await saveEquipmentTargetRow(
  '4',
  [{ equipment: 'machine', weight: 80, unit: 'lb' }],
  {
    enabled: false,
    rpc: async () => {
      rpcCalls += 1;
      return { data: { ok: true }, error: null };
    },
  },
);
assert.equal(blockedRow.ok, false);
assert.equal(rpcCalls, 0);
const rejectedRow = await saveEquipmentTargetRow('4', [{ equipment: 'machine', weight: 80, unit: 'lb' }], {
  enabled: true,
  rpc: async () => ({ data: { ok: false }, error: null }),
});
assert.equal(rejectedRow.ok, false);

const machineSuggestion = suggestLinkedEquipmentProgress({
  exerciseName: 'Bench Press',
  selectedEquipment: 'machine',
  targetSets: 3,
  incrementLb: 5,
  history: [
    { equipment: 'barbell', finishedAt: '2026-11-01', sets: setsOf(145, 8) },
    { equipment: 'barbell', finishedAt: '2026-11-03', sets: setsOf(155, 8) },
    { equipment: 'machine', finishedAt: '2026-11-02', sets: setsOf(80, 8) },
  ],
});
assert.equal(machineSuggestion.suggestedWeight, 85);
assert.match(machineSuggestion.reason, /145/);
assert.match(machineSuggestion.reason, /155/);
assert.match(machineSuggestion.reason, /80/);
assert.match(machineSuggestion.reason, /85/);
assert.match(machineSuggestion.reason, /not a 10 lb copy/);
const noMachineHistory = suggestLinkedEquipmentProgress({
  exerciseName: 'Bench Press',
  selectedEquipment: 'machine',
  targetSets: 3,
  incrementLb: 5,
  history: [
    { equipment: 'barbell', finishedAt: '2026-11-01', sets: setsOf(145, 8) },
    { equipment: 'barbell', finishedAt: '2026-11-03', sets: setsOf(155, 8) },
  ],
});
assert.equal(noMachineHistory.suggestedWeight, null);
assert.match(noMachineHistory.reason, /no machine number was taken/);
const dumbbellSuggestion = suggestLinkedEquipmentProgress({
  exerciseName: 'Bench Press',
  selectedEquipment: 'dumbbell',
  targetSets: 3,
  incrementLb: 5,
  history: [
    { equipment: 'barbell', finishedAt: '2026-11-01', sets: setsOf(145, 8) },
    { equipment: 'barbell', finishedAt: '2026-11-03', sets: setsOf(155, 8) },
    { equipment: 'dumbbell', finishedAt: '2026-11-02', sets: setsOf(30, 8) },
  ],
});
assert.equal(dumbbellSuggestion.suggestedWeight, 35);
assert.match(dumbbellSuggestion.reason, /per dumbbell/);
assert.equal(dumbbellSuggestion.reason.includes('70'), false);
assert.equal(
  suggestLinkedEquipmentProgress({
    exerciseName: 'Pull Up',
    selectedEquipment: 'bodyweight',
    targetSets: 3,
    history: [],
  }).suggestedWeight,
  null,
);
assert.equal(
  suggestLinkedEquipmentProgress({
    exerciseName: 'Bench Press',
    selectedEquipment: 'machine',
    targetSets: 3,
    incrementLb: 5,
    history: [
      { equipment: 'barbell', finishedAt: '2026-11-01', sets: setsOf(100, 8) },
      { equipment: 'barbell', finishedAt: '2026-11-03', sets: setsOf(110, 8) },
      { equipment: 'machine', finishedAt: '2026-11-02', sets: setsOf(1998, 8) },
    ],
  }).suggestedWeight,
  null,
);

function picker(id: string, name: string): WorkoutExercise {
  return {
    id,
    name,
    category: 'chest',
    exerciseType: 'compound',
    equipmentType: null,
    warmupEnabled: null,
    minWeight: null,
    weightIncrement: 5,
  };
}

function finished(exerciseId: string, sessionId: string, finishedAt: string, weight: number) {
  return setsOf(weight, 8).map((set) => ({
    exerciseId,
    sessionId,
    finishedAt,
    setNumber: set.setNumber,
    weight: set.weight,
    reps: set.reps,
    isCompleted: true,
  }));
}

const loadedSuggestion = await loadEquipmentSuggestions(
  [
    {
      slotId: 'machine-slot',
      name: 'Bench Press (machine)',
      equipmentType: null,
      targetSets: 3,
      category: 'chest',
      exerciseType: 'compound',
      weightIncrement: 5,
    },
  ],
  'current',
  {
    listExercises: async () => ({
      ok: true,
      data: [
        picker('1', 'Bench Press (barbell)'),
        picker('2', 'Bench Press (machine)'),
        picker('3', 'Squat (barbell)'),
      ],
    }),
    loadSets: async () => ({
      ok: true,
      data: [
        ...finished('1', 'b1', '2026-11-01T00:00:00Z', 145),
        ...finished('1', 'b2', '2026-11-03T00:00:00Z', 155),
        ...finished('2', 'm1', '2026-11-02T00:00:00Z', 80),
        ...finished('3', 's1', '2026-11-04T00:00:00Z', 100),
        ...finished('3', 's2', '2026-11-05T00:00:00Z', 200),
      ],
    }),
  },
);
assert.equal(loadedSuggestion['machine-slot']?.suggestedWeight, 85);
assert.match(loadedSuggestion['machine-slot']?.reason ?? '', /145/);
assert.match(loadedSuggestion['machine-slot']?.reason ?? '', /155/);
assert.equal((loadedSuggestion['machine-slot']?.reason ?? '').includes('200'), false);
assert.deepEqual(
  await loadEquipmentSuggestions(
    [
      {
        slotId: 'machine-slot',
        name: 'Bench Press (machine)',
        equipmentType: null,
        targetSets: 3,
        category: null,
        exerciseType: null,
        weightIncrement: 5,
      },
    ],
    undefined,
    { listExercises: async () => ({ ok: false, error: 'down' }) },
  ),
  {},
);

const swapPlan = planReplacementSets({
  fromExerciseId: '1',
  toExerciseId: '2',
  targetSets: 3,
  keepCompleted: true,
  weight: 80,
  sets: [
    { id: 'completed', exerciseId: '1', setNumber: 1, isCompleted: true },
    { id: 'open', exerciseId: '1', setNumber: 2, isCompleted: false },
  ],
});
assert.equal(swapPlan.ok, true);
if (swapPlan.ok) {
  assert.deepEqual(swapPlan.deleteIds, ['open']);
}
assert.equal(
  planReplacementSets({
    fromExerciseId: '1',
    toExerciseId: '2',
    targetSets: 3,
    keepCompleted: false,
    weight: 80,
    sets: [{ id: 'completed', exerciseId: '1', setNumber: 1, isCompleted: true }],
  }).ok,
  false,
);

const benchOrigin = { id: '10', name: 'Bench Press', equipmentType: null as string | null };
const knownEquipment = [
  benchOrigin,
  { id: '21', name: 'Bench Press (machine)', equipmentType: null },
  { id: '15', name: 'Bench Press (machine)', equipmentType: 'machine' },
  { id: '40', name: 'Bench Press (machine)', equipmentType: null },
  { id: '30', name: 'Incline Bench Press', equipmentType: 'barbell' },
  { id: '31', name: 'Barbell Bench Press', equipmentType: 'barbell' },
];
assert.equal(establishedEquipmentKind('Bench Press', null), 'barbell');
assert.equal(establishedEquipmentKind('Bench Press', 'machine'), 'machine');
assert.equal(establishedEquipmentKind('Bench Press (cable)', 'barbell'), 'cable');
const stayed = resolveEquipmentExercise({
  selected: 'barbell',
  currentId: '10',
  currentName: 'Bench Press',
  originId: '10',
  originName: 'Bench Press',
  known: knownEquipment,
});
assert.equal(stayed.action, 'stay');
assert.equal(stayed.exerciseId, '10');
const storedVariation = resolveEquipmentExercise({
  selected: 'machine',
  currentId: '10',
  currentName: 'Bench Press',
  originId: '10',
  originName: 'Bench Press',
  targets: [{ equipment: 'machine', weight: 80, unit: 'lb', variationExerciseId: '21' }],
  known: knownEquipment,
});
assert.equal(storedVariation.action, 'reuse');
assert.equal(storedVariation.exerciseId, '21');
let switched = { id: '10', name: 'Bench Press', equipmentType: null as string | null };
const rememberedIds: Record<string, string> = {};
const identityCatalog = [...knownEquipment];
function switchEquipment(selected: 'barbell' | 'machine' | 'dumbbell' | 'cable' | 'bodyweight') {
  const base = {
    selected,
    currentId: switched.id,
    currentName: switched.name,
    currentEquipmentType: switched.equipmentType,
    originId: benchOrigin.id,
    originName: benchOrigin.name,
    originEquipmentType: benchOrigin.equipmentType,
    rememberedId: rememberedIds[selected] ?? null,
  };
  let choice = resolveEquipmentExercise(base);
  if (choice.action === 'create') {
    choice = resolveEquipmentExercise({ ...base, known: identityCatalog });
  }
  if (choice.action === 'create' && choice.createName) {
    const createdId = String(50 + identityCatalog.length);
    identityCatalog.push({ id: createdId, name: choice.createName, equipmentType: selected });
    choice = { action: 'reuse', exerciseId: createdId, createName: null };
  }
  const next = identityCatalog.find((exercise) => exercise.id === choice.exerciseId);
  assert.ok(next);
  rememberedIds[selected] = next.id;
  switched = { id: next.id, name: next.name, equipmentType: next.equipmentType };
  return next.id;
}
assert.equal(switchEquipment('machine'), '15');
assert.equal(switchEquipment('barbell'), '10');
assert.equal(switchEquipment('machine'), '15');
const dumbbellId = switchEquipment('dumbbell');
assert.equal(switchEquipment('dumbbell'), dumbbellId);
assert.equal(switchEquipment('barbell'), '10');
assert.equal(identityCatalog.filter((exercise) => exercise.name === 'Bench Press (dumbbell)').length, 1);
assert.equal(identityCatalog.some((exercise) => exercise.name === 'Bench Press (barbell)'), false);
assert.equal(switched.id === '30' || switched.id === '31', false);
const machineOrigin = resolveEquipmentExercise({
  selected: 'barbell',
  currentId: '21',
  currentName: 'Bench Press (machine)',
  currentEquipmentType: 'machine',
  originId: '21',
  originName: 'Bench Press (machine)',
  originEquipmentType: 'machine',
  known: [
    { id: '30', name: 'Incline Bench Press', equipmentType: 'barbell' },
    { id: '31', name: 'Barbell Bench Press', equipmentType: 'barbell' },
  ],
});
assert.equal(machineOrigin.action, 'create');
assert.equal(machineOrigin.createName, 'Bench Press (barbell)');
const remembered = resolveEquipmentExercise({
  selected: 'cable',
  currentId: '10',
  currentName: 'Bench Press',
  originId: '10',
  originName: 'Bench Press',
  rememberedId: '88',
});
assert.equal(remembered.action, 'reuse');
assert.equal(remembered.exerciseId, '88');

type SaveCall = { id: string | undefined; targets: number };
async function runSave(input: Partial<Parameters<typeof runGuardedProgramSave>[0]> & { review: ProgramReview }) {
  const calls: SaveCall = { id: undefined, targets: 0 };
  const created: string[] = [];
  let programCalls = 0;
  const gate = input.gate ?? createRoutineSaveGate();
  const store = input.store ?? createMemoryRoutineDraftStore();
  const { createCustom: providedCreate, saveProgram: providedSave, ...rest } = input;
  const result = await runGuardedProgramSave({
    mode: 'import',
    catalog,
    userId: userA,
    scope: 'import',
    programId: null,
    programsLoaded: true,
    hasCurrentProgram: false,
    storedRaw: null,
    ownedProgramRpcEnabled: true,
    customWritesEnabled: true,
    persistTargets: true,
    saveTargets: async () => {
      calls.targets += 1;
      return { ok: true };
    },
    ...rest,
    gate,
    store,
    createCustom: async (name) => {
      created.push(name);
      if (providedCreate) {
        return providedCreate(name);
      }
      return { ok: true, exerciseId: '70' };
    },
    saveProgram: async (review, clientRequestId) => {
      programCalls += 1;
      calls.id = clientRequestId;
      if (providedSave) {
        return providedSave(review, clientRequestId);
      }
      return { ok: true, programId: '9' };
    },
  });
  return { result, calls, created, programCalls, gate, store };
}

const saved = await runSave({
  review: review([
    day('Push', [
      exercise({
        sourceName: 'Bench Press',
        equipmentTargets: [
          { equipment: 'barbell', weight: 155, unit: 'lb' },
          { equipment: 'machine', weight: 80, unit: 'lb' },
        ],
      }),
    ]),
  ]),
});
assert.equal(saved.result.status, 'saved');
assert.equal(saved.programCalls, 1);
assert.equal(saved.calls.targets, 1);
assert.equal(saved.created.length, 0);
const repeat = await runGuardedProgramSave({
  mode: 'import',
  review: review([day('Push', [exercise({ sourceName: 'Bench Press', exerciseId: 10, matchStatus: 'matched' })])]),
  catalog,
  gate: saved.gate,
  store: saved.store,
  userId: userA,
  scope: 'import',
  programId: null,
  programsLoaded: true,
  hasCurrentProgram: false,
  storedRaw: null,
  ownedProgramRpcEnabled: true,
  customWritesEnabled: true,
  persistTargets: true,
  createCustom: async () => ({ ok: true, exerciseId: '1' }),
  saveProgram: async () => {
    saved.programCalls += 1;
    return { ok: true, programId: '9' };
  },
  saveTargets: async () => ({ ok: true }),
});
assert.equal(repeat.status, 'skipped');
assert.equal(saved.programCalls, 1);

const parallelGate = createRoutineSaveGate();
let parallelSaves = 0;
const parallelReview = review([day('Push', [exercise({ sourceName: 'Bench Press', exerciseId: 10, matchStatus: 'matched' })])]);
const parallel = await Promise.all([
  runSave({ review: parallelReview, gate: parallelGate, saveProgram: async () => {
    parallelSaves += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { ok: true, programId: '9' };
  } }),
  runSave({ review: parallelReview, gate: parallelGate, saveProgram: async () => {
    parallelSaves += 1;
    return { ok: true, programId: '10' };
  } }),
]);
assert.equal(parallelSaves, 1);
assert.deepEqual(parallel.map((item) => item.result.status).sort(), ['saved', 'skipped']);

const failedCreate = await runSave({
  review: review([day('Push', [exercise({ sourceName: 'Mystery Lift' })])]),
  createCustom: async () => ({ ok: false, error: 'Could not create that exercise.' }),
});
assert.equal(failedCreate.result.status, 'failed');
assert.equal(failedCreate.programCalls, 0);
assert.equal(failedCreate.calls.targets, 0);
assert.equal(failedCreate.result.review.days[0]?.exercises[0]?.exerciseId, null);

const flagOff = await runSave({
  review: review([day('Push', [exercise({ sourceName: 'Mystery Lift' })])]),
  customWritesEnabled: false,
});
assert.equal(flagOff.result.status, 'failed');
assert.equal(flagOff.created.length, 0);
assert.deepEqual(flagOff.result.errors, [CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE]);

const duplicateBeforeCreate = await runSave({
  review: review([
    day('Push', [
      exercise({ sourceName: 'Mystery Lift' }),
      exercise({ sourceName: 'mystery lift' }),
    ]),
  ]),
});
assert.equal(duplicateBeforeCreate.result.status, 'failed');
assert.equal(duplicateBeforeCreate.created.length, 0);
assert.equal(duplicateBeforeCreate.programCalls, 0);

let sharedCreates = 0;
const sharedCustom = await runSave({
  review: review([
    day('Push', [exercise({ sourceName: 'Mystery Lift' })]),
    day('Pull', [exercise({ sourceName: 'Mystery Lift' })]),
  ]),
  createCustom: async (name) => {
    sharedCreates += 1;
    assert.equal(name, 'Mystery Lift');
    return { ok: true, exerciseId: '71' };
  },
});
assert.equal(sharedCustom.result.status, 'saved');
assert.equal(sharedCreates, 1);
assert.equal(sharedCustom.result.review.days[0]?.exercises[0]?.exerciseId, '71');
assert.equal(sharedCustom.result.review.days[1]?.exercises[0]?.exerciseId, '71');
assert.equal(sharedCustom.result.review.days[0]?.exercises[0]?.sourceName, 'Mystery Lift');

const thrown = await runSave({
  review: review([day('Push', [exercise({ sourceName: 'Bench Press', exerciseId: 10, matchStatus: 'matched' })])]),
  saveProgram: async () => {
    throw new Error('offline');
  },
});
assert.equal(thrown.result.status, 'failed');
assert.equal(thrown.calls.targets, 0);
const thrownKey = routineDraftKey(userA, 'import', null);
const thrownRaw = thrown.store.read(thrownKey ?? '');
const thrownDraft = decodeRoutineDraft(thrownRaw ?? '');
assert.ok(thrownDraft?.saveRequestId);
const retry = await runSave({
  review: thrown.result.review,
  store: thrown.store,
  storedRaw: thrownRaw,
  hasCurrentProgram: true,
});
assert.equal(retry.calls.id, thrownDraft?.saveRequestId);
assert.equal(retry.result.status, 'saved');

const partial = await runSave({
  review: review([
    day('Push', [
      exercise({
        sourceName: 'Bench Press',
        exerciseId: 10,
        matchStatus: 'matched',
        equipmentTargets: [{ equipment: 'machine', weight: 80, unit: 'lb' }],
      }),
    ]),
  ]),
  saveTargets: async () => ({ ok: false, error: ONE_TAP_PARTIAL_MESSAGE }),
});
assert.equal(partial.result.status, 'partial');
assert.equal(partial.result.editingLocked, true);
assert.equal(partial.result.programId, '9');
assert.deepEqual(partial.result.errors, [ONE_TAP_PARTIAL_MESSAGE]);
const partialKey = routineDraftKey(userA, 'import', null) ?? '';
const partialRaw = partial.store.read(partialKey) ?? '';
const partialDraft = decodeRoutineDraft(partialRaw);
assert.ok(partialDraft?.saveRequestId);
assert.equal(partialDraft?.saveState, 'editing');
assert.equal(partialDraft?.pendingTargetProgramId, '9');
assert.equal(partialDraft?.pendingEquipmentTargets?.[0]?.dayOrder, 1);
assert.equal(partialDraft?.pendingEquipmentTargets?.[0]?.exerciseOrder, 1);
assert.equal(partialDraft?.pendingEquipmentTargets?.[0]?.targets[0]?.weight, 80);
assert.equal(partialDraft?.pendingTargetSnapshot?.days[0]?.exercises[0]?.equipmentTargets?.[0]?.weight, 80);
assert.equal(partialDraft?.review.days[0]?.exercises[0]?.equipmentTargets?.[0]?.weight, 80);
const partialNotice = resolveRoutineScreenDraft({
  userId: userA,
  scope: 'import',
  programId: null,
  storedRaw: partialRaw,
  serverReview: null,
  firstProgramRetry: true,
});
assert.equal(partialNotice.notice, ROUTINE_DRAFT_PARTIAL_TARGET_MESSAGE);
assert.equal(partialNotice.pendingTargetProgramId, '9');
assert.equal(partialNotice.editingLocked, true);
assert.equal(partialNotice.pendingEquipmentTargets?.[0]?.targets[0]?.equipment, 'machine');
assert.equal(partialNotice.dropStored, false);
let partialProgramWrites = 0;
const failedTargetRetry = await runSave({
  review: partial.result.review,
  store: partial.store,
  storedRaw: partial.store.read(partialKey),
  hasCurrentProgram: true,
  saveProgram: async () => {
    partialProgramWrites += 1;
    return { ok: true, programId: '99' };
  },
  saveTargets: async () => ({ ok: false, error: ONE_TAP_PARTIAL_MESSAGE }),
});
assert.equal(partialProgramWrites, 0);
assert.equal(failedTargetRetry.created.length, 0);
assert.equal(failedTargetRetry.result.status, 'partial');
assert.equal(failedTargetRetry.result.programId, '9');
const keptPartial = decodeRoutineDraft(partial.store.read(partialKey) ?? '');
assert.equal(keptPartial?.pendingTargetProgramId, '9');
assert.equal(keptPartial?.saveRequestId, partialDraft?.saveRequestId);
assert.equal(keptPartial?.review.days[0]?.exercises[0]?.equipmentTargets?.[0]?.equipment, 'machine');
const restartedStore = createMemoryRoutineDraftStore({ [partialKey]: partial.store.read(partialKey) ?? '' });
let restartedTargetWrites = 0;
const restartedRetry = await runSave({
  review: partial.result.review,
  gate: createRoutineSaveGate(),
  store: restartedStore,
  storedRaw: restartedStore.read(partialKey),
  hasCurrentProgram: true,
  saveProgram: async () => {
    partialProgramWrites += 1;
    return { ok: true, programId: '100' };
  },
  saveTargets: async (programId) => {
    restartedTargetWrites += 1;
    assert.equal(programId, '9');
    return { ok: true };
  },
});
assert.equal(partialProgramWrites, 0);
assert.equal(restartedRetry.created.length, 0);
assert.equal(restartedTargetWrites, 1);
assert.equal(restartedRetry.result.status, 'saved');
assert.equal(restartedRetry.result.programId, '9');
assert.equal(restartedStore.read(partialKey), null);

const additional = await runSave({
  review: review([day('Push', [exercise({ sourceName: 'Bench Press', exerciseId: 10, matchStatus: 'matched' })])]),
  scope: 'new',
  hasCurrentProgram: true,
});
assert.equal(additional.calls.id, undefined);
assert.equal(additional.calls.targets, 0);

const editStore = createMemoryRoutineDraftStore();
storeRoutineReview({
  store: editStore,
  userId: userA,
  scope: 'edit',
  programId: '4',
  review: review([day('Push', [exercise({ sourceName: 'Bench Press', exerciseId: 10, matchStatus: 'manual' })])], 'manual'),
  saveState: 'saving',
  saveRequestId: '33333333-3333-4333-8333-333333333333',
});
const edited = await runSave({
  review: review([day('Push', [exercise({ sourceName: 'Bench Press', exerciseId: 10, matchStatus: 'manual' })])], 'manual'),
  mode: 'manual',
  scope: 'edit',
  programId: '4',
  store: editStore,
  storedRaw: editStore.read(routineDraftKey(userA, 'edit', '4') ?? ''),
  hasCurrentProgram: true,
});
assert.equal(edited.calls.id, undefined);

const editPendingStore = createMemoryRoutineDraftStore();
const editPendingReview = review(
  [day('Push', [exercise({
    sourceName: 'Bench Press',
    exerciseId: 10,
    matchStatus: 'manual',
    equipmentTargets: [{ equipment: 'machine', weight: 80, unit: 'lb' }],
  })])],
  'manual',
);
storeRoutineReview({
  store: editPendingStore,
  userId: userA,
  scope: 'edit',
  programId: '4',
  review: editPendingReview,
  saveState: 'editing',
  saveRequestId: '33333333-3333-4333-8333-333333333333',
  pendingTargetProgramId: '4',
  pendingEquipmentTargets: freezeEquipmentTargetRows(editPendingReview.days),
  pendingTargetSnapshot: editPendingReview,
});
let editProgramWrites = 0;
const editRetry = await runSave({
  review: review(
    [day('Pull', [exercise({
      sourceName: 'Other Press',
      exerciseId: 99,
      matchStatus: 'manual',
      equipmentTargets: [{ equipment: 'barbell', weight: 225, unit: 'lb' }],
    })])],
    'manual',
  ),
  mode: 'manual',
  scope: 'edit',
  programId: '4',
  store: editPendingStore,
  storedRaw: editPendingStore.read(routineDraftKey(userA, 'edit', '4') ?? ''),
  hasCurrentProgram: true,
  saveProgram: async () => {
    editProgramWrites += 1;
    return { ok: true, programId: '8' };
  },
  saveTargets: async (programId, _next, savedRows) => {
    assert.equal(programId, '4');
    assert.equal(savedRows?.[0]?.dayOrder, 1);
    assert.equal(savedRows?.[0]?.exerciseOrder, 1);
    assert.equal(savedRows?.[0]?.targets[0]?.equipment, 'machine');
    assert.equal(savedRows?.[0]?.targets[0]?.weight, 80);
    return { ok: true };
  },
});
assert.equal(editProgramWrites, 0);
assert.equal(editRetry.created.length, 0);
assert.equal(editRetry.result.status, 'saved');
assert.equal(editRetry.result.programId, '4');
assert.equal(editRetry.result.review.days[0]?.name, 'Push');
assert.equal(editRetry.result.review.days[0]?.exercises[0]?.equipmentTargets?.[0]?.weight, 80);

const flagOffTargets = await runSave({
  review: review([
    day('Push', [
      exercise({
        sourceName: 'Bench Press',
        exerciseId: 10,
        matchStatus: 'matched',
        equipmentTargets: [{ equipment: 'barbell', weight: 155, unit: 'lb' }],
      }),
    ]),
  ]),
  persistTargets: false,
  ownedProgramRpcEnabled: false,
});
assert.equal(flagOffTargets.result.status, 'saved');
assert.equal(flagOffTargets.calls.targets, 0);
assert.equal(flagOffTargets.calls.id, undefined);
assert.equal(flagOffTargets.created.length, 0);

const isolated = createMemoryRoutineDraftStore();
storeRoutineReview({
  store: isolated,
  userId: userA,
  scope: 'import',
  programId: null,
  review: review([day('Push', [exercise()])]),
  saveState: 'editing',
});
const isolatedRaw = isolated.read(routineDraftKey(userA, 'import', null) ?? '');
const hidden = resolveRoutineScreenDraft({
  userId: userB,
  scope: 'import',
  programId: null,
  storedRaw: isolatedRaw,
  serverReview: null,
  firstProgramRetry: true,
});
assert.equal(hidden.review.programName, '');
const visible = resolveRoutineScreenDraft({
  userId: userA,
  scope: 'import',
  programId: null,
  storedRaw: isolatedRaw,
  serverReview: null,
});
assert.equal(visible.review.programName, 'Imported Week');
assert.equal(visible.review.days[0]?.exercises[0]?.notes, 'Pause');
const encoded = encodeRoutineDraft({
  version: 1,
  userId: userA,
  scope: 'import',
  programId: null,
  review: review([
    day('Push', [
      exercise({ equipmentTargets: [{ equipment: 'machine', weight: 80, unit: 'lb' }] }),
    ]),
  ]),
  updatedAt: '2026-11-05T12:00:00.000Z',
  saveState: 'editing',
  confirmedProgramId: null,
  saveRequestId: null,
  pendingTargetProgramId: null,
  pendingEquipmentTargets: null,
  pendingTargetSnapshot: null,
});
assert.ok(encoded);
const damaged = JSON.parse(encoded ?? '{}') as {
  review: { days: { exercises: { equipmentTargets?: { equipment: string }[]; sourceName?: string }[] }[] };
};
const damagedExercise = damaged.review.days[0]?.exercises[0];
assert.ok(damagedExercise);
damagedExercise.equipmentTargets = [{ equipment: 'spoon' }];
const recovered = decodeRoutineDraft(JSON.stringify(damaged));
assert.equal(recovered?.review.days[0]?.exercises[0]?.sourceName, 'Bench Press');
assert.equal(recovered?.review.days[0]?.exercises[0]?.equipmentTargets, undefined);
const oldPayload = JSON.parse(encoded ?? '{}') as Record<string, unknown>;
delete oldPayload.pendingTargetProgramId;
delete oldPayload.pendingEquipmentTargets;
delete oldPayload.pendingTargetSnapshot;
const oldDraft = decodeRoutineDraft(JSON.stringify(oldPayload));
assert.equal(oldDraft?.pendingTargetProgramId, null);
assert.equal(oldDraft?.pendingEquipmentTargets, null);
assert.equal(oldDraft?.pendingTargetSnapshot, null);
assert.equal(oldDraft?.saveState, 'editing');
assert.equal(decodeRoutineDraft(JSON.stringify({ ...oldPayload, pendingTargetProgramId: 'pending' })), null);

const machineTarget = [{ equipment: 'machine' as const, weight: 80, unit: 'lb' as const }];
const dumbbellTarget = [{ equipment: 'dumbbell' as const, weight: 40, unit: 'lb' as const }];
const cableTarget = [{ equipment: 'cable' as const, weight: 50, unit: 'lb' as const }];
const originalTargets = review([
  day('Push', [
    exercise({
      sourceName: 'Bench Press',
      exerciseId: 10,
      matchStatus: 'matched',
      equipmentTargets: machineTarget,
    }),
    exercise({
      sourceName: 'Bench Press',
      exerciseId: 11,
      matchStatus: 'matched',
      equipmentTargets: dumbbellTarget,
    }),
  ]),
  day('Pull', [
    exercise({
      sourceName: 'Bench Press',
      exerciseId: 12,
      matchStatus: 'matched',
      equipmentTargets: cableTarget,
    }),
  ]),
]);
const reorderedTargets = review([
  day('Pull', [
    exercise({
      sourceName: 'Bench Press',
      exerciseId: 12,
      matchStatus: 'matched',
      equipmentTargets: cableTarget,
    }),
  ]),
  day('Push', [
    exercise({
      sourceName: 'Bench Press',
      exerciseId: 11,
      matchStatus: 'matched',
      equipmentTargets: dumbbellTarget,
    }),
    exercise({
      sourceName: 'Bench Press',
      exerciseId: 10,
      matchStatus: 'matched',
      equipmentTargets: machineTarget,
    }),
  ]),
]);
const locatedRows = [
  { dayOrder: 1, exerciseOrder: 1, programExerciseId: '501' },
  { dayOrder: 1, exerciseOrder: 2, programExerciseId: '502' },
  { dayOrder: 2, exerciseOrder: 1, programExerciseId: '503' },
];
let locateCalls = 0;
let reorderProgramWrites = 0;
const reorderAttempts: SavedEquipmentTargetRow[][] = [];
const reorderedSave = await runSave({
  review: originalTargets,
  mode: 'manual',
  locateSavedRows: async (programId) => {
    locateCalls += 1;
    assert.equal(programId, '9');
    return locatedRows;
  },
  saveProgram: async () => {
    reorderProgramWrites += 1;
    return { ok: true, programId: '9' };
  },
  saveTargets: async (_programId, _next, savedRows) => {
    reorderAttempts.push(savedRows ? [...savedRows] : []);
    return { ok: false, error: ONE_TAP_PARTIAL_MESSAGE };
  },
});
assert.equal(reorderedSave.result.status, 'partial');
assert.equal(reorderedSave.result.programId, '9');
assert.equal(reorderedSave.result.editingLocked, true);
assert.equal(locateCalls, 1);
assert.equal(reorderProgramWrites, 1);
assert.equal(reorderedSave.created.length, 0);
const frozenAttempt = reorderAttempts[0] ?? [];
assert.deepEqual(
  frozenAttempt.map((row) => [row.programExerciseId, row.dayOrder, row.exerciseOrder, row.targets[0]?.weight]),
  [
    ['501', 1, 1, 80],
    ['502', 1, 2, 40],
    ['503', 2, 1, 50],
  ],
);
const frozenWire = equipmentTargetRowsFromSaved(frozenAttempt);
const liveWire = equipmentTargetRowsFromReview(reorderedTargets);
assert.ok(frozenWire);
assert.equal(frozenWire?.[0]?.program_exercise_id, 501);
assert.equal(frozenWire?.[0]?.day_order, undefined);
assert.equal(frozenWire?.[0]?.exercise_order, undefined);
assert.notDeepEqual(
  liveWire.map((row) => [row.day_order, row.exercise_order, row.targets[0]?.weight]),
  [
    [1, 1, 80],
    [1, 2, 40],
    [2, 1, 50],
  ],
);
const reorderKey = routineDraftKey(userA, 'import', null) ?? '';
const reorderRequestId = decodeRoutineDraft(reorderedSave.store.read(reorderKey) ?? '')?.saveRequestId;
assert.ok(reorderRequestId);
for (const attempt of [2, 3]) {
  const failedAgain = await runSave({
    review: reorderedTargets,
    gate: createRoutineSaveGate(),
    store: reorderedSave.store,
    storedRaw: reorderedSave.store.read(reorderKey),
    hasCurrentProgram: true,
    locateSavedRows: async () => {
      locateCalls += 1;
      return locatedRows;
    },
    saveProgram: async () => {
      reorderProgramWrites += 1;
      return { ok: true, programId: '99' };
    },
    saveTargets: async (programId, next, savedRows) => {
      reorderAttempts.push(savedRows ? [...savedRows] : []);
      assert.equal(programId, '9');
      assert.equal(next.days[0]?.name, 'Push');
      assert.equal(next.days[0]?.exercises[0]?.equipmentTargets?.[0]?.weight, 80);
      assert.deepEqual(savedRows, frozenAttempt);
      return { ok: false, error: ONE_TAP_PARTIAL_MESSAGE };
    },
  });
  assert.equal(failedAgain.result.status, 'partial', `retry ${attempt}`);
  assert.equal(failedAgain.result.programId, '9');
  assert.equal(failedAgain.result.editingLocked, true);
  assert.equal(failedAgain.created.length, 0);
  const kept = decodeRoutineDraft(reorderedSave.store.read(reorderKey) ?? '');
  assert.equal(kept?.saveRequestId, reorderRequestId);
  assert.equal(kept?.pendingTargetProgramId, '9');
  assert.deepEqual(kept?.pendingEquipmentTargets, frozenAttempt);
}
assert.equal(locateCalls, 1);
assert.equal(reorderProgramWrites, 1);
const restartedReorderStore = createMemoryRoutineDraftStore({
  [reorderKey]: reorderedSave.store.read(reorderKey) ?? '',
});
const restartedReorder = await runSave({
  review: reorderedTargets,
  gate: createRoutineSaveGate(),
  store: restartedReorderStore,
  storedRaw: restartedReorderStore.read(reorderKey),
  hasCurrentProgram: true,
  saveProgram: async () => {
    reorderProgramWrites += 1;
    return { ok: true, programId: '100' };
  },
  saveTargets: async (programId, _next, savedRows) => {
    assert.equal(programId, '9');
    assert.deepEqual(savedRows, frozenAttempt);
    return { ok: true };
  },
});
assert.equal(restartedReorder.created.length, 0);
assert.equal(restartedReorder.result.status, 'saved');
assert.equal(restartedReorder.result.programId, '9');
assert.equal(restartedReorder.result.editingLocked, false);
assert.equal(restartedReorderStore.read(reorderKey), null);
assert.equal(reorderProgramWrites, 1);
assert.equal(locateCalls, 1);

const orderOnly = savedRowsWithExerciseIds(freezeEquipmentTargetRows(originalTargets.days), [
  { dayOrder: 1, exerciseOrder: 1, programExerciseId: '501' },
]);
assert.equal(orderOnly.every((row) => row.programExerciseId == null), true);
const orderWire = equipmentTargetRowsFromSaved(orderOnly);
assert.equal(orderWire?.[0]?.day_order, 1);
assert.equal(orderWire?.[0]?.exercise_order, 1);
assert.equal(orderWire?.[0]?.program_exercise_id, undefined);
assert.equal(
  savedRowsWithExerciseIds(freezeEquipmentTargetRows(originalTargets.days), [
    { dayOrder: 1, exerciseOrder: 1, programExerciseId: '501' },
    { dayOrder: 1, exerciseOrder: 2, programExerciseId: '501' },
    { dayOrder: 2, exerciseOrder: 1, programExerciseId: '503' },
  ]).every((row) => row.programExerciseId == null),
  true,
);

const missingStore = createMemoryRoutineDraftStore();
storeRoutineReview({
  store: missingStore,
  userId: userA,
  scope: 'import',
  programId: null,
  review: originalTargets,
  saveState: 'editing',
  saveRequestId: reorderRequestId,
  pendingTargetProgramId: '9',
});
let missingTargetWrites = 0;
let missingProgramWrites = 0;
const missingKey = routineDraftKey(userA, 'import', null) ?? '';
const missingRetry = await runSave({
  review: reorderedTargets,
  store: missingStore,
  storedRaw: missingStore.read(missingKey),
  hasCurrentProgram: true,
  saveProgram: async () => {
    missingProgramWrites += 1;
    return { ok: true, programId: '77' };
  },
  saveTargets: async () => {
    missingTargetWrites += 1;
    return { ok: true };
  },
});
assert.equal(missingProgramWrites, 0);
assert.equal(missingTargetWrites, 0);
assert.equal(missingRetry.created.length, 0);
assert.equal(missingRetry.result.status, 'partial');
assert.equal(missingRetry.result.programId, '9');
assert.equal(missingRetry.result.editingLocked, true);
assert.deepEqual(missingRetry.result.errors, [ONE_TAP_TARGET_MAPPING_MESSAGE]);
assert.equal(missingRetry.result.review.days[0]?.name, 'Push');
assert.equal(missingRetry.result.review.days[0]?.exercises[0]?.equipmentTargets?.[0]?.weight, 80);
const missingKept = decodeRoutineDraft(missingStore.read(missingKey) ?? '');
assert.equal(missingKept?.pendingTargetProgramId, '9');
assert.equal(missingKept?.saveRequestId, reorderRequestId);
assert.equal(missingKept?.pendingEquipmentTargets, null);
const damagedMapping = JSON.parse(missingStore.read(missingKey) ?? '{}') as Record<string, unknown>;
damagedMapping.pendingEquipmentTargets = [
  { dayOrder: 1, exerciseOrder: 1, programExerciseId: '501', targets: machineTarget },
  { dayOrder: 1, exerciseOrder: 2, programExerciseId: null, targets: dumbbellTarget },
];
const damagedMappingDraft = decodeRoutineDraft(JSON.stringify(damagedMapping));
assert.equal(damagedMappingDraft?.pendingTargetProgramId, '9');
assert.equal(damagedMappingDraft?.pendingEquipmentTargets, null);

let refusedRpc = 0;
const refused = await saveEquipmentTargetsForSavedRows('9', [], {
  rpc: async () => {
    refusedRpc += 1;
    return { data: { ok: true }, error: null };
  },
});
assert.equal(refused.ok, false);
assert.equal(refusedRpc, 0);
const mixedRows: SavedEquipmentTargetRow[] = [
  { dayOrder: 1, exerciseOrder: 1, programExerciseId: '501', targets: [{ equipment: 'machine', weight: 80, unit: 'lb' }] },
  { dayOrder: 1, exerciseOrder: 2, programExerciseId: null, targets: [{ equipment: 'dumbbell', weight: 40, unit: 'lb' }] },
];
const mixedWrite = await saveEquipmentTargetsForSavedRows('9', mixedRows, {
  rpc: async () => {
    refusedRpc += 1;
    return { data: { ok: true }, error: null };
  },
});
assert.equal(mixedWrite.ok, false);
assert.equal(refusedRpc, 0);
assert.equal(await locateOwnedProgramExerciseIds('0'), null);
assert.equal(await locateOwnedProgramExerciseIds('nope'), null);

const friendSource = await readFile(new URL('./fixtures/workout-import/friend-push-pull.txt', import.meta.url), 'utf8');
const friendCatalog = [
  { id: 10, name: 'Bench Press' },
  { id: 12, name: 'Romanian Deadlift' },
  { id: 13, name: 'Pull Up' },
  { id: 14, name: 'Lat Pulldown' },
  { id: 15, name: 'Calf Raise' },
  { id: 16, name: 'Hammer Curl' },
];
function friendMove(
  name: string,
  sets: number | null,
  reps: number | null,
  weight: number | null = null,
  notes: string | null = null,
): ReviewExercise {
  assert.equal(friendSource.includes(name), true, name);
  return exercise({
    sourceName: name,
    notes,
    sets: field(sets),
    repsMin: field(reps),
    repsMax: field(reps),
    ...(weight == null ? {} : { weight: { acceptance: 'extracted' as const, value: weight, suggestion: null } }),
  });
}
const friendReview = review([
  day('Push', [
    friendMove('Bench Press', 3, 6, 155, '155 (80 machine)'),
    friendMove('Incline bench', 3, 6, 50, '50 (70 machine)'),
    friendMove('Carter extension', 3, 8),
    friendMove('Shoulder Press', 3, 8, 35),
    friendMove('Pec Fly', 3, 8, 110),
    friendMove('Lateral/Front/L Raises', 3, 8, 15),
    friendMove('Skull Crusher', 3, 8, 60),
    friendMove('Reverse wrist curl', 3, 8),
  ]),
  day('Pull', [
    friendMove('Lat Pullover', 3, 8),
    friendMove('Pull up', 3, 9),
    friendMove('T bar row', 3, 6, 90),
    friendMove('Single Arm Row', 3, 8, 55),
    friendMove('Lat Pulldown', 3, 8, 120),
    friendMove('Preacher Barbell Curl', 3, 8, 35, '35 (60 bar)'),
    friendMove('Hammer Curl', 3, 8, 35),
    friendMove('Single Arm Cable Curl', 3, 8),
    friendMove('Wrist Curl', 3, 8, 15),
  ]),
  day('Abs', [
    friendMove('Single leg', null, 5),
    friendMove('Straight leg', null, 12),
    friendMove('Around world', null, 8),
    friendMove('Side crunch', null, 4),
    friendMove('Crunch and hold', null, 4),
  ]),
  day('Legs', [
    friendMove('Barbell Back Squats', null, null),
    friendMove('Hack Squats/Leg Press', null, null),
    friendMove('RDL', null, null),
    friendMove('Quad Extension', null, null),
    friendMove('Hamstring Curl', null, null),
    friendMove('Calf Raises', null, null),
  ]),
  day('Rest', []),
  day('Upper body', []),
  day('Legs Arms', []),
]);
assert.equal(friendReview.days.reduce((total, item) => total + item.exercises.length, 0), 28);
assert.equal(friendSource.includes('Push - Pull - Legs - Rest - Upper body - Legs Arms - Rest'), true);

const oldCreated: string[] = [];
const oldPrepared = prepareRoutineForSave(friendReview, friendCatalog, 'import');
assert.equal(oldPrepared.errors.length, 0);
const oldMaterialized = await materializeCustomExercises(oldPrepared.review, {
  enabled: true,
  create: async (name) => {
    oldCreated.push(name);
    return { ok: true, exerciseId: String(100 + oldCreated.length) };
  },
});
assert.equal(oldMaterialized.ok, true);
let oldImportedCalls = 0;
let oldOwnedCalls = 0;
if (oldMaterialized.ok) {
  const oldSave = await saveManualProgram(oldMaterialized.review, {
    userId: userA,
    programs: [{ id: '1', name: 'Current split', isActive: true }],
    subtitleRequired: true,
    persistPlannedWeight: true,
    rpc: async () => {
      oldImportedCalls += 1;
      return { data: 3, error: null };
    },
    ownedRpc: async () => {
      oldOwnedCalls += 1;
      return { data: 3, error: null };
    },
  });
  assert.equal(oldSave.ok, false);
  if (!oldSave.ok) {
    assert.equal(oldSave.errors.includes(MANUAL_SETS_SAVE_MESSAGE), true);
    assert.equal(oldSave.errors.includes(IMPORT_BLANK_SUBTITLE_MESSAGE), true);
  }
}
assert.ok(oldCreated.length > 0);
assert.equal(oldCreated.includes('Bench Press'), false);
assert.equal(oldCreated.includes('Carter extension'), true);
assert.equal(oldImportedCalls, 0);
assert.equal(oldOwnedCalls, 0);

const blockedFriend = await runSave({
  review: friendReview,
  catalog: friendCatalog,
  hasCurrentProgram: true,
  sourceText: friendSource,
  createCustom: async (name) => {
    return { ok: true, exerciseId: String(400 + name.length) };
  },
});
assert.equal(blockedFriend.result.status, 'saved');
assert.equal(blockedFriend.result.programId, '9');
assert.equal(blockedFriend.programCalls, 1);
assert.equal(blockedFriend.created.includes('Carter extension'), true);
assert.equal(blockedFriend.created.includes('Bench Press'), false);
assert.equal(blockedFriend.created.includes('Barbell Back Squats'), true);
assert.equal(
  blockedFriend.result.errors.some((error) => error.includes('no sets or reps')),
  false,
);
assert.notEqual(
  blockedFriend.result.errors[0],
  missingPrescriptionMessage([
    'Single leg',
    'Straight leg',
    'Around world',
    'Side crunch',
    'Crunch and hold',
    'Barbell Back Squats',
    'Hack Squats/Leg Press',
    'RDL',
    'Quad Extension',
    'Hamstring Curl',
    'Calf Raises',
  ]),
);
const blockedBench = blockedFriend.result.review.days[0]?.exercises[0];
assert.equal(blockedBench?.sourceName, 'Bench Press');
assert.equal(String(blockedBench?.exerciseId), '10');
assert.equal(blockedBench?.equipmentTargets?.[0]?.equipment, 'barbell');
assert.equal(blockedBench?.equipmentTargets?.[0]?.weight, 155);
assert.equal(blockedBench?.equipmentTargets?.[1]?.equipment, 'machine');
assert.equal(blockedBench?.equipmentTargets?.[1]?.weight, 80);
assert.equal(blockedFriend.result.review.days[0]?.exercises[2]?.sourceName, 'Carter extension');
assert.equal(
  blockedFriend.result.review.days[0]?.exercises[2]?.exerciseId,
  String(400 + 'Carter extension'.length),
);
const blockedKey = routineDraftKey(userA, 'import', null) ?? '';
assert.equal(blockedFriend.store.read(blockedKey), null);

const noRoutineFriend = await runSave({
  review: friendReview,
  catalog: friendCatalog,
  hasCurrentProgram: false,
  sourceText: friendSource,
  createCustom: async (name) => {
    return { ok: true, exerciseId: String(500 + name.length) };
  },
});
assert.equal(noRoutineFriend.result.status, 'saved');
assert.equal(noRoutineFriend.created.includes('Single leg'), true);
assert.equal(noRoutineFriend.programCalls, 1);
assert.ok(noRoutineFriend.calls.id);

const completeFriend = review(friendReview.days.slice(0, 2));
const requestIds: Array<string | undefined> = [];
const createdNames: string[] = [];
let nextCustomId = 200;
const savedFriend = await runSave({
  review: completeFriend,
  catalog: friendCatalog,
  hasCurrentProgram: true,
  sourceText: friendSource,
  createCustom: async (name) => {
    createdNames.push(name);
    nextCustomId += 1;
    return { ok: true, exerciseId: String(nextCustomId) };
  },
  saveProgram: async (_next, clientRequestId) => {
    requestIds.push(clientRequestId);
    return { ok: false, errors: ['The save service rejected a field on this routine. Nothing was saved.'] };
  },
});
assert.equal(savedFriend.result.status, 'failed');
const failedFriendDraft = decodeRoutineDraft(savedFriend.store.read(blockedKey) ?? '');
assert.equal(failedFriendDraft?.sourceText, friendSource);
assert.ok(failedFriendDraft?.saveRequestId);
assert.equal(createdNames.includes('Bench Press'), false);
assert.equal(createdNames.includes('Carter extension'), true);
assert.equal(createdNames.includes('RDL'), false);
assert.equal(createdNames.includes('Pull up'), false);
assert.ok(requestIds[0]);
const friendRetry = await runSave({
  review: savedFriend.result.review,
  catalog: friendCatalog,
  store: savedFriend.store,
  storedRaw: savedFriend.store.read(blockedKey),
  hasCurrentProgram: true,
  sourceText: friendSource,
  saveProgram: async (_next, clientRequestId) => {
    requestIds.push(clientRequestId);
    return { ok: true, programId: '9' };
  },
});
assert.equal(friendRetry.result.status, 'saved');
assert.equal(friendRetry.created.length, 0);
assert.equal(requestIds[1], requestIds[0]);
assert.equal(friendRetry.result.programId, '9');

const taken = await createCustomExercise('Carter extension', {
  rpc: async () => ({ data: null, error: { message: 'exercise_name_taken' } }),
  findOwned: async (name) => (name === 'Carter extension' ? '77' : null),
});
assert.deepEqual(taken, { ok: true, exerciseId: '77', name: 'Carter extension' });
const catalogName = await createCustomExercise('Bench Press', {
  rpc: async () => ({ data: null, error: { message: 'exercise_name_taken' } }),
  findOwned: async () => null,
});
assert.deepEqual(catalogName, { ok: false, error: CUSTOM_EXERCISE_TAKEN_MESSAGE });

const currentImport = await runSave({
  review: review([day('Push', [exercise({ sourceName: 'Bench Press', exerciseId: 10, matchStatus: 'matched' })])]),
  hasCurrentProgram: true,
});
assert.ok(currentImport.calls.id);

console.log('one-tap pure checks passed');

const host = '127.0.0.1';
const port = 55458;
const database = 'syncsetrep_equipment_targets';
if (
  host !== '127.0.0.1' ||
  port === 5432 ||
  port === 6543 ||
  port === 55450 ||
  port === 55453 ||
  port === 55454 ||
  port === 55455 ||
  port === 55456 ||
  port === 55457
) {
  throw new Error('refusing non-disposable database');
}

const root = fileURLToPath(new URL('..', import.meta.url));
const workoutScreen = await readFile(join(root, 'app/workout/[sessionId].tsx'), 'utf8');
const switchBody = workoutScreen.slice(
  workoutScreen.indexOf('async function selectTodayEquipment'),
  workoutScreen.indexOf('function trySuggestedWeight'),
);
assert.ok(switchBody.includes('resolveEquipmentExercise'));
assert.ok(switchBody.indexOf('resolveEquipmentExercise') < switchBody.indexOf('createCustomExercise'));
assert.equal(switchBody.includes("scope: 'session'"), true);
assert.equal(switchBody.includes('keepCompletedSets'), true);
assert.equal(switchBody.includes("scope: 'program'"), false);
const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');
const forwardSql = await readFile(join(root, 'sql/program-equipment-targets.sql'), 'utf8');
const rollbackSql = await readFile(join(root, 'sql/program-equipment-targets-rollback.sql'), 'utf8');
assert.equal(forwardSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(rollbackSql.startsWith('-- NOT APPLIED.'), true);
assert.equal(forwardSql.includes('workout_sessions'), false);
assert.equal(forwardSql.includes('workout_sets'), false);
assert.match(forwardSql, /equipment_targets_already_present/);
assert.match(forwardSql, /GRANT EXECUTE ON FUNCTION public\.save_equipment_targets\(jsonb\) TO authenticated;/);
assert.equal(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.(save_owned_program|record_tracked_set|save_imported_program)/i.test(forwardSql), false);

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

const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-equipment-targets-pg-'));
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
    'sql/program-exercise-planned-weight.sql',
    'sql/program-first-save-idempotency.sql',
  ]) {
    const applied = await psql(await readFile(join(root, name), 'utf8'));
    assert.equal(applied.code, 0, `${name}\n${applied.stderr}`);
  }

  await must(`
    INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}');
    INSERT INTO public.exercises (name) VALUES ('Bench'), ('Row'), ('Squat'), ('Press');
    INSERT INTO public.exercises (name, owner_user_id) VALUES ('Private Press', '${userB}');
    INSERT INTO public.programs (user_id, name, slug, is_active)
    VALUES ('${userA}', 'Home', NULL, true);
    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (1, 'Push', NULL, 1);
    INSERT INTO public.program_exercises (
      program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps, notes, rest_seconds
    ) VALUES
      (1, 1, 1, 3, 8, 12, 'Old', 90),
      (1, 2, 2, 3, 8, 12, 'Row note', 60);
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

  async function functionIds() {
    return must(`
      SELECT p.proname || ':' || md5(pg_get_functiondef(p.oid))
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN (
          'save_owned_program',
          'record_tracked_set',
          'create_custom_exercise',
          'save_imported_program',
          'update_owned_program',
          'save_manual_program'
        )
      ORDER BY 1;
    `, 'function ids');
  }

  const historyBefore = await historyText();
  const sessionsBefore = await fingerprint('workout_sessions');
  const setsBefore = await fingerprint('workout_sets');
  const functionsBefore = await functionIds();
  assert.equal(historyBefore, '2:1:135.5:5:2026-11-01 13:00:00+00:true');
  const installed = await must(forwardSql, 'install equipment targets');
  assert.match(installed, /equipment_targets_installed/);
  assert.equal(await historyText(), historyBefore);
  assert.equal(await fingerprint('workout_sessions'), sessionsBefore);
  assert.equal(await fingerprint('workout_sets'), setsBefore);
  assert.equal(await functionIds(), functionsBefore);
  assert.equal(await must(`
    SELECT a.attnotnull::text || ':' || (ad.adbin IS NULL)::text
    FROM pg_attribute a
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE a.attrelid = 'public.program_exercises'::regclass
      AND a.attname = 'equipment_targets'
      AND NOT a.attisdropped;
  `, 'column shape'), 'false:true');
  assert.equal(await must(`
    SELECT has_function_privilege('authenticated', 'public.save_equipment_targets(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('anon', 'public.save_equipment_targets(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('public', 'public.save_equipment_targets(jsonb)', 'EXECUTE')::text
      || ':' || has_function_privilege('service_role', 'public.save_equipment_targets(jsonb)', 'EXECUTE')::text;
  `, 'privileges'), 'true:false:false:false');
  for (const name of [
    'public.equipment_targets_json_valid(jsonb)',
    'public.enforce_equipment_target_owners()',
  ]) {
    assert.equal(await must(`
      SELECT has_function_privilege('authenticated', '${name}', 'EXECUTE')::text
        || ':' || has_function_privilege('anon', '${name}', 'EXECUTE')::text
        || ':' || has_function_privilege('public', '${name}', 'EXECUTE')::text
        || ':' || has_function_privilege('service_role', '${name}', 'EXECUTE')::text;
    `, `${name} privileges`), 'true:false:false:false');
    assert.equal(await must(`
      SELECT strpos(pg_get_functiondef('${name}'::regprocedure), 'workout_sessions')::text
        || ':' || strpos(pg_get_functiondef('${name}'::regprocedure), 'workout_sets')::text;
    `, `${name} history names`), '0:0');
  }
  assert.equal(await must(`
    SELECT strpos(pg_get_functiondef('public.save_equipment_targets(jsonb)'::regprocedure), 'workout_sessions')::text
      || ':' || strpos(pg_get_functiondef('public.save_equipment_targets(jsonb)'::regprocedure), 'workout_sets')::text;
  `, 'history names'), '0:0');

  const located = (await must(`
    SELECT p.id::text || ':' || pd.day_order::text || ':' || pe.exercise_order::text || ':' || pe.id::text
    FROM public.program_exercises pe
    JOIN public.program_days pd ON pd.id = pe.program_day_id
    JOIN public.programs p ON p.id = pd.program_id
    ORDER BY pe.exercise_order;
  `, 'locations')).split('\n');
  const firstLocation = located[0]?.split(':') ?? [];
  const secondLocation = located[1]?.split(':') ?? [];
  const programId = Number(firstLocation[0]);
  const dayOrder = Number(firstLocation[1]);
  const exerciseOrder = Number(firstLocation[2]);
  const firstId = Number(firstLocation[3]);
  const secondId = Number(secondLocation[3]);
  assert.equal(Number.isInteger(firstId) && firstId > 0, true);
  assert.equal(Number.isInteger(secondId) && secondId > 0, true);
  const privateId = Number(await must(`
    SELECT id::text FROM public.exercises WHERE name = 'Private Press';
  `, 'private exercise'));
  const benchId = Number(await must(`
    SELECT id::text FROM public.exercises WHERE name = 'Bench' AND owner_user_id IS NULL;
  `, 'bench id'));

  await expectError(
    asUser(userB, `SELECT public.save_equipment_targets(${payload({
      rows: [{ program_exercise_id: firstId, targets: [{ equipment: 'machine', weight: 80, unit: 'lb' }] }],
    })});`),
    /equipment_target_not_owned/,
    'cross user',
  );
  assert.equal(await must(`SELECT count(*)::text FROM public.program_exercises WHERE equipment_targets IS NOT NULL;`, 'unchanged'), '0');

  const stored = await must(asUser(userA, `
    SELECT public.save_equipment_targets(${payload({
      program_id: programId,
      rows: [{
        day_order: dayOrder,
        exercise_order: exerciseOrder,
        targets: [
          { equipment: 'barbell', weight: 155, unit: 'lb' },
          { equipment: 'machine', weight: 80, unit: 'lb', variation_exercise_id: benchId },
        ],
      }],
    })});
  `), 'save targets');
  assert.match(stored, /"ok": true/);
  const storedJson = JSON.parse(await must(`
    SELECT equipment_targets::text FROM public.program_exercises WHERE id = ${firstId};
  `, 'read targets')) as unknown[];
  assert.equal(Array.isArray(storedJson), true);
  assert.equal(storedJson.length, 2);
  assert.equal(Array.isArray(storedJson[0]), false);
  assert.deepEqual(storedJson[0], { equipment: 'barbell', weight: 155, unit: 'lb' });
  assert.deepEqual(storedJson[1], { equipment: 'machine', weight: 80, unit: 'lb', variation_exercise_id: benchId });
  assert.equal(await must(`
    SELECT coalesce(planned_weight::text, 'null') || ':' || notes
    FROM public.program_exercises WHERE id = ${firstId};
  `, 'primary row unchanged'), 'null:Old');

  await expectError(
    asUser(userA, `SELECT public.save_equipment_targets(${payload({
      rows: [{ program_exercise_id: firstId, targets: [{ equipment: 'machine', weight: 80, unit: 'lb', variation_exercise_id: privateId }] }],
    })});`),
    /invalid_import: equipment_targets/,
    'other owner variation',
  );
  assert.equal((JSON.parse(await must(`
    SELECT equipment_targets::text FROM public.program_exercises WHERE id = ${firstId};
  `, 'targets after rejected variation')) as unknown[]).length, 2);

  const cleared = await must(asUser(userA, `
    SELECT public.save_equipment_targets(${payload({
      rows: [{ program_exercise_id: secondId, targets: [] }],
    })});
  `), 'empty targets');
  assert.match(cleared, /"updated": 1/);
  assert.equal(await must(`
    SELECT equipment_targets IS NULL FROM public.program_exercises WHERE id = ${secondId};
  `, 'empty is null'), 't');
  await expectError(
    `UPDATE public.program_exercises SET equipment_targets = '[{},{},{},{},{},{}]'::jsonb WHERE id = ${secondId};`,
    /program_exercises_equipment_targets_check/,
    'six targets',
  );
  for (const [label, value] of [
    ['kettlebell', '[{"equipment":"kettlebell","weight":10}]'],
    ['string weight', '[{"equipment":"machine","weight":"80","unit":"lb"}]'],
    ['weight 2001', '[{"equipment":"machine","weight":2001,"unit":"lb"}]'],
    ['negative weight', '[{"equipment":"machine","weight":-1,"unit":"lb"}]'],
    ['duplicate equipment', '[{"equipment":"machine","weight":80,"unit":"lb"},{"equipment":"machine","weight":90,"unit":"lb"}]'],
    ['extra key', '[{"equipment":"machine","weight":80,"unit":"lb","note":"secret"}]'],
    ['empty array', '[]'],
    ['object value', '{"equipment":"machine","weight":80,"unit":"lb"}'],
    ['unit without weight', '[{"equipment":"machine","unit":"lb"}]'],
    ['boolean weight', '[{"equipment":"machine","weight":true,"unit":"lb"}]'],
  ] as const) {
    await expectError(
      `UPDATE public.program_exercises SET equipment_targets = '${value}'::jsonb WHERE id = ${secondId};`,
      /program_exercises_equipment_targets_check/,
      label,
    );
  }
  await must(`UPDATE public.program_exercises SET equipment_targets = NULL WHERE id = ${secondId};`, 'null stays valid');
  assert.equal(await must(`
    SELECT equipment_targets IS NULL FROM public.program_exercises WHERE id = ${secondId};
  `, 'null after direct clear'), 't');
  await must(`
    UPDATE public.program_exercises
    SET equipment_targets = '[{"equipment":"cable","weight":40,"unit":"lb"}]'::jsonb
    WHERE id = ${secondId};
  `, 'valid direct write');
  assert.equal(await must(`
    SELECT (equipment_targets->0->>'equipment') || ':' || (equipment_targets->0->>'weight')
    FROM public.program_exercises WHERE id = ${secondId};
  `, 'read valid direct write'), 'cable:40');
  await must(asUser(userA, `
    UPDATE public.program_exercises
    SET equipment_targets = '[{"equipment":"dumbbell","weight":30,"unit":"lb"}]'::jsonb
    WHERE id = ${secondId};
  `), 'authenticated own valid write');
  assert.equal(await must(`
    SELECT equipment_targets->0->>'equipment' FROM public.program_exercises WHERE id = ${secondId};
  `, 'authenticated write stored'), 'dumbbell');
  await expectError(asUser(userA, `
    UPDATE public.program_exercises
    SET equipment_targets = '[{"equipment":"kettlebell","weight":10}]'::jsonb
    WHERE id = ${secondId};
  `), /program_exercises_equipment_targets_check/, 'authenticated kettlebell');
  assert.equal(await must(`
    SELECT equipment_targets->0->>'equipment' FROM public.program_exercises WHERE id = ${secondId};
  `, 'authenticated kettlebell unchanged'), 'dumbbell');
  await must(asUser(userB, `
    UPDATE public.program_exercises
    SET equipment_targets = '[{"equipment":"barbell","weight":5,"unit":"lb"}]'::jsonb
    WHERE id = ${secondId};
  `), 'cross user direct write');
  assert.equal(await must(`
    SELECT equipment_targets->0->>'weight' FROM public.program_exercises WHERE id = ${secondId};
  `, 'cross user changed nothing'), '30');
  await expectError(asUser(userA, `
    UPDATE public.program_exercises
    SET equipment_targets = '[{"equipment":"machine","weight":80,"unit":"lb","variation_exercise_id":${privateId}}]'::jsonb
    WHERE id = ${secondId};
  `), /equipment_target_not_owned/, 'direct other owner variation');
  assert.equal(await must(`
    SELECT equipment_targets->0->>'equipment' FROM public.program_exercises WHERE id = ${secondId};
  `, 'other owner variation unchanged'), 'dumbbell');
  await must(asUser(userA, `
    UPDATE public.program_exercises
    SET equipment_targets = '[{"equipment":"machine","weight":80,"unit":"lb","variation_exercise_id":${benchId}}]'::jsonb
    WHERE id = ${secondId};
  `), 'direct catalog variation');
  assert.equal(await must(`
    SELECT equipment_targets->0->>'variation_exercise_id' FROM public.program_exercises WHERE id = ${secondId};
  `, 'catalog variation stored'), String(benchId));
  await expectError(asUser(userA, `SELECT public.enforce_equipment_target_owners();`), /trigger/i, 'trigger function is not callable');
  await must(`UPDATE public.program_exercises SET equipment_targets = NULL WHERE id = ${secondId};`, 'clear direct targets');
  await expectError(
    asUser(userA, `SELECT public.save_equipment_targets(${payload({
      rows: [{ program_exercise_id: secondId, targets: [{ equipment: 'machine', weight: '80', unit: 'lb' }] }],
    })});`),
    /invalid_import: equipment_weight/,
    'string weight',
  );
  await expectError(
    asUser(userA, `SELECT public.save_equipment_targets(${payload({
      rows: [{ program_exercise_id: secondId, targets: [{ equipment: 'kettlebell', weight: 10 }] }],
    })});`),
    /invalid_import: equipment_targets/,
    'rpc kettlebell',
  );
  await expectError(
    asUser(userA, `SELECT public.save_equipment_targets(${payload({
      rows: [{ program_exercise_id: secondId, targets: [{ equipment: 'machine', weight: 2001, unit: 'lb' }] }],
    })});`),
    /invalid_import: equipment_weight/,
    'rpc weight 2001',
  );
  await expectError(
    asUser(userA, `SELECT public.save_equipment_targets(${payload({
      rows: [{
        program_exercise_id: secondId,
        targets: [{ equipment: 'machine', weight: 80, unit: 'lb', note: 'secret' }],
      }],
    })});`),
    /invalid_import: equipment_target_field/,
    'extra key',
  );
  await expectError(asUser(userB, `SELECT public.save_equipment_targets(${payload({
    rows: [{ program_exercise_id: firstId, targets: [] }],
  })});`), /equipment_target_not_owned/, 'cross user after write');
  assert.equal((JSON.parse(await must(`
    SELECT equipment_targets::text FROM public.program_exercises WHERE id = ${firstId};
  `, 'targets stay')) as { weight: number }[])[0]?.weight, 155);
  await expectError(`
    BEGIN;
    SET LOCAL ROLE anon;
    SELECT public.save_equipment_targets('${JSON.stringify({ rows: [{ program_exercise_id: firstId, targets: [] }] })}'::jsonb);
    COMMIT;
  `, /permission denied/i, 'anon execute');
  await expectError(forwardSql, /equipment_targets_already_present/, 'second apply');
  assert.equal(await historyText(), historyBefore);
  assert.equal(await fingerprint('workout_sessions'), sessionsBefore);
  assert.equal(await fingerprint('workout_sets'), setsBefore);
  await expectError(rollbackSql, /equipment_targets_rollback_blocked/, 'rollback while stored');
  assert.equal(await must(`
    SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'program_exercises' AND column_name = 'equipment_targets';
  `, 'column remains'), '1');
  await must(`UPDATE public.program_exercises SET equipment_targets = NULL;`, 'clear targets');
  const rolled = await must(rollbackSql, 'rollback');
  assert.match(rolled, /equipment_targets_rolled_back/);
  assert.equal(await must(`
    SELECT count(*)::text FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'program_exercises' AND column_name = 'equipment_targets';
  `, 'column dropped'), '0');
  assert.equal(await must(`SELECT to_regprocedure('public.save_equipment_targets(jsonb)') IS NULL;`, 'function dropped'), 't');
  assert.equal(await must(`SELECT to_regprocedure('public.equipment_targets_json_valid(jsonb)') IS NULL;`, 'validator dropped'), 't');
  assert.equal(await must(`SELECT to_regprocedure('public.enforce_equipment_target_owners()') IS NULL;`, 'owner trigger function dropped'), 't');
  assert.equal(await must(`
    SELECT count(*)::text FROM pg_trigger WHERE tgname = 'program_exercises_equipment_target_owners';
  `, 'owner trigger dropped'), '0');
  assert.equal(await historyText(), historyBefore);
  assert.equal(await fingerprint('workout_sessions'), sessionsBefore);
  assert.equal(await fingerprint('workout_sets'), setsBefore);
  assert.equal(await functionIds(), functionsBefore);
  console.log('one-tap equipment target checks passed');
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
