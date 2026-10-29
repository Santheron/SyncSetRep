import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IMPORT_ENABLED, PERSIST_REST_SECONDS, SUBTITLE_REQUIRED } from '../lib/import/flags.ts';
import {
  assertImportStaysInactive,
  buildImportInsertPlan,
  IMPORT_BLANK_SUBTITLE_MESSAGE,
  IMPORT_CAPACITY_MESSAGE,
  IMPORT_DAY_NAME_MESSAGE,
  IMPORT_DUPLICATE_EXERCISE_MESSAGE,
  IMPORT_EMPTY_DAYS_MESSAGE,
  IMPORT_ISSUE_MESSAGE,
  IMPORT_NO_ACTIVE_PROGRAM_MESSAGE,
  IMPORT_NOTE_MESSAGE,
  IMPORT_PROGRAM_NAME_MESSAGE,
  IMPORT_REST_RANGE_MESSAGE,
  IMPORT_SLUG_MESSAGE,
  IMPORT_UNACCEPTED_REPS_MESSAGE,
  IMPORT_UNACCEPTED_SETS_MESSAGE,
  IMPORT_UNRESOLVED_EXERCISE_MESSAGE,
  type ImportInsertPlan,
  type ImportInsertPlanResult,
  type ImportPreview,
} from '../lib/import/save-plan.ts';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function preview(): ImportPreview {
  return {
    programName: ' Upper Lower ',
    days: [
      {
        name: ' Upper ',
        subtitle: ' Monday ',
        exercises: [
          {
            exerciseId: '2',
            matchStatus: 'matched',
            sets: { acceptance: 'extracted', value: 3, suggestion: 9 },
            repsMin: { acceptance: 'extracted', value: 8, suggestion: null },
            repsMax: { acceptance: 'extracted', value: 12, suggestion: null },
            restSeconds: { acceptance: 'extracted', value: 90, suggestion: null },
            notes: ' Pause ',
          },
        ],
      },
      {
        name: 'Lower',
        subtitle: '   ',
        exercises: [
          {
            exerciseId: '6',
            matchStatus: 'manual',
            sets: { acceptance: 'accepted_suggestion', value: 4, suggestion: 9 },
            repsMin: { acceptance: 'user_entered', value: 5, suggestion: null },
            repsMax: { acceptance: 'user_entered', value: 5, suggestion: null },
            restSeconds: { acceptance: 'missing', value: null, suggestion: 60 },
            notes: null,
          },
        ],
      },
    ],
    issues: [
      {
        path: 'days[0].exercises[0].weight',
        code: 'weight_dropped',
        message: 'Weight was not kept.',
      },
    ],
  };
}

function planOf(result: ImportInsertPlanResult): ImportInsertPlan {
  if (!result.ok) {
    assert.fail(result.errors.join('\n'));
  }
  return result.plan;
}

function errorsOf(result: ImportInsertPlanResult): string[] {
  if (result.ok) {
    assert.fail('expected the save plan to refuse');
  }
  assert.equal('plan' in result, false);
  return result.errors;
}

assert.equal(IMPORT_ENABLED, false);
assert.equal(PERSIST_REST_SECONDS, false);
assert.equal(SUBTITLE_REQUIRED, false);

const plan = planOf(buildImportInsertPlan(preview(), USER_ID, { hasActiveProgram: true }));
assert.equal(plan.program.user_id, USER_ID);
assert.equal(plan.program.name, 'Upper Lower');
assert.equal(plan.program.slug, null);
assert.equal(plan.program.is_active, false);
assert.equal('id' in plan.program, false);
assert.deepEqual(
  plan.days.map((day) => day.day_order),
  [1, 2],
);
assert.equal(plan.days[0]?.name, 'Upper');
assert.equal(plan.days[0]?.subtitle, 'Monday');
assert.equal(plan.days[0]?.program_id, null);
assert.equal(plan.days[1]?.subtitle, null);
assert.equal(plan.days[0]?.program_exercises[0]?.exercise_id, '2');
assert.equal(plan.days[0]?.program_exercises[0]?.exercise_order, 1);
assert.equal(plan.days[0]?.program_exercises[0]?.target_sets, 3);
assert.equal(plan.days[0]?.program_exercises[0]?.min_reps, 8);
assert.equal(plan.days[0]?.program_exercises[0]?.max_reps, 12);
assert.equal(plan.days[0]?.program_exercises[0]?.notes, 'Pause');
assert.equal(plan.days[1]?.program_exercises[0]?.exercise_id, '6');
assert.equal(plan.days[1]?.program_exercises[0]?.target_sets, 4);
assert.equal('rest_seconds' in (plan.days[0]?.program_exercises[0] ?? {}), false);
assert.equal('rest_seconds' in (plan.days[1]?.program_exercises[0] ?? {}), false);
assert.equal('weight' in (plan.days[0]?.program_exercises[0] ?? {}), false);
assert.equal('sourceName' in (plan.days[0]?.program_exercises[0] ?? {}), false);
assert.doesNotThrow(() => assertImportStaysInactive(plan.program));

