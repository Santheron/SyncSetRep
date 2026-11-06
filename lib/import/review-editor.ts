import type { LoadMode } from '../load-mode.ts';
import {
  parseEquipmentWeightText,
  primaryPlannedWeight,
  type EquipmentTarget,
} from './equipment-targets.ts';
import {
  MAX_DAYS,
  MAX_EXERCISES,
  MAX_EXERCISES_PER_DAY,
  NOTE_EDIT_MAX,
  REPS_MAX,
  REPS_MIN,
  REST_MAX,
  REST_MIN,
  SETS_MAX,
  SETS_MIN,
  SOURCE_NAME_MAX,
  WEIGHT_MAX,
  WEIGHT_MIN,
} from './limits.ts';
import type { ImportPreview, ImportPreviewIssue, PreviewMatchStatus, PreviewNumber } from './save-plan.ts';

// Shared editor state for a program a person has reviewed.
// Manual creation and an import preview both edit this object, then save through
// toImportPreview. This module does not call a model or a database.

export type ProgramReviewOrigin = 'manual' | 'import';

export type ReviewExercise = {
  source: 'manual' | 'imported';
  sourceName: string | null;
  exerciseId: string | number | null;
  matchStatus: PreviewMatchStatus;
  sets: PreviewNumber;
  repsMin: PreviewNumber;
  repsMax: PreviewNumber;
  restSeconds: PreviewNumber;
  notes: string | null;
  loadMode?: LoadMode | null;
  /** Display only until a planned-weight save includes it. */
  weight?: PreviewNumber;
  /** Unit for weight. Null means a number with no unit. Absent means unset. */
  plannedWeightUnit?: 'lb' | 'kg' | null;
  /** Equipment-specific planned weights. Absent means the single planned weight only. */
  equipmentTargets?: EquipmentTarget[];
};

export type ReviewDay = {
  name: string;
  subtitle: string | null;
  exercises: ReviewExercise[];
  /** Stored program_days.id. A new day has none, so an edit can archive the old row instead of reusing it. */
  storedDayId?: string | null;
};

export type ProgramReview = {
  origin: ProgramReviewOrigin;
  programName: string;
  days: ReviewDay[];
  issues: ImportPreviewIssue[];
  /** Model notes that have no program column. Edits must keep them. */
  warnings?: readonly string[];
};

export type ReviewNumberField = 'sets' | 'repsMin' | 'repsMax' | 'restSeconds';

function missingNumber(): PreviewNumber {
  return { acceptance: 'missing', value: null };
}

function copyExercise(exercise: ReviewExercise): ReviewExercise {
  return {
    source: exercise.source,
    sourceName: exercise.sourceName,
    exerciseId: exercise.exerciseId,
    matchStatus: exercise.matchStatus,
    sets: { ...exercise.sets },
    repsMin: { ...exercise.repsMin },
    repsMax: { ...exercise.repsMax },
    restSeconds: { ...exercise.restSeconds },
    notes: exercise.notes,
    loadMode: exercise.loadMode ?? null,
    ...(exercise.weight ? { weight: { ...exercise.weight } } : {}),
    ...(exercise.plannedWeightUnit !== undefined ? { plannedWeightUnit: exercise.plannedWeightUnit } : {}),
    ...(exercise.equipmentTargets
      ? { equipmentTargets: exercise.equipmentTargets.map((target) => ({ ...target })) }
      : {}),
  };
}

function copyDay(day: ReviewDay): ReviewDay {
  return {
    name: day.name,
    subtitle: day.subtitle,
    storedDayId: day.storedDayId ?? null,
    exercises: day.exercises.map(copyExercise),
  };
}

export function createProgramReview(input: {
  origin: ProgramReviewOrigin;
  programName: string;
  days: readonly ReviewDay[];
  issues?: readonly ImportPreviewIssue[];
  warnings?: readonly string[];
}): ProgramReview {
  return {
    origin: input.origin,
    programName: input.programName,
    days: input.days.map(copyDay),
    issues: (input.issues ?? []).map((issue) => ({ ...issue })),
    ...(input.warnings ? { warnings: [...input.warnings] } : {}),
  };
}

