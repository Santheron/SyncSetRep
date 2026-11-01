import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IMPORT_SCHEMA } from '../lib/import/schema.ts';
import {
  checkImportSchema,
  validateImportModelOutput,
  type ImportDraft,
} from '../lib/import/validate-draft.ts';

type Origin = 'extracted' | 'missing';

type IntField = {
  origin: Origin;
  value: number | null;
  suggestion: number | null;
};

type TextField = {
  origin: Origin;
  value: string | null;
};

type WeightField = {
  origin: Origin;
  value: number | string | null;
  suggestion: unknown;
};

type Exercise = {
  sourceName: string;
  sets: IntField;
  repsMin: IntField;
  repsMax: IntField;
  restSeconds: IntField;
  weight: WeightField;
  notes: TextField;
};

type Day = {
  name: TextField;
  subtitle: TextField;
  exercises: Exercise[];
};

type Draft = {
  programName: TextField;
  days: Day[];
  warnings: string[];
};

function load(name: string): Draft {
  const text = readFileSync(new URL(`./fixtures/workout-import/${name}`, import.meta.url), 'utf8');
  return JSON.parse(text) as Draft;
}

function clone(draft: Draft): Draft {
  return JSON.parse(JSON.stringify(draft)) as Draft;
}

function exerciseOf(draft: Draft): Exercise {
  const exercise = draft.days[0]?.exercises[0];
  if (!exercise) {
    throw new Error('fixture is missing an exercise');
  }
  return exercise;
}

function kept(draft: Draft): ImportDraft {
  const checked = checkImportSchema(draft);
  assert.equal(checked.ok, true, checked.ok ? undefined : checked.reason);
  const result = validateImportModelOutput(draft);
  if (!result.ok) {
    assert.fail(result.code);
  }
  return result.data;
}

function schemaFails(draft: unknown) {
  const checked = checkImportSchema(draft);
  assert.equal(checked.ok, false);
  assert.throws(() => validateImportModelOutput(draft));
}

assert.equal(IMPORT_SCHEMA.required.includes('issues'), false);
assert.equal(JSON.stringify(IMPORT_SCHEMA).includes('"issues"'), false);

const valid = load('valid-extracted.json');
assert.equal(Object.hasOwn(valid, 'issues'), false);
const validDraft = kept(valid);
assert.equal(Object.hasOwn(valid, 'issues'), false);
assert.deepEqual(validDraft.warnings, ['Rest was copied from the source.']);
assert.deepEqual(validDraft.issues, []);
assert.equal(validDraft.days[0]?.exercises[0]?.weight.value, 22.5);
assert.equal(validDraft.days[0]?.exercises[0]?.weight.suggestion, null);
assert.equal(validDraft.days[0]?.exercises[0]?.sets.value, 3);
assert.equal(validDraft.days[0]?.exercises[0]?.repsMin.value, 8);
assert.equal(validDraft.days[0]?.exercises[0]?.repsMax.value, 12);
assert.equal(validDraft.days[0]?.exercises[0]?.repsMin.origin, 'extracted');
assert.equal(validDraft.days[0]?.exercises[0]?.repsMax.origin, 'extracted');

const missing = kept(load('valid-missing.json'));
const missingSets = missing.days[0]?.exercises[0]?.sets;
assert.equal(missingSets?.origin, 'missing');
assert.equal(missingSets?.value, null);
assert.equal(missingSets?.suggestion, 4);
assert.notEqual(missingSets?.value, missingSets?.suggestion);
const missingRest = missing.days[0]?.exercises[0]?.restSeconds;
assert.equal(missingRest?.value, null);
assert.equal(missingRest?.suggestion, 90);

const split = load('split-reps.json');
assert.equal(checkImportSchema(split).ok, true);
assert.equal(exerciseOf(split).repsMin.value, 8);
const splitDraft = kept(split);
assert.equal(exerciseOf(split).repsMin.value, 8);
assert.equal(splitDraft.days[0]?.exercises[0]?.repsMin.origin, 'missing');
assert.equal(splitDraft.days[0]?.exercises[0]?.repsMax.origin, 'missing');
assert.equal(splitDraft.days[0]?.exercises[0]?.repsMin.value, null);
assert.equal(splitDraft.days[0]?.exercises[0]?.repsMax.value, null);
assert.equal(splitDraft.days[0]?.exercises[0]?.repsMin.suggestion, null);
assert.equal(splitDraft.days[0]?.exercises[0]?.repsMax.suggestion, null);
assert.equal(
  splitDraft.issues.some((item) => item.code === 'rep_pair_split' && item.path === 'days[0].exercises[0].repsMin'),
  true,
);

const suggestedWeight = clone(valid);
exerciseOf(suggestedWeight).weight.suggestion = 185;
assert.equal(checkImportSchema(suggestedWeight).ok, true);
const suggestedDraft = kept(suggestedWeight);
assert.equal(suggestedDraft.days[0]?.exercises[0]?.weight.value, 22.5);
assert.equal(suggestedDraft.days[0]?.exercises[0]?.weight.suggestion, null);
assert.equal(
  suggestedDraft.issues.some((item) => item.code === 'weight_dropped'),
  false,
);

