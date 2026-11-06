import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  catalogChoices,
  describeImportReview,
  IMPORT_REVIEW_NOTICE,
  importReviewSaveBlockers,
  REST_NOT_STORED_MESSAGE,
  WEIGHT_VISIBLE_MESSAGE,
} from '../lib/import/import-review-display.ts';
import { importWorkoutDraft } from '../lib/import/import-workout.ts';
import {
  applyManualEdit,
  applyManualNumber,
  MANUAL_REST_MESSAGE,
  MANUAL_SETS_MESSAGE,
} from '../lib/import/manual-program.ts';
import type { ImportCatalogExercise } from '../lib/import/match-exercises.ts';
import {
  chooseExercise,
  renameImportedExercise,
  setDaySubtitle,
  setExercisePlannedUnit,
  setExercisePlannedWeight,
  setUserNumber,
  toImportPreview,
} from '../lib/import/review-editor.ts';
import { buildImportInsertPlan, IMPORT_INVERTED_REPS_MESSAGE, IMPORT_UNRESOLVED_EXERCISE_MESSAGE } from '../lib/import/save-plan.ts';
import { toSavePayload } from '../lib/import/save-payload.ts';

const USER_ID = '11111111-1111-1111-1111-111111111111';

const catalog: ImportCatalogExercise[] = [
  { id: 4, name: 'Bench Press', equipment_type: 'barbell' },
  { id: 8, name: 'Dumbbell Shoulder Press', equipment_type: 'dumbbell' },
  { id: 9, name: 'Barbell Shoulder Press', equipment_type: 'barbell' },
];

const model = {
  programName: { origin: 'extracted', value: 'Resistance Training Program' },
  warnings: ['Keep the pause on bench.'],
  days: [
    {
      name: { origin: 'extracted', value: 'Day 1' },
      subtitle: { origin: 'missing', value: null },
      exercises: [
        {
          sourceName: 'Bench Press',
          sets: { origin: 'extracted', value: 3, suggestion: null },
          repsMin: { origin: 'extracted', value: 8, suggestion: null },
          repsMax: { origin: 'extracted', value: 8, suggestion: null },
          restSeconds: { origin: 'extracted', value: 90, suggestion: null },
          weight: { origin: 'extracted', value: 135, suggestion: null },
          notes: { origin: 'missing', value: null },
        },
        {
          sourceName: 'Shoulder Press',
          sets: { origin: 'extracted', value: 3, suggestion: null },
          repsMin: { origin: 'extracted', value: 10, suggestion: null },
          repsMax: { origin: 'extracted', value: 10, suggestion: null },
          restSeconds: { origin: 'missing', value: null, suggestion: null },
          weight: { origin: 'missing', value: null, suggestion: null },
          notes: { origin: 'missing', value: null },
        },
      ],
    },
  ],
};

const originalFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error('fetch must not be called');
}) as typeof fetch;

let saves = 0;