export function createManualProgramReview(): ProgramReview {
  return createProgramReview({
    origin: 'manual',
    programName: '',
    days: [{ name: 'Day 1', subtitle: null, exercises: [] }],
  });
}

export function blankManualExercise(): ReviewExercise {
  return {
    source: 'manual',
    sourceName: null,
    exerciseId: null,
    matchStatus: 'unmatched',
    sets: missingNumber(),
    repsMin: missingNumber(),
    repsMax: missingNumber(),
    restSeconds: missingNumber(),
    notes: null,
    loadMode: null,
  };
}

function exerciseCount(review: ProgramReview): number {
  return review.days.reduce((total, day) => total + day.exercises.length, 0);
}

function replaceDay(review: ProgramReview, dayIndex: number, day: ReviewDay): ProgramReview {
  return {
    ...review,
    days: review.days.map((current, index) => copyDay(index === dayIndex ? day : current)),
  };
}

export function renameProgram(review: ProgramReview, programName: string): ProgramReview {
  return {
    ...review,
    programName,
    days: review.days.map(copyDay),
  };
}

export function addDay(review: ProgramReview): ProgramReview {
  if (review.days.length >= MAX_DAYS) {
    return review;
  }
  return {
    ...review,
    days: [...review.days.map(copyDay), { name: `Day ${review.days.length + 1}`, subtitle: null, exercises: [] }],
  };
}

export function renameDay(review: ProgramReview, dayIndex: number, name: string): ProgramReview {
  const day = review.days[dayIndex];
  if (!day) {
    return review;
  }
  return replaceDay(review, dayIndex, { ...copyDay(day), name });
}

export function setDaySubtitle(
  review: ProgramReview,
  dayIndex: number,
  subtitle: string | null,
): ProgramReview {
  const day = review.days[dayIndex];
  if (!day) {
    return review;
  }
  return replaceDay(review, dayIndex, { ...copyDay(day), subtitle });
}

export function removeDay(review: ProgramReview, dayIndex: number): ProgramReview {
  if (dayIndex < 0 || dayIndex >= review.days.length) {
    return review;
  }
  return {
    ...review,
    days: review.days.filter((_, index) => index !== dayIndex).map(copyDay),
  };
}

function moveItem<T>(items: readonly T[], from: number, to: number): T[] | null {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return null;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item === undefined) {
    return null;
  }
  next.splice(to, 0, item);
  return next;
}

export function moveDay(review: ProgramReview, from: number, to: number): ProgramReview {
  const days = moveItem(review.days, from, to);
  if (!days) {
    return review;
  }
  return { ...review, days: days.map(copyDay) };
}

export function addManualExercise(review: ProgramReview, dayIndex: number): ProgramReview {
  const day = review.days[dayIndex];
  if (!day) {
    return review;
  }
  if (day.exercises.length >= MAX_EXERCISES_PER_DAY || exerciseCount(review) >= MAX_EXERCISES) {
    return review;
  }
  return replaceDay(review, dayIndex, {
    ...copyDay(day),
    exercises: [...day.exercises.map(copyExercise), blankManualExercise()],
  });
}

export function removeExercise(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
): ProgramReview {
  const day = review.days[dayIndex];
  if (!day || exerciseIndex < 0 || exerciseIndex >= day.exercises.length) {
    return review;
  }
  return replaceDay(review, dayIndex, {
    ...copyDay(day),
    exercises: day.exercises.filter((_, index) => index !== exerciseIndex).map(copyExercise),
  });
}

export function moveExercise(
  review: ProgramReview,
  dayIndex: number,
  from: number,
  to: number,
): ProgramReview {
  const day = review.days[dayIndex];
  if (!day) {
    return review;
  }
  const exercises = moveItem(day.exercises, from, to);
  if (!exercises) {
    return review;
  }
  return replaceDay(review, dayIndex, {
    ...copyDay(day),
    exercises: exercises.map(copyExercise),
  });
}

export function chooseExercise(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  exerciseId: string | number | null,
): ProgramReview {
  const day = review.days[dayIndex];
  const exercise = day?.exercises[exerciseIndex];
  if (!day || !exercise) {
    return review;
  }
  const next = copyExercise(exercise);
  if (exerciseId == null || exerciseId === '') {
    next.exerciseId = null;
    next.matchStatus = 'unmatched';
  } else {
    next.exerciseId = exerciseId;
    next.matchStatus = 'manual';
  }
  const exercises = day.exercises.map(copyExercise);
  exercises[exerciseIndex] = next;
  return replaceDay(review, dayIndex, { ...copyDay(day), exercises });
}

