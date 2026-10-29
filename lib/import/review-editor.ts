import { MAX_DAYS, MAX_EXERCISES, MAX_EXERCISES_PER_DAY, REPS_MAX, REPS_MIN, SETS_MAX, SETS_MIN } from './limits.ts';
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
};

export type ReviewDay = {
  name: string;
  subtitle: string | null;
  exercises: ReviewExercise[];
};

export type ProgramReview = {
  origin: ProgramReviewOrigin;
  programName: string;
  days: ReviewDay[];
  issues: ImportPreviewIssue[];
};

export type ReviewNumberField = 'sets' | 'repsMin' | 'repsMax';

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
  };
}

function copyDay(day: ReviewDay): ReviewDay {
  return {
    name: day.name,
    subtitle: day.subtitle,
    exercises: day.exercises.map(copyExercise),
  };
}

export function createProgramReview(input: {
  origin: ProgramReviewOrigin;
  programName: string;
  days: readonly ReviewDay[];
  issues?: readonly ImportPreviewIssue[];
}): ProgramReview {
  return {
    origin: input.origin,
    programName: input.programName,
    days: input.days.map(copyDay),
    issues: (input.issues ?? []).map((issue) => ({ ...issue })),
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

function rangeFor(field: ReviewNumberField): { min: number; max: number } {
  if (field === 'sets') {
    return { min: SETS_MIN, max: SETS_MAX };
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
      })),
    })),
    issues: review.issues.map((issue) => ({ ...issue })),
  };
}
