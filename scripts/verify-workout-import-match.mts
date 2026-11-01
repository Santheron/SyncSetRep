import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AUTO_EXERCISE_ALIASES, SUGGEST_EXERCISE_ALIASES } from '../lib/import/exercise-aliases.ts';
import {
  matchImportedExercises,
  type ImportCatalogExercise,
  type ImportMatch,
} from '../lib/import/match-exercises.ts';
import { normExerciseName } from '../lib/import/normalize-exercise-name.ts';

const catalog = JSON.parse(
  readFileSync(new URL('./fixtures/workout-import/catalog.json', import.meta.url), 'utf8'),
) as ImportCatalogExercise[];

function match(sourceName: string, rows: readonly ImportCatalogExercise[] = catalog): ImportMatch {
  return matchImportedExercises(rows, sourceName);
}

assert.equal(normExerciseName('  Dumbbell Bench-Press '), 'dumbbell bench press');
assert.equal(normExerciseName('EZ-Bar'), 'ez bar');

for (const key of Object.keys(AUTO_EXERCISE_ALIASES)) {
  assert.equal(SUGGEST_EXERCISE_ALIASES[key], undefined, key);
}
assert.equal(AUTO_EXERCISE_ALIASES.rdl, 'romanian deadlift');
assert.equal(AUTO_EXERCISE_ALIASES.squat, undefined);
assert.equal(SUGGEST_EXERCISE_ALIASES.squat, 'barbell squat');
assert.equal(SUGGEST_EXERCISE_ALIASES['incline bench press'], 'incline barbell bench press');
assert.equal(AUTO_EXERCISE_ALIASES['incline bench press'], undefined);
assert.equal(AUTO_EXERCISE_ALIASES['incline dumbbell bench press'], 'incline dumbbell press');

assert.deepEqual(match('Dumbbell bench press'), {
  status: 'matched',
  selectedId: '2',
  candidateIds: ['2'],
  method: 'exact',
});
assert.deepEqual(match('Barbell bench press'), {
  status: 'matched',
  selectedId: '1',
  candidateIds: ['1'],
  method: 'exact',
});
assert.deepEqual(match('Bench press'), {
  status: 'ambiguous',
  selectedId: null,
  candidateIds: ['1', '2'],
  method: 'subset',
});
assert.deepEqual(match('Machine bench'), {
  status: 'unmatched',
  selectedId: null,
  candidateIds: [],
  method: 'none',
});
assert.deepEqual(match('rdl'), {
  status: 'matched',
  selectedId: '5',
  candidateIds: ['5'],
  method: 'alias',
});
assert.deepEqual(match('squat'), {
  status: 'ambiguous',
  selectedId: null,
  candidateIds: ['6'],
  method: 'alias-suggestion',
});
assert.equal(match('back squat').selectedId, null);
assert.equal(match('back squat').method, 'alias-suggestion');

const twoRdls: ImportCatalogExercise[] = [
  ...catalog,
  { id: 7, name: 'Romanian Deadlift', equipment_type: 'Dumbbell' },
];
assert.deepEqual(match('rdl', twoRdls), {
  status: 'ambiguous',
  selectedId: null,
  candidateIds: ['5', '7'],
  method: 'alias',
});

assert.deepEqual(match('Incline dumbbell bench press'), {
  status: 'unmatched',
  selectedId: null,
  candidateIds: [],
  method: 'none',
});
assert.deepEqual(match('Close-grip dumbbell bench press'), {
  status: 'unmatched',
  selectedId: null,
  candidateIds: [],
  method: 'none',
});

const bareBench: ImportCatalogExercise[] = [{ id: 2, name: 'Bench Press', equipment_type: null }];
assert.deepEqual(match('Dumbbell bench press', bareBench), {
  status: 'unmatched',
  selectedId: null,
  candidateIds: [],
  method: 'none',
});

const dumbbellByEquipment: ImportCatalogExercise[] = [
  { id: 8, name: 'Bench Press', equipment_type: 'Dumbbell' },
];
assert.deepEqual(match('Dumbbell bench press', dumbbellByEquipment), {
  status: 'matched',
  selectedId: '8',
  candidateIds: ['8'],
  method: 'subset',
});
assert.equal(match('Barbell bench press', dumbbellByEquipment).selectedId, null);

for (const sourceName of ['dumbbell', 'machine', 'db', 'assisted', 'cable', 'kb']) {
  const result = match(sourceName);
  assert.deepEqual(result, {
    status: 'unmatched',
    selectedId: null,
    candidateIds: [],
    method: 'none',
  });
  assert.equal(result.candidateIds.includes('1'), false);
  assert.equal(result.candidateIds.includes('2'), false);
  assert.equal(result.candidateIds.includes('3'), false);
}

assert.deepEqual(match('db bench press'), {
  status: 'matched',
  selectedId: '2',
  candidateIds: ['2'],
  method: 'subset',
});
assert.deepEqual(match('bb bench press'), {
  status: 'matched',
  selectedId: '1',
  candidateIds: ['1'],
  method: 'subset',
});
assert.equal(match('hack squat').selectedId, null);
assert.equal(match('hack squat').status, 'unmatched');
assert.deepEqual(match('Chest press'), {
  status: 'ambiguous',
  selectedId: null,
  candidateIds: ['3'],
  method: 'subset',
});
assert.deepEqual(match('smith chest press'), {
  status: 'matched',
  selectedId: '3',
  candidateIds: ['3'],
  method: 'subset',
});
assert.equal(match('smith chest press').candidateIds.includes('1'), false);
assert.equal(match('body weight squat').selectedId, null);
assert.equal(match('Assisted Pull-Up').selectedId, '4');

const stringIds = catalog.map((row) => ({ ...row, id: String(row.id) }));
assert.equal(match('Dumbbell bench press', stringIds).selectedId, '2');

assert.deepEqual(match('barbell dumbbell press'), {
  status: 'ambiguous',
  selectedId: null,
  candidateIds: ['1', '2', '5', '6'],
  method: 'none',
});
assert.deepEqual(match('   '), {
  status: 'unmatched',
  selectedId: null,
  candidateIds: [],
  method: 'none',
});

const calves: ImportCatalogExercise[] = [
  ...catalog,
  { id: 8, name: 'Calf Raise', equipment_type: 'Machine' },
];
assert.equal(match('calf raise', calves).selectedId, '8');
const standing = match('standing calf raise', calves);
assert.equal(standing.selectedId, null);
assert.equal(standing.status, 'ambiguous');
assert.equal(standing.method, 'alias-suggestion');
assert.deepEqual(standing.candidateIds, ['8']);

const results = [
  match('Dumbbell bench press'),
  match('Bench press'),
  match('rdl'),
  match('squat'),
  match('machine'),
];
for (const result of results) {
  assert.equal('createExercise' in result, false);
}

const matcherSource = readFileSync(new URL('../lib/import/match-exercises.ts', import.meta.url), 'utf8');
assert.equal(matcherSource.includes('equipmentFamily'), false);
assert.equal(matcherSource.includes('matchCatalogExercise'), false);
assert.equal(matcherSource.includes('exercise-swap'), false);
assert.equal(matcherSource.includes('createExercise'), false);

console.log('workout import match checks passed');