export function nameUnsavedExercise(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  name: string,
): ProgramReview {
  const day = review.days[dayIndex];
  const exercise = day?.exercises[exerciseIndex];
  if (!day || !exercise) {
    return review;
  }
  const next = copyExercise(exercise);
  next.exerciseId = null;
  next.matchStatus = 'unmatched';
  next.sourceName = name.trim() === '' ? null : name;
  const exercises = day.exercises.map(copyExercise);
  exercises[exerciseIndex] = next;
  return replaceDay(review, dayIndex, { ...copyDay(day), exercises });
}

export function renameImportedExercise(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  name: string,
): ProgramReview {
  const day = review.days[dayIndex];
  const exercise = day?.exercises[exerciseIndex];
  if (!day || !exercise) {
    return review;
  }
  const next = copyExercise(exercise);
  next.sourceName = name.slice(0, SOURCE_NAME_MAX);
  const exercises = day.exercises.map(copyExercise);
  exercises[exerciseIndex] = next;
  return replaceDay(review, dayIndex, { ...copyDay(day), exercises });
}

function rangeFor(field: ReviewNumberField): { min: number; max: number } {
  if (field === 'sets') {
    return { min: SETS_MIN, max: SETS_MAX };
  }
  if (field === 'restSeconds') {
    return { min: REST_MIN, max: REST_MAX };
  }
  return { min: REPS_MIN, max: REPS_MAX };
}

export function setUserNumber(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  field: ReviewNumberField,
  value: number | null,
): ProgramReview {
  const day = review.days[dayIndex];
  const exercise = day?.exercises[exerciseIndex];
  if (!day || !exercise) {
    return review;
  }
  const bounds = rangeFor(field);
  const valid =
    value == null ||
    (Number.isInteger(value) && value >= bounds.min && value <= bounds.max);
  if (!valid) {
    return review;
  }
  const next = copyExercise(exercise);
  next[field] =
    value == null
      ? missingNumber()
      : { acceptance: 'user_entered', value, suggestion: null };
  const exercises = day.exercises.map(copyExercise);
  exercises[exerciseIndex] = next;
  return replaceDay(review, dayIndex, { ...copyDay(day), exercises });
}

export function acceptSuggestion(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  field: ReviewNumberField,
): ProgramReview {
  const day = review.days[dayIndex];
  const exercise = day?.exercises[exerciseIndex];
  if (!day || !exercise) {
    return review;
  }
  const current = exercise[field];
  const bounds = rangeFor(field);
  const suggestion = current.suggestion;
  if (
    typeof suggestion !== 'number' ||
    !Number.isInteger(suggestion) ||
    suggestion < bounds.min ||
    suggestion > bounds.max
  ) {
    return review;
  }
  const next = copyExercise(exercise);
  next[field] = { acceptance: 'accepted_suggestion', value: suggestion, suggestion };
  const exercises = day.exercises.map(copyExercise);
  exercises[exerciseIndex] = next;
  return replaceDay(review, dayIndex, { ...copyDay(day), exercises });
}

export function setExerciseLoadMode(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  loadMode: LoadMode | null,
): ProgramReview {
  const day = review.days[dayIndex];
  const exercise = day?.exercises[exerciseIndex];
  if (!day || !exercise) {
    return review;
  }
  const exercises = day.exercises.map(copyExercise);
  const next = copyExercise(exercise);
  next.loadMode = loadMode;
  exercises[exerciseIndex] = next;
  return replaceDay(review, dayIndex, { ...copyDay(day), exercises });
}