const strayValue = clone(valid);
exerciseOf(strayValue).sets = { origin: 'missing', value: 3, suggestion: 4 };
assert.equal(checkImportSchema(strayValue).ok, true);
const strayDraft = kept(strayValue);
assert.equal(strayDraft.days[0]?.exercises[0]?.sets.value, null);
assert.equal(strayDraft.days[0]?.exercises[0]?.sets.suggestion, 4);

const strayName = clone(valid);
strayName.programName = { origin: 'missing', value: 'Ghost' };
assert.equal(checkImportSchema(strayName).ok, true);
const strayNameDraft = kept(strayName);
assert.equal(strayNameDraft.programName.value, null);
assert.notEqual(strayNameDraft.programName.value, 'Ghost');
assert.equal(
  strayNameDraft.issues.some((item) => item.code === 'empty_program_name' && item.path === 'programName'),
  true,
);

const parsedWeight = clone(valid);
exerciseOf(parsedWeight).weight.value = '135.5';
assert.equal(kept(parsedWeight).days[0]?.exercises[0]?.weight.value, 135.5);

const bodyweight = clone(valid);
exerciseOf(bodyweight).weight.value = 'bodyweight';
const bodyweightDraft = kept(bodyweight);
assert.equal(bodyweightDraft.days[0]?.exercises[0]?.weight.origin, 'missing');
assert.equal(bodyweightDraft.days[0]?.exercises[0]?.weight.value, null);
assert.equal(
  bodyweightDraft.issues.some(
    (item) => item.code === 'weight_dropped' && item.path === 'days[0].exercises[0].weight',
  ),
  true,
);

const blankWeight = clone(valid);
exerciseOf(blankWeight).weight.value = '   ';
assert.equal(
  kept(blankWeight).issues.some((item) => item.code === 'weight_dropped'),
  true,
);

const heavyWeight = clone(valid);
exerciseOf(heavyWeight).weight.value = 2001;
assert.equal(
  kept(heavyWeight).issues.some((item) => item.code === 'weight_dropped'),
  true,
);

const threeByTen = kept(load('three-by-ten.json'));
assert.equal(threeByTen.days[0]?.exercises[0]?.sets.value, 3);
assert.equal(threeByTen.days[0]?.exercises[0]?.repsMin.value, 10);
assert.equal(threeByTen.days[0]?.exercises[0]?.repsMax.value, 10);
assert.equal(threeByTen.days[0]?.exercises[0]?.notes.value, '3x10');

const eightToTwelve = kept(load('eight-to-twelve.json'));
assert.equal(eightToTwelve.days[0]?.exercises[0]?.repsMin.value, 8);
assert.equal(eightToTwelve.days[0]?.exercises[0]?.repsMax.value, 12);
assert.equal(eightToTwelve.days[0]?.exercises[0]?.notes.value, '8-12');

const amrap = kept(load('amrap.json'));
assert.equal(amrap.days[0]?.exercises[0]?.sets.value, 3);
assert.equal(amrap.days[0]?.exercises[0]?.repsMin.value, null);
assert.equal(amrap.days[0]?.exercises[0]?.repsMax.value, null);
assert.equal(amrap.days[0]?.exercises[0]?.repsMin.suggestion, null);
assert.equal(amrap.days[0]?.exercises[0]?.notes.value, 'AMRAP');
assert.equal(amrap.days[0]?.exercises[0]?.weight.value, null);
assert.equal(
  amrap.issues.some((item) => item.code === 'weight_dropped'),
  true,
);

const noteOk = clone(valid);
exerciseOf(noteOk).notes.value = 'n'.repeat(280);
assert.equal(
  kept(noteOk).issues.some((item) => item.code === 'note_too_long'),
  false,
);

const noteLong = clone(valid);
exerciseOf(noteLong).notes.value = 'n'.repeat(281);
const noteLongDraft = kept(noteLong);
assert.equal(noteLongDraft.days[0]?.exercises[0]?.notes.value?.length, 281);
assert.equal(
  noteLongDraft.issues.some(
    (item) => item.code === 'note_too_long' && item.path === 'days[0].exercises[0].notes',
  ),
  true,
);

const emptyProgram = clone(valid);
emptyProgram.programName.value = '   ';
assert.equal(
  kept(emptyProgram).issues.some((item) => item.code === 'empty_program_name'),
  true,
);

const emptyDay = clone(valid);
const dayName = emptyDay.days[0]?.name;
if (!dayName) {
  throw new Error('fixture day missing');
}
dayName.value = '';
assert.equal(
  kept(emptyDay).issues.some((item) => item.code === 'empty_name' && item.path === 'days[0].name'),
  true,
);

const emptySource = clone(valid);
exerciseOf(emptySource).sourceName = ' ';
assert.equal(
  kept(emptySource).issues.some(
    (item) => item.code === 'empty_name' && item.path === 'days[0].exercises[0].sourceName',
  ),
  true,
);

