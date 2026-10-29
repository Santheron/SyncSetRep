import { createProgramReview, type ProgramReview, type ReviewExercise } from './review-editor.ts';

// A saved routine loaded for the shared editor.
// The draft keeps the stored day and exercise ids. Editing the review does not
// change this object, those ids, or workout history.

export const DAY_NOT_IN_ROUTINE_MESSAGE =
  'That day is not in this routine. Nothing was changed.';

export const DRAFT_ID_MESSAGE = 'Choose a saved routine. Nothing was changed.';

export const DRAFT_LOADING_MESSAGE = 'This routine is still loading. Nothing was changed.';

const ID_LIMIT = 9223372036854775807n;

export type ProgramDraftExercise = {
  id: string;
  exerciseId: string;
  name: string;
  order: number;
  targetSets: number | null;
  minReps: number | null;
  maxReps: number | null;
  notes: string | null;
};

export type ProgramDraftDay = {
  id: string;
  name: string;
  subtitle: string | null;
  dayOrder: number;
  exercises: ProgramDraftExercise[];
};

export type ProgramDraft = {
  programId: string;
  name: string;
  isActive: boolean;
  days: ProgramDraftDay[];
};

export type DraftIdentity = {
  programId: string;
  dayIds: string[];
  exerciseRowIds: string[];
  exerciseIds: string[];
};

export function acceptedDraftId(value: string | undefined): value is string {
  if (!value || !/^[1-9][0-9]*$/.test(value) || value.length > 19) {
    return false;
  }
  try {
    const parsed = BigInt(value);
    return parsed >= 1n && parsed <= ID_LIMIT;
  } catch {
    return false;
  }
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function wholeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value) && value.length <= 15) {
    return Number(value);
  }
  return null;
}

function enteredNumber(value: number | null): ReviewExercise['sets'] {
  if (value == null) {
    return { acceptance: 'missing', value: null };
  }
  return { acceptance: 'user_entered', value };
}

export function draftIdentity(draft: ProgramDraft): DraftIdentity {
  return {
    programId: draft.programId,
    dayIds: draft.days.map((day) => day.id),
    exerciseRowIds: draft.days.flatMap((day) => day.exercises.map((exercise) => exercise.id)),
    exerciseIds: draft.days.flatMap((day) => day.exercises.map((exercise) => exercise.exerciseId)),
  };
}

export function reviewFromProgramDraft(draft: ProgramDraft): ProgramReview {
  return createProgramReview({
    origin: 'manual',
    programName: draft.name,
    days: draft.days.map((day) => ({
      name: day.name,
      subtitle: day.subtitle,
      exercises: day.exercises.map((exercise) => ({
        source: 'manual' as const,
        sourceName: exercise.name,
        exerciseId: exercise.exerciseId,
        matchStatus: 'manual' as const,
        sets: enteredNumber(exercise.targetSets),
        repsMin: enteredNumber(exercise.minReps),
        repsMax: enteredNumber(exercise.maxReps),
        restSeconds: { acceptance: 'missing' as const, value: null },
        notes: exercise.notes,
      })),
    })),
  });
}

export function assembleProgramDraft(input: {
  programId: string;
  name: string;
  isActive: boolean;
  focusDayId?: string;
  days: readonly {
    id: string;
    name: string;
    subtitle: string | null;
    dayOrder: number;
  }[];
  exercises: readonly {
    id: string;
    programDayId: string;
    exerciseId: string;
    name: string;
    order: number;
    targetSets: number | null;
    minReps: number | null;
    maxReps: number | null;
    notes: string | null;
  }[];
}): { ok: true; draft: ProgramDraft; focusDayIndex: number } | { ok: false; error: string } {
  const days = [...input.days].sort((left, right) => left.dayOrder - right.dayOrder || left.id.localeCompare(right.id));
  const draft: ProgramDraft = {
    programId: input.programId,
    name: input.name,
    isActive: input.isActive,
    days: days.map((day) => ({
      id: day.id,
      name: day.name,
      subtitle: textOrNull(day.subtitle),
      dayOrder: day.dayOrder,
      exercises: input.exercises
        .filter((exercise) => exercise.programDayId === day.id)
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
        .map((exercise) => ({
          id: exercise.id,
          exerciseId: exercise.exerciseId,
          name: exercise.name,
          order: exercise.order,
          targetSets: exercise.targetSets,
          minReps: exercise.minReps,
          maxReps: exercise.maxReps,
          notes: textOrNull(exercise.notes),
        })),
    })),
  };
  if (input.focusDayId == null) {
    return { ok: true, draft, focusDayIndex: 0 };
  }
  const focusDayIndex = draft.days.findIndex((day) => day.id === input.focusDayId);
  if (focusDayIndex < 0) {
    return { ok: false, error: DAY_NOT_IN_ROUTINE_MESSAGE };
  }
  return { ok: true, draft, focusDayIndex };
}

export function readDraftNumber(value: unknown): number | null {
  return wholeNumber(value);
}

export function readDraftText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