const blob = JSON.stringify(plan);
assert.equal(blob.includes('workout_sessions'), false);
assert.equal(blob.includes('workout_sets'), false);
assert.equal(blob.includes('"exercises"'), false);
assert.equal(blob.includes('"is_active":true'), false);

const sameExercise = preview();
const second = sameExercise.days[1]?.exercises[0];
if (!second) {
  throw new Error('preview exercise missing');
}
second.exerciseId = '2';
second.matchStatus = 'matched';
const samePlan = planOf(buildImportInsertPlan(sameExercise, USER_ID, { hasActiveProgram: true }));
assert.equal(samePlan.days[0]?.program_exercises[0]?.exercise_id, '2');
assert.equal(samePlan.days[1]?.program_exercises[0]?.exercise_id, '2');

const duplicate = preview();
const firstExercise = duplicate.days[0]?.exercises[0];
if (!firstExercise || !duplicate.days[0]) {
  throw new Error('preview exercise missing');
}
duplicate.days[0].exercises.push({ ...firstExercise, exerciseId: '2' });
assert.deepEqual(errorsOf(buildImportInsertPlan(duplicate, USER_ID, { hasActiveProgram: true })), [
  IMPORT_DUPLICATE_EXERCISE_MESSAGE,
]);

const mixedIds = preview();
const mixedDay = mixedIds.days[0];
const mixedExercise = mixedDay?.exercises[0];
if (!mixedDay || !mixedExercise) {
  throw new Error('preview exercise missing');
}
mixedDay.exercises.push({ ...mixedExercise, exerciseId: 2 });
assert.deepEqual(errorsOf(buildImportInsertPlan(mixedIds, USER_ID, { hasActiveProgram: true })), [
  IMPORT_DUPLICATE_EXERCISE_MESSAGE,
]);

const unmatched = preview();
const unmatchedExercise = unmatched.days[0]?.exercises[0];
if (!unmatchedExercise) {
  throw new Error('preview exercise missing');
}
unmatchedExercise.matchStatus = 'unmatched';
unmatchedExercise.exerciseId = null;
assert.deepEqual(errorsOf(buildImportInsertPlan(unmatched, USER_ID, { hasActiveProgram: true })), [
  IMPORT_UNRESOLVED_EXERCISE_MESSAGE,
]);

const ambiguous = preview();
const ambiguousExercise = ambiguous.days[0]?.exercises[0];
if (!ambiguousExercise) {
  throw new Error('preview exercise missing');
}
ambiguousExercise.matchStatus = 'ambiguous';
ambiguousExercise.exerciseId = '2';
assert.deepEqual(errorsOf(buildImportInsertPlan(ambiguous, USER_ID, { hasActiveProgram: true })), [
  IMPORT_UNRESOLVED_EXERCISE_MESSAGE,
]);

const manualMissing = preview();
const manualExercise = manualMissing.days[0]?.exercises[0];
if (!manualExercise) {
  throw new Error('preview exercise missing');
}
manualExercise.matchStatus = 'manual';
manualExercise.exerciseId = null;
assert.deepEqual(
  errorsOf(buildImportInsertPlan(manualMissing, USER_ID, { hasActiveProgram: true })),
  [IMPORT_UNRESOLVED_EXERCISE_MESSAGE],
);

const unaccepted = preview();
const unacceptedSets = unaccepted.days[0]?.exercises[0]?.sets;
if (!unacceptedSets) {
  throw new Error('preview exercise missing');
}
unacceptedSets.acceptance = 'missing';
unacceptedSets.value = null;
unacceptedSets.suggestion = 4;
assert.deepEqual(errorsOf(buildImportInsertPlan(unaccepted, USER_ID, { hasActiveProgram: true })), [
  IMPORT_UNACCEPTED_SETS_MESSAGE,
]);

for (const sets of [0, 13]) {
  const outOfRange = preview();
  const field = outOfRange.days[0]?.exercises[0]?.sets;
  if (!field) {
    throw new Error('preview exercise missing');
  }
  field.value = sets;
  assert.deepEqual(errorsOf(buildImportInsertPlan(outOfRange, USER_ID, { hasActiveProgram: true })), [
    IMPORT_UNACCEPTED_SETS_MESSAGE,
  ]);
}

for (const reps of [0, 101]) {
  const outOfRange = preview();
  const field = outOfRange.days[0]?.exercises[0]?.repsMax;
  if (!field) {
    throw new Error('preview exercise missing');
  }
  field.value = reps;
  assert.deepEqual(errorsOf(buildImportInsertPlan(outOfRange, USER_ID, { hasActiveProgram: true })), [
    IMPORT_UNACCEPTED_REPS_MESSAGE,
  ]);
}