export function setExerciseEquipmentText(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  text: string,
): ProgramReview {
  const day = review.days[dayIndex];
  const exercise = day?.exercises[exerciseIndex];
  if (!day || !exercise) {
    return review;
  }
  const parsed = parseEquipmentWeightText(text);
  if (!parsed.ok) {
    return review;
  }
  const next = copyExercise(exercise);
  if (parsed.targets == null) {
    delete next.equipmentTargets;
    if (parsed.plannedWeight == null) {
      next.weight = { acceptance: 'missing', value: null, suggestion: null };
      next.plannedWeightUnit = null;
    } else {
      next.weight = { acceptance: 'user_entered', value: parsed.plannedWeight, suggestion: null };
      next.plannedWeightUnit = parsed.unit;
    }
  } else {
    const primary = primaryPlannedWeight(parsed.targets);
    next.equipmentTargets = parsed.targets;
    if (primary.weight == null) {
      next.weight = { acceptance: 'missing', value: null, suggestion: null };
      next.plannedWeightUnit = null;
    } else {
      next.weight = { acceptance: 'user_entered', value: primary.weight, suggestion: null };
      next.plannedWeightUnit = primary.unit;
    }
  }
  const exercises = day.exercises.map(copyExercise);
  exercises[exerciseIndex] = next;
  return replaceDay(review, dayIndex, { ...copyDay(day), exercises });
}

export function setExercisePlannedWeight(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  value: number | null,
): ProgramReview {
  const day = review.days[dayIndex];
  const exercise = day?.exercises[exerciseIndex];
  if (!day || !exercise) {
    return review;
  }
  if (value != null && (!Number.isFinite(value) || value < WEIGHT_MIN || value > WEIGHT_MAX)) {
    return review;
  }
  const next = copyExercise(exercise);
  if (value == null) {
    next.weight = { acceptance: 'missing', value: null, suggestion: null };
    next.plannedWeightUnit = null;
  } else {
    next.weight = { acceptance: 'user_entered', value, suggestion: null };
  }
  const exercises = day.exercises.map(copyExercise);
  exercises[exerciseIndex] = next;
  return replaceDay(review, dayIndex, { ...copyDay(day), exercises });
}

export function setExercisePlannedUnit(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  unit: 'lb' | 'kg' | null,
): ProgramReview {
  const day = review.days[dayIndex];
  const exercise = day?.exercises[exerciseIndex];
  if (!day || !exercise) {
    return review;
  }
  if ((unit === 'lb' || unit === 'kg') && exercise.weight?.value == null) {
    return review;
  }
  const next = copyExercise(exercise);
  next.plannedWeightUnit = unit;
  const exercises = day.exercises.map(copyExercise);
  exercises[exerciseIndex] = next;
  return replaceDay(review, dayIndex, { ...copyDay(day), exercises });
}

export function setImportedExerciseNotes(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  notes: string,
): ProgramReview {
  const next = setExerciseNotes(review, dayIndex, exerciseIndex, notes);
  const path = `days[${dayIndex}].exercises[${exerciseIndex}].notes`;
  const issues = next.issues.filter((issue) => !(issue.path === path && issue.code === 'note_too_long'));
  if (notes.length > NOTE_EDIT_MAX) {
    issues.push({
      path,
      code: 'note_too_long',
      message: 'Shorten this note to 280 characters or fewer before saving.',
    });
  }
  return { ...next, issues };
}

export function setExerciseNotes(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  notes: string | null,
): ProgramReview {
  const day = review.days[dayIndex];
  const exercise = day?.exercises[exerciseIndex];
  if (!day || !exercise) {
    return review;
  }
  const exercises = day.exercises.map(copyExercise);
  const next = copyExercise(exercise);
  next.notes = notes;
  exercises[exerciseIndex] = next;
  return replaceDay(review, dayIndex, { ...copyDay(day), exercises });
}

export function toImportPreview(review: ProgramReview): ImportPreview {
  return {
    programName: review.programName,
    days: review.days.map((day) => ({
      name: day.name,
      subtitle: day.subtitle,
      exercises: day.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        matchStatus: exercise.matchStatus,
        sets: { ...exercise.sets },
        repsMin: { ...exercise.repsMin },
        repsMax: { ...exercise.repsMax },
        restSeconds: { ...exercise.restSeconds },
        notes: exercise.notes,
        ...(exercise.weight ? { weight: { ...exercise.weight } } : {}),
        ...(exercise.plannedWeightUnit !== undefined ? { plannedWeightUnit: exercise.plannedWeightUnit } : {}),
      })),
    })),
    issues: review.issues.map((issue) => ({ ...issue })),
  };
}