try {
  const imported = await importWorkoutDraft('Bench Press 3x8\nShoulder Press 3x10', {
    enabled: true,
    catalog,
    invoke: async () => ({ data: model, error: null }),
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) {
    throw new Error('draft was refused');
  }

  const bench = imported.review.days[0]?.exercises[0];
  const shoulder = imported.review.days[0]?.exercises[1];
  assert.equal(imported.review.programName, 'Resistance Training Program');
  assert.equal(imported.review.days.length, 1);
  assert.equal(bench?.sourceName, 'Bench Press');
  assert.equal(bench?.sets.value, 3);
  assert.equal(bench?.repsMin.value, 8);
  assert.equal(bench?.repsMax.value, 8);
  assert.equal(bench?.restSeconds.value, 90);
  assert.equal(bench?.weight?.value, 135);
  assert.equal(bench?.matchStatus, 'matched');
  assert.equal(bench?.exerciseId, '4');
  assert.equal(shoulder?.sourceName, 'Shoulder Press');
  assert.equal(shoulder?.sets.value, 3);
  assert.equal(shoulder?.repsMin.value, 10);
  assert.equal(shoulder?.repsMax.value, 10);
  assert.equal(shoulder?.matchStatus, 'ambiguous');
  assert.equal(shoulder?.exerciseId, null);
  assert.equal(shoulder?.weight?.value ?? null, null);

  const described = describeImportReview(imported.review, catalog);
  const visible = JSON.stringify(described);
  assert.equal(described.summary, 'Resistance Training Program · 1 day. Workout history was not changed.');
  assert.equal(described.notice, IMPORT_REVIEW_NOTICE);
  assert.match(visible, /Bench Press/);
  assert.match(visible, /3 × 8/);
  assert.match(visible, /Shoulder Press/);
  assert.match(visible, /3 × 10/);
  assert.match(visible, /Matched to a catalog exercise/);
  assert.match(visible, /Ambiguous/);
  assert.match(visible, /Rest 90 seconds/);
  assert.match(visible, /No rest period was in the draft/);
  assert.match(visible, /Weight 135\. Unit not specified/);
  assert.match(visible, /No planned weight/);
  assert.equal(visible.includes(WEIGHT_VISIBLE_MESSAGE), true);
  assert.equal(visible.includes(REST_NOT_STORED_MESSAGE), true);
  assert.equal(visible.includes('Keep the pause on bench.'), true);
  assert.equal(described.blockers.includes(IMPORT_UNRESOLVED_EXERCISE_MESSAGE), true);
  assert.ok(described.days[0]?.exercises[0]?.choices.some((choice) => choice.name === 'Dumbbell Shoulder Press'));
  assert.deepEqual(
    described.days[0]?.exercises[1]?.choices.map((choice) => choice.name),
    ['Dumbbell Shoulder Press', 'Barbell Shoulder Press', 'Bench Press'],
  );

  const preview = toImportPreview(imported.review);
  assert.equal(preview.days[0]?.exercises[0]?.weight?.value, 135);
  assert.equal(preview.days[0]?.exercises[0]?.plannedWeightUnit ?? null, null);
  assert.equal(preview.days[0]?.exercises[1]?.weight?.value ?? null, null);
  const weighted = setExercisePlannedWeight(imported.review, 0, 1, 135);
  assert.equal(weighted.days[0]?.exercises[1]?.weight?.value, 135);
  assert.equal(weighted.days[0]?.exercises[1]?.plannedWeightUnit ?? null, null);
  const withUnit = setExercisePlannedUnit(weighted, 0, 1, 'lb');
  assert.equal(withUnit.days[0]?.exercises[1]?.plannedWeightUnit, 'lb');
  assert.match(JSON.stringify(describeImportReview(withUnit, catalog)), /Weight 135 lb/);
  const clearedUnit = setExercisePlannedUnit(withUnit, 0, 1, null);
  assert.equal(clearedUnit.days[0]?.exercises[1]?.plannedWeightUnit, null);
  assert.equal(clearedUnit.days[0]?.exercises[1]?.weight?.value, 135);
  const clearedWeight = setExercisePlannedWeight(clearedUnit, 0, 1, null);
  assert.equal(clearedWeight.days[0]?.exercises[1]?.weight?.value ?? null, null);
  assert.equal(clearedWeight.days[0]?.exercises[1]?.plannedWeightUnit ?? null, null);
  assert.equal(setExercisePlannedUnit(imported.review, 0, 1, 'kg'), imported.review);
  assert.equal(saves, 0);
  const reviewScreen = readFileSync(new URL('../components/import-review.tsx', import.meta.url), 'utf8');
  assert.equal(reviewScreen.includes('PLANNED_WEIGHT_RANGE_MESSAGE'), true);
  assert.equal(reviewScreen.includes('keyboardType="decimal-pad"'), true);
  assert.equal(reviewScreen.includes('setImportedExerciseNotes'), true);

  const rejectedRest = applyManualNumber(imported.review, {
    dayIndex: 0,
    exerciseIndex: 0,
    field: 'restSeconds',
    raw: '999',
  });
  assert.equal(rejectedRest.error, MANUAL_REST_MESSAGE);
  assert.equal(rejectedRest.review.days[0]?.exercises[0]?.restSeconds.value, 90);
  assert.equal(rejectedRest.review.days[0]?.exercises[0]?.weight?.value, 135);
  const rejectedSets = applyManualNumber(imported.review, {
    dayIndex: 0,
    exerciseIndex: 0,
    field: 'sets',
    raw: '0',
  });
  assert.equal(rejectedSets.error, MANUAL_SETS_MESSAGE);
  assert.equal(rejectedSets.review.days[0]?.exercises[0]?.sets.value, 3);

  const renamed = renameImportedExercise(imported.review, 0, 0, 'Flat Bench');
  const changedMatch = chooseExercise(renamed, 0, 0, '8');
  const subtitled = setDaySubtitle(changedMatch, 0, 'Upper');
  const rested = applyManualNumber(subtitled, {
    dayIndex: 0,
    exerciseIndex: 0,
    field: 'restSeconds',
    raw: '45',
  });
  const editedSets = setUserNumber(rested.review, 0, 0, 'sets', 4);
  const corrected = chooseExercise(editedSets, 0, 1, '9');
  assert.equal(corrected.days[0]?.subtitle, 'Upper');
  assert.equal(corrected.days[0]?.exercises[0]?.sourceName, 'Flat Bench');
  assert.equal(corrected.days[0]?.exercises[0]?.sets.value, 4);
  assert.equal(corrected.days[0]?.exercises[0]?.restSeconds.value, 45);
  assert.equal(corrected.days[0]?.exercises[0]?.weight?.value, 135);
  assert.equal(corrected.days[0]?.exercises[0]?.matchStatus, 'manual');
  assert.equal(corrected.days[0]?.exercises[0]?.exerciseId, '8');
  assert.equal(corrected.days[0]?.exercises[1]?.matchStatus, 'manual');
  assert.equal(corrected.days[0]?.exercises[1]?.exerciseId, '9');
  assert.deepEqual(corrected.warnings, ['Keep the pause on bench.']);
  assert.equal(importReviewSaveBlockers(corrected).length, 0);
  assert.match(JSON.stringify(describeImportReview(corrected, catalog)), /4 × 8/);
  assert.match(JSON.stringify(describeImportReview(corrected, catalog)), /Corrected to a chosen exercise/);
  const noted = applyManualEdit(corrected, {
    type: 'set-notes',
    dayIndex: 0,
    exerciseIndex: 0,
    notes: 'Pause at the chest',
  });
  assert.equal(noted.error, null);
  assert.equal(noted.review.days[0]?.exercises[0]?.notes, 'Pause at the chest');
  assert.equal(noted.review.days[0]?.exercises[0]?.sourceName, 'Flat Bench');
  assert.equal(noted.review.days[0]?.exercises[0]?.weight?.value, 135);
  assert.equal(noted.review.days[0]?.exercises[0]?.restSeconds.value, 45);
  assert.equal(saves, 0);

  const inverted = setUserNumber(corrected, 0, 0, 'repsMin', 12);
  assert.equal(importReviewSaveBlockers(inverted).includes(IMPORT_INVERTED_REPS_MESSAGE), true);
  assert.equal(inverted.days[0]?.exercises[0]?.weight?.value, 135);

  const unmatchedExercise = {
    source: 'imported' as const,
    sourceName: 'Zebra Lift',
    exerciseId: null,
    matchStatus: 'unmatched' as const,
    sets: { acceptance: 'extracted' as const, value: 3, suggestion: null },
    repsMin: { acceptance: 'extracted' as const, value: 12, suggestion: null },
    repsMax: { acceptance: 'extracted' as const, value: 12, suggestion: null },
    restSeconds: { acceptance: 'missing' as const, value: null },
    notes: null,
    weight: { acceptance: 'extracted' as const, value: 40, suggestion: null },
  };
  const withUnmatched = {
    ...corrected,
    days: corrected.days.map((day, index) =>
      index === 0 ? { ...day, exercises: [...day.exercises, unmatchedExercise] } : day,
    ),
  };
  assert.equal(importReviewSaveBlockers(withUnmatched).includes(IMPORT_UNRESOLVED_EXERCISE_MESSAGE), true);
  assert.ok(
    catalogChoices(catalog, unmatchedExercise, 'bench').choices.some((choice) => choice.name === 'Bench Press'),
  );
  const resolved = chooseExercise(withUnmatched, 0, 2, '4');
  assert.equal(resolved.days[0]?.exercises[2]?.matchStatus, 'manual');
  assert.equal(resolved.days[0]?.exercises[2]?.weight?.value, 40);
  assert.equal(resolved.days[0]?.exercises[0]?.weight?.value, 135);
  assert.equal(importReviewSaveBlockers(resolved).length, 0);
  const cleared = chooseExercise(resolved, 0, 2, null);
  assert.equal(cleared.days[0]?.exercises[2]?.matchStatus, 'unmatched');
  assert.equal(cleared.days[0]?.exercises[2]?.exerciseId, null);
  assert.equal(cleared.days[0]?.exercises[2]?.weight?.value, 40);
  assert.equal(cleared.days[0]?.exercises[2]?.sourceName, 'Zebra Lift');
  assert.equal(importReviewSaveBlockers(cleared).includes(IMPORT_UNRESOLVED_EXERCISE_MESSAGE), true);
  assert.equal(saves, 0);

  const payload = toSavePayload(toImportPreview(noted.review), USER_ID, { hasActiveProgram: true });
  assert.equal(payload.ok, true);
  if (!payload.ok) {
    throw new Error(payload.errors.join('\n'));
  }
  assert.equal(payload.payload.days[0]?.exercises[0]?.target_sets, 4);
  assert.equal(payload.payload.days[0]?.exercises[0]?.min_reps, 8);
  assert.equal(payload.payload.days[0]?.exercises[0]?.notes, 'Pause at the chest');
  assert.equal(payload.payload.days[0]?.exercises[1]?.exercise_id, 9);
  assert.equal(payload.payload.days[0]?.exercises[1]?.max_reps, 10);
  assert.equal(payload.payload.days[0]?.subtitle, 'Upper');
  assert.equal(JSON.stringify(payload.payload).includes('weight'), false);
  assert.equal(JSON.stringify(payload.payload).includes('Keep the pause'), false);
  assert.equal(JSON.stringify(payload.payload).includes('rest_seconds'), false);
  assert.equal(JSON.stringify(payload.payload).includes('workout_sets'), false);
  assert.equal(JSON.stringify(payload.payload).includes('workout_sessions'), false);
  const storedRest = toSavePayload(toImportPreview(noted.review), USER_ID, {
    hasActiveProgram: true,
    persistRestSeconds: true,
  });
  assert.equal(storedRest.ok, true);
  if (!storedRest.ok) {
    throw new Error(storedRest.errors.join('\n'));
  }
  assert.equal(storedRest.payload.days[0]?.exercises[0]?.rest_seconds, 45);
  const plan = buildImportInsertPlan(toImportPreview(noted.review), USER_ID, {
    hasActiveProgram: true,
    persistRestSeconds: true,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) {
    throw new Error(plan.errors.join('\n'));
  }
  assert.equal(plan.plan.program.is_active, false);
  assert.equal(saves, 0);

  const unresolved = toSavePayload(toImportPreview(imported.review), USER_ID, { hasActiveProgram: true });
  assert.equal(unresolved.ok, false);
  assert.equal(saves, 0);

  const screen = readFileSync(new URL('../app/(tabs)/program/import.tsx', import.meta.url), 'utf8');
  const reviewComponent = readFileSync(new URL('../components/import-review.tsx', import.meta.url), 'utf8');
  const saveStart = screen.indexOf('async function importAndSave');
  assert.equal(saveStart > 0, true);
  assert.equal(screen.includes('async function saveDraft'), false);
  assert.equal(screen.includes('Import & Save Routine'), true);
  assert.equal(screen.includes('Save imported routine'), false);
  assert.equal(screen.includes('ImportReview'), false);
  assert.equal(screen.includes('importReviewSaveBlockers(review)'), false);
  assert.equal(screen.slice(saveStart).includes('saveManualProgramForCurrentUser(next, {'), true);
  assert.equal(screen.includes('if (!IMPORT_ENABLED'), true);
  assert.equal(screen.includes('update_owned_program'), false);
  assert.equal(screen.includes('workout_sets'), false);
  assert.equal(screen.includes('workout_sessions'), false);
  assert.equal(screen.includes('OPENAI_API_KEY'), false);
  assert.equal(screen.includes('api.openai.com'), false);
  for (const field of [
    'prescription',
    'matchText',
    'restText',
    'weightText',
    'renameImportedExercise',
    'restSeconds',
    'Catalog search',
  ]) {
    assert.equal(reviewComponent.includes(field), true, field);
  }
  assert.equal(reviewComponent.includes('saveManualProgramForCurrentUser'), false);
  assert.equal(reviewComponent.includes('supabase'), false);
  assert.equal(reviewComponent.includes('update_owned_program'), false);
} finally {
  globalThis.fetch = originalFetch;
}

console.log('import review screen checks passed');