for (const persistRestSeconds of [false, true]) {
  const rest = preview();
  const field = rest.days[0]?.exercises[0]?.restSeconds;
  if (!field) {
    throw new Error('preview exercise missing');
  }
  field.value = 601;
  assert.deepEqual(
    errorsOf(
      buildImportInsertPlan(rest, USER_ID, { hasActiveProgram: true, persistRestSeconds }),
    ),
    [IMPORT_REST_RANGE_MESSAGE],
  );
}

const persisted = preview();
const persistedRest = persisted.days[1]?.exercises[0]?.restSeconds;
if (!persistedRest) {
  throw new Error('preview exercise missing');
}
persistedRest.acceptance = 'user_entered';
persistedRest.value = 0;
const persistedPlan = planOf(
  buildImportInsertPlan(persisted, USER_ID, { hasActiveProgram: true, persistRestSeconds: true }),
);
assert.equal(persistedPlan.days[0]?.program_exercises[0]?.rest_seconds, 90);
assert.equal(persistedPlan.days[1]?.program_exercises[0]?.rest_seconds, 0);

const omittedRest = planOf(
  buildImportInsertPlan(preview(), USER_ID, { hasActiveProgram: true, persistRestSeconds: true }),
);
assert.equal(omittedRest.days[0]?.program_exercises[0]?.rest_seconds, 90);
assert.equal('rest_seconds' in (omittedRest.days[1]?.program_exercises[0] ?? {}), false);

assert.deepEqual(
  errorsOf(buildImportInsertPlan(preview(), USER_ID, { hasActiveProgram: true, subtitleRequired: true })),
  [IMPORT_BLANK_SUBTITLE_MESSAGE],
);

const slugRefused = errorsOf(
  buildImportInsertPlan(preview(), USER_ID, { hasActiveProgram: true, slugRequired: true }),
);
assert.deepEqual(slugRefused, [IMPORT_SLUG_MESSAGE]);
assert.equal(slugRefused.join('\n').includes('upper-lower'), false);

assert.deepEqual(errorsOf(buildImportInsertPlan(preview(), USER_ID, { hasActiveProgram: false })), [
  IMPORT_NO_ACTIVE_PROGRAM_MESSAGE,
]);

const blankProgram = preview();
blankProgram.programName = '   ';
assert.deepEqual(errorsOf(buildImportInsertPlan(blankProgram, USER_ID, { hasActiveProgram: true })), [
  IMPORT_PROGRAM_NAME_MESSAGE,
]);

const longProgram = preview();
longProgram.programName = 'p'.repeat(81);
assert.deepEqual(errorsOf(buildImportInsertPlan(longProgram, USER_ID, { hasActiveProgram: true })), [
  IMPORT_PROGRAM_NAME_MESSAGE,
]);

const longDay = preview();
const longDayRow = longDay.days[0];
if (!longDayRow) {
  throw new Error('preview day missing');
}
longDayRow.name = 'd'.repeat(61);
assert.deepEqual(errorsOf(buildImportInsertPlan(longDay, USER_ID, { hasActiveProgram: true })), [
  IMPORT_DAY_NAME_MESSAGE,
]);

const longNote = preview();
const longNoteExercise = longNote.days[0]?.exercises[0];
if (!longNoteExercise) {
  throw new Error('preview exercise missing');
}
longNoteExercise.notes = 'n'.repeat(281);
assert.deepEqual(errorsOf(buildImportInsertPlan(longNote, USER_ID, { hasActiveProgram: true })), [
  IMPORT_NOTE_MESSAGE,
]);

for (const code of ['note_too_long', 'empty_name', 'empty_program_name']) {
  const blocked = preview();
  blocked.issues = [{ path: 'days[0].name', code, message: 'blocked' }];
  assert.deepEqual(errorsOf(buildImportInsertPlan(blocked, USER_ID, { hasActiveProgram: true })), [
    IMPORT_ISSUE_MESSAGE,
  ]);
}

const noDays = preview();
noDays.days = [];
assert.deepEqual(errorsOf(buildImportInsertPlan(noDays, USER_ID, { hasActiveProgram: true })), [
  IMPORT_EMPTY_DAYS_MESSAGE,
]);

const tooManyDays = preview();
const day = tooManyDays.days[0];
if (!day) {
  throw new Error('preview day missing');
}
tooManyDays.days = [day, day, day, day, day, day, day, day];
assert.deepEqual(errorsOf(buildImportInsertPlan(tooManyDays, USER_ID, { hasActiveProgram: true })), [
  IMPORT_CAPACITY_MESSAGE,
]);

assert.throws(() => assertImportStaysInactive({ is_active: true }));

const saveSource = readFileSync(new URL('../lib/import/save-plan.ts', import.meta.url), 'utf8');
assert.equal(saveSource.includes('ensureOwnProgram'), false);
assert.equal(saveSource.includes('workout_sessions'), false);
assert.equal(saveSource.includes('workout_sets'), false);
assert.equal(saveSource.includes('@/lib/supabase'), false);
assert.equal(saveSource.includes('is_active: true'), false);

console.log('workout import save checks passed');