const eightDays = clone(valid);
const eightDay = eightDays.days[0];
if (!eightDay) {
  throw new Error('fixture day missing');
}
eightDays.days = [eightDay, eightDay, eightDay, eightDay, eightDay, eightDay, eightDay, eightDay];
assert.equal(checkImportSchema(eightDays).ok, true);
const eightResult = validateImportModelOutput(eightDays);
assert.equal(eightResult.ok, false);
if (!eightResult.ok) {
  assert.equal(eightResult.code, 'over_capacity');
  assert.equal('data' in eightResult, false);
}
assert.equal(eightDays.days.length, 8);

const thirteen = clone(valid);
const baseExercise = exerciseOf(thirteen);
const thirteenDay = thirteen.days[0];
if (!thirteenDay) {
  throw new Error('fixture day missing');
}
thirteenDay.exercises = Array.from({ length: 13 }, () => baseExercise);
assert.equal(checkImportSchema(thirteen).ok, true);
const thirteenResult = validateImportModelOutput(thirteen);
assert.equal(thirteenResult.ok, false);
if (!thirteenResult.ok) {
  assert.equal(thirteenResult.code, 'over_capacity');
}
assert.equal(thirteenDay.exercises.length, 13);

const dozen = clone(valid);
const dozenDay = dozen.days[0];
if (!dozenDay) {
  throw new Error('fixture day missing');
}
dozenDay.exercises = Array.from({ length: 12 }, () => exerciseOf(dozen));
assert.equal(kept(dozen).days[0]?.exercises.length, 12);

const full = clone(valid);
const fullExercise = exerciseOf(full);
const fullDay = full.days[0];
if (!fullDay) {
  throw new Error('fixture day missing');
}
fullDay.exercises = Array.from({ length: 10 }, () => fullExercise);
full.days = [fullDay, fullDay, fullDay, fullDay];
assert.equal(
  kept(full).days.reduce((sum, day) => sum + day.exercises.length, 0),
  40,
);

const overTotal = clone(full);
const overDay = overTotal.days[0];
if (!overDay) {
  throw new Error('fixture day missing');
}
overTotal.days = [
  overDay,
  overDay,
  overDay,
  overDay,
  { ...overDay, exercises: [exerciseOf(overTotal)] },
];
const overTotalResult = validateImportModelOutput(overTotal);
assert.equal(overTotalResult.ok, false);
if (!overTotalResult.ok) {
  assert.equal(overTotalResult.code, 'over_capacity');
}

const noDays = clone(valid);
noDays.days = [];
assert.equal(checkImportSchema(noDays).ok, true);
const emptyResult = validateImportModelOutput(noDays);
assert.equal(emptyResult.ok, false);
if (!emptyResult.ok) {
  assert.equal(emptyResult.code, 'parse_empty');
}

schemaFails(load('malformed-extra-key.json'));
schemaFails(load('missing-program-name.json'));
schemaFails(null);
schemaFails([]);
schemaFails({ days: [], warnings: [] });

const setsTooHigh = clone(valid);
exerciseOf(setsTooHigh).sets.value = 99;
schemaFails(setsTooHigh);

const setsZero = clone(valid);
exerciseOf(setsZero).sets.value = 0;
schemaFails(setsZero);

const setsSuggestion = clone(valid);
exerciseOf(setsSuggestion).sets = { origin: 'missing', value: null, suggestion: 13 };
schemaFails(setsSuggestion);

const repTooHigh = clone(valid);
exerciseOf(repTooHigh).repsMin.value = 101;
schemaFails(repTooHigh);

const repZero = clone(valid);
exerciseOf(repZero).repsMax.value = 0;
schemaFails(repZero);

const restTooHigh = clone(valid);
exerciseOf(restTooHigh).restSeconds.value = 601;
schemaFails(restTooHigh);

const restNegative = clone(valid);
exerciseOf(restNegative).restSeconds.value = -1;
schemaFails(restNegative);

const noteTooLong = clone(valid);
exerciseOf(noteTooLong).notes.value = 'n'.repeat(2001);
schemaFails(noteTooLong);

const sourceTooLong = clone(valid);
exerciseOf(sourceTooLong).sourceName = 's'.repeat(2001);
schemaFails(sourceTooLong);

const warningTooLong = clone(valid);
warningTooLong.warnings = ['w'.repeat(201)];
schemaFails(warningTooLong);

const weightText = clone(valid);
exerciseOf(weightText).weight.value = 'w'.repeat(41);
schemaFails(weightText);

const wrongType = clone(valid);
exerciseOf(wrongType).sets.value = '3' as unknown as number;
schemaFails(wrongType);

const removedSets = clone(valid);
delete (exerciseOf(removedSets) as { sets?: IntField }).sets;
schemaFails(removedSets);

const extraKey = clone(valid);
(exerciseOf(extraKey) as Exercise & { createExercise?: boolean }).createExercise = true;
schemaFails(extraKey);

console.log('workout import parse checks passed');
