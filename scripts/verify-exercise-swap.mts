import assert from 'node:assert/strict';

import {
  assignLoggedSets,
  duplicateExerciseSlotIds,
  equipmentFamily,
  exercisesForPicker,
  matchCatalogExercise,
  parseSetKey,
  planReplacementSets,
  PRIVATE_EXERCISE_UNAVAILABLE,
  setKey,
  sharesEquipmentProgression,
  weightForReplacement,
} from '../lib/exercise-swap.ts';

const barbell = {
  id: '1',
  name: 'Incline Barbell Bench Press',
  category: 'Chest',
  equipmentType: 'Barbell',
};
const machine = {
  id: '2',
  name: 'Paramount FW-8700 Incline Chest Press',
  category: 'Chest',
  equipmentType: 'Machine',
};
const dumbbell = {
  id: '3',
  name: 'Incline Dumbbell Press',
  category: 'Chest',
  equipmentType: 'Dumbbell',
};
const military = {
  id: '4',
  name: 'Military Press Machine',
  category: 'Shoulders',
  equipmentType: 'Machine',
};
const pulldown = {
  id: '5',
  name: 'Lat Pulldown',
  category: 'Back',
  equipmentType: 'Cable',
};
const pullup = {
  id: '6',
  name: 'Assisted Pull-Up',
  category: 'Back',
  equipmentType: 'Assisted',
};
const legCurl = {
  id: '7',
  name: 'Leg Curl',
  category: 'Legs',
  equipmentType: 'Machine',
};

assert.equal(equipmentFamily('Barbell'), 'free-weight');
assert.equal(equipmentFamily('Dumbbell'), 'free-weight');
assert.equal(equipmentFamily('Machine'), 'machine');
assert.equal(equipmentFamily('Cable'), 'cable');
assert.equal(equipmentFamily('Assisted'), 'bodyweight');
assert.equal(sharesEquipmentProgression('Barbell', 'Machine'), false);
assert.equal(sharesEquipmentProgression('Barbell', 'Dumbbell'), false);
assert.equal(sharesEquipmentProgression('Machine', 'Machine'), true);

assert.equal(
  weightForReplacement({
    sourceEquipmentType: 'Barbell',
    targetEquipmentType: 'Machine',
    sourceDraftWeight: 105,
    targetHistoryWeight: null,
  }),
  null,
);
assert.equal(
  weightForReplacement({
    sourceEquipmentType: 'Barbell',
    targetEquipmentType: 'Machine',
    sourceDraftWeight: 105,
    targetHistoryWeight: 40,
  }),
  40,
);
assert.equal(
  weightForReplacement({
    sourceEquipmentType: 'Barbell',
    targetEquipmentType: 'Dumbbell',
    sourceDraftWeight: 105,
    targetHistoryWeight: null,
  }),
  null,
);

const catalog = [barbell, machine, dumbbell, military, pulldown, pullup, legCurl];
const suggestions = exercisesForPicker({
  exercises: catalog,
  current: barbell,
  query: '',
  equipmentFilter: 'All',
});
assert.equal(suggestions.showingSuggestions, true);
assert.deepEqual(
  suggestions.exercises.map((exercise) => exercise.id),
  ['3', '2'],
  'same muscle group is suggested before other equipment',
);

const search = exercisesForPicker({
  exercises: catalog,
  current: pullup,
  query: 'lat pulldown',
  equipmentFilter: 'All',
});
assert.equal(search.showingSuggestions, false);
assert.deepEqual(search.exercises.map((exercise) => exercise.name), ['Lat Pulldown']);

const machineFilter = exercisesForPicker({
  exercises: catalog,
  current: barbell,
  query: '',
  equipmentFilter: 'Machine',
});
assert.deepEqual(machineFilter.exercises.map((exercise) => exercise.name), [
  'Paramount FW-8700 Incline Chest Press',
]);

assert.equal(matchCatalogExercise(catalog, 'lat pulldown')?.id, '5');
assert.equal(matchCatalogExercise(catalog, 'Missing Press'), null);
assert.match(PRIVATE_EXERCISE_UNAVAILABLE, /not in the shared catalog/);
assert.match(PRIVATE_EXERCISE_UNAVAILABLE, /was not changed/);

const sets = [
  { id: 'c1', exerciseId: '1', setNumber: 1, isCompleted: true },
  { id: 'i2', exerciseId: '1', setNumber: 2, isCompleted: false },
  { id: 'i3', exerciseId: '1', setNumber: 3, isCompleted: false },
];
const blocked = planReplacementSets({
  fromExerciseId: '1',
  toExerciseId: '2',
  targetSets: 3,
  sets,
  keepCompleted: false,
  weight: 40,
});
assert.equal(blocked.ok, false);

const plan = planReplacementSets({
  fromExerciseId: '1',
  toExerciseId: '2',
  targetSets: 3,
  sets,
  keepCompleted: true,
  weight: null,
});
assert.equal(plan.ok, true);
if (plan.ok) {
  assert.deepEqual(plan.deleteIds, ['i2', 'i3']);
  assert.equal(plan.deleteIds.includes('c1'), false);
  assert.equal(plan.insertCount, 2);
  assert.equal(plan.weight, null);
}

const collision = planReplacementSets({
  fromExerciseId: '1',
  toExerciseId: '2',
  targetSets: 3,
  sets: [...sets, { id: 'm1', exerciseId: '2', setNumber: 1, isCompleted: false }],
  keepCompleted: true,
  weight: null,
});
assert.equal(collision.ok, false);

const firstKey = setKey('slot-a', '1', 1);
const secondKey = setKey('slot-b', '1', 1);
assert.notEqual(firstKey, secondKey);
assert.deepEqual(parseSetKey(firstKey), { slotId: 'slot-a', exerciseId: '1', setNumber: 1 });
assert.deepEqual(parseSetKey('session:1:1'), null);

const assigned = assignLoggedSets(
  [
    { slotId: 'slot-a', exerciseId: '1', targetSets: 3 },
    { slotId: 'slot-b', exerciseId: '1', targetSets: 3 },
  ],
  sets,
);
assert.deepEqual(
  assigned.map((row) => row.slotId),
  ['slot-a', 'slot-a', 'slot-a'],
);
assert.deepEqual(duplicateExerciseSlotIds([
  { slotId: 'slot-a', exerciseId: '1' },
  { slotId: 'slot-b', exerciseId: '1' },
  { slotId: 'slot-c', exerciseId: '2' },
]), ['slot-b']);

console.log('exercise swap checks passed');
