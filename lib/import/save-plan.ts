import { PERSIST_REST_SECONDS, SUBTITLE_REQUIRED } from './flags.ts';
import {
  DAY_NAME_MAX,
  MAX_DAYS,
  MAX_EXERCISES,
  MAX_EXERCISES_PER_DAY,
  NOTE_EDIT_MAX,
  PROGRAM_NAME_MAX,
  REPS_MAX,
  REPS_MIN,
  REST_MAX,
  REST_MIN,
  SETS_MAX,
  SETS_MIN,
} from './limits.ts';

export type Acceptance = 'extracted' | 'accepted_suggestion' | 'user_entered' | 'missing';

export type PreviewMatchStatus = 'matched' | 'ambiguous' | 'unmatched' | 'manual';

export type PreviewNumber = {
  acceptance: Acceptance;
  /** Accepted number. The model's suggestion is never written. */
  value: number | null;
  suggestion?: number | null;
};

export type ImportPreviewExercise = {
  exerciseId: string | number | null;
  matchStatus: PreviewMatchStatus;
  sets: PreviewNumber;
  repsMin: PreviewNumber;
  repsMax: PreviewNumber;
  restSeconds: PreviewNumber;
  notes: string | null;
};

export type ImportPreviewDay = {
  name: string;
  subtitle: string | null;
  exercises: ImportPreviewExercise[];
};

export type ImportPreviewIssue = {
  path: string;
  code: string;
  message?: string;
};

export type ImportPreview = {
  programName: string;
  days: ImportPreviewDay[];
  issues?: readonly ImportPreviewIssue[];
};

export type ImportInsertPlanOptions = {
  hasActiveProgram: boolean;
  persistRestSeconds?: boolean;
  subtitleRequired?: boolean;
  /** When true, refuse instead of inventing a slug. Default false sends slug null. */
  slugRequired?: boolean;
};

export type ImportProgramInsert = {
  user_id: string;
  name: string;
  slug: null;
  is_active: false;
};

export type ImportProgramExerciseInsert = {
  exercise_id: string;
  exercise_order: number;
  target_sets: number;
  min_reps: number;
  max_reps: number;
  notes: string | null;
  rest_seconds?: number;
};

export type ImportProgramDayInsert = {
  /** Filled with the new programs.id after insert. This plan does not insert the row. */
  program_id: null;
  name: string;
  subtitle: string | null;
  day_order: number;
  program_exercises: ImportProgramExerciseInsert[];
};

export type ImportInsertPlan = {
  program: ImportProgramInsert;
  days: ImportProgramDayInsert[];
};

export type ImportInsertPlanResult =
  | { ok: true; plan: ImportInsertPlan }
  | { ok: false; errors: string[] };

export const IMPORT_NO_ACTIVE_PROGRAM_MESSAGE =
  'Import can be saved only while you already have a current program. Nothing was saved.';

export const IMPORT_DUPLICATE_EXERCISE_MESSAGE =
  'This day lists the same exercise twice. Choose a different exercise or remove one. Nothing was saved.';

export const IMPORT_UNRESOLVED_EXERCISE_MESSAGE =
  'Choose a catalog exercise for every unresolved movement before saving. Nothing was saved.';

export const IMPORT_UNACCEPTED_SETS_MESSAGE =
  'Enter sets from 1 through 12 for every exercise before saving. Nothing was saved.';

export const IMPORT_UNACCEPTED_REPS_MESSAGE =
  'Enter rep min and max from 1 through 100 for every exercise before saving. Nothing was saved.';

export const IMPORT_REST_RANGE_MESSAGE =
  'Rest must be from 0 through 600 seconds. Nothing was saved.';

export const IMPORT_BLANK_SUBTITLE_MESSAGE =
  'Enter a subtitle for every day before saving. Nothing was saved.';

export const IMPORT_PROGRAM_NAME_MESSAGE =
  'Enter a program name of 1 to 80 characters before saving. Nothing was saved.';

export const IMPORT_DAY_NAME_MESSAGE =
  'Enter a day name of 1 to 60 characters before saving. Nothing was saved.';

export const IMPORT_NOTE_MESSAGE =
  'Shorten notes to 280 characters or fewer before saving. Nothing was saved.';

export const IMPORT_ISSUE_MESSAGE =
  'Resolve the highlighted names and notes before saving. Nothing was saved.';

export const IMPORT_SLUG_MESSAGE =
  'Program slug is required in this database, and this import does not invent one. Nothing was saved.';

export const IMPORT_CAPACITY_MESSAGE =
  'This import has more days or exercises than can be saved. Nothing was saved.';

export const IMPORT_EMPTY_DAYS_MESSAGE = 'Add at least one day before saving. Nothing was saved.';

export const IMPORT_SIGN_IN_MESSAGE = 'Sign in before saving an import. Nothing was saved.';

const BLOCKING_ISSUE_CODES = new Set(['note_too_long', 'empty_name', 'empty_program_name']);

export function assertImportStaysInactive(program: { is_active: boolean }): void {
  if (program.is_active !== false) {
    throw new Error('Import programs must be saved with is_active false.');
  }
}

function push(errors: string[], message: string) {
  if (!errors.includes(message)) {
    errors.push(message);
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function catalogId(value: string | number | null): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

function integerInRange(value: number | null, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function acceptedInt(field: PreviewNumber, min: number, max: number): number | null {
  const accepted =
    field.acceptance === 'extracted' ||
    field.acceptance === 'accepted_suggestion' ||
    field.acceptance === 'user_entered';
  if (!accepted || !integerInRange(field.value, min, max)) {
    return null;
  }
  return field.value;
}

function readRest(field: PreviewNumber, persist: boolean, errors: string[]): number | undefined {
  if (typeof field.value === 'number' && !integerInRange(field.value, REST_MIN, REST_MAX)) {
    push(errors, IMPORT_REST_RANGE_MESSAGE);
    return undefined;
  }
  const accepted =
    field.acceptance === 'extracted' ||
    field.acceptance === 'accepted_suggestion' ||
    field.acceptance === 'user_entered';
  if (!accepted || !integerInRange(field.value, REST_MIN, REST_MAX)) {
    return undefined;
  }
  if (!persist) {
    return undefined;
  }
  return field.value;
}

export function buildImportInsertPlan(
  edited: ImportPreview,
  userId: string,
  options: ImportInsertPlanOptions,
): ImportInsertPlanResult {
  const errors: string[] = [];
  const persistRest = options.persistRestSeconds ?? PERSIST_REST_SECONDS;
  const subtitleRequired = options.subtitleRequired ?? SUBTITLE_REQUIRED;
  const slugRequired = options.slugRequired ?? false;

  if (options.hasActiveProgram !== true) {
    push(errors, IMPORT_NO_ACTIVE_PROGRAM_MESSAGE);
  }
  if (typeof userId !== 'string' || userId.trim() === '') {
    push(errors, IMPORT_SIGN_IN_MESSAGE);
  }
  if (slugRequired) {
    push(errors, IMPORT_SLUG_MESSAGE);
  }

  const programName = typeof edited.programName === 'string' ? edited.programName.trim() : '';
  if (programName.length < 1 || programName.length > PROGRAM_NAME_MAX) {
    push(errors, IMPORT_PROGRAM_NAME_MESSAGE);
  }

  if ((edited.issues ?? []).some((issue) => BLOCKING_ISSUE_CODES.has(issue.code))) {
    push(errors, IMPORT_ISSUE_MESSAGE);
  }

  const days = Array.isArray(edited.days) ? edited.days : [];
  if (days.length === 0) {
    push(errors, IMPORT_EMPTY_DAYS_MESSAGE);
  }
  if (days.length > MAX_DAYS) {
    push(errors, IMPORT_CAPACITY_MESSAGE);
  }

  let total = 0;
  const dayRows: ImportProgramDayInsert[] = [];

  days.forEach((day, dayIndex) => {
    const name = typeof day.name === 'string' ? day.name.trim() : '';
    if (name.length < 1 || name.length > DAY_NAME_MAX) {
      push(errors, IMPORT_DAY_NAME_MESSAGE);
    }
    const subtitle = emptyToNull(day.subtitle);
    if (subtitleRequired && subtitle == null) {
      push(errors, IMPORT_BLANK_SUBTITLE_MESSAGE);
    }

    const exercises = Array.isArray(day.exercises) ? day.exercises : [];
    total += exercises.length;
    if (exercises.length > MAX_EXERCISES_PER_DAY) {
      push(errors, IMPORT_CAPACITY_MESSAGE);
    }

    const seen = new Set<string>();
    const exerciseRows: ImportProgramExerciseInsert[] = [];

    exercises.forEach((exercise, exerciseIndex) => {
      const id = catalogId(exercise.exerciseId);
      const confirmed =
        (exercise.matchStatus === 'matched' || exercise.matchStatus === 'manual') && id != null;
      if (!confirmed || id == null) {
        push(errors, IMPORT_UNRESOLVED_EXERCISE_MESSAGE);
      } else if (seen.has(id)) {
        push(errors, IMPORT_DUPLICATE_EXERCISE_MESSAGE);
      } else {
        seen.add(id);
      }

      const sets = acceptedInt(exercise.sets, SETS_MIN, SETS_MAX);
      const repsMin = acceptedInt(exercise.repsMin, REPS_MIN, REPS_MAX);
      const repsMax = acceptedInt(exercise.repsMax, REPS_MIN, REPS_MAX);
      if (sets == null) {
        push(errors, IMPORT_UNACCEPTED_SETS_MESSAGE);
      }
      if (repsMin == null || repsMax == null) {
        push(errors, IMPORT_UNACCEPTED_REPS_MESSAGE);
      }

      const notes = emptyToNull(exercise.notes);
      if (notes != null && notes.length > NOTE_EDIT_MAX) {
        push(errors, IMPORT_NOTE_MESSAGE);
      }

      const rest = readRest(exercise.restSeconds, persistRest, errors);
      if (!confirmed || id == null || sets == null || repsMin == null || repsMax == null) {
        return;
      }
      if (notes != null && notes.length > NOTE_EDIT_MAX) {
        return;
      }

      const row: ImportProgramExerciseInsert = {
        exercise_id: id,
        exercise_order: exerciseIndex + 1,
        target_sets: sets,
        min_reps: repsMin,
        max_reps: repsMax,
        notes,
      };
      if (typeof rest === 'number') {
        row.rest_seconds = rest;
      }
      exerciseRows.push(row);
    });

    dayRows.push({
      program_id: null,
      name,
      subtitle,
      day_order: dayIndex + 1,
      program_exercises: exerciseRows,
    });
  });

  if (total > MAX_EXERCISES) {
    push(errors, IMPORT_CAPACITY_MESSAGE);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const program: ImportProgramInsert = {
    user_id: userId.trim(),
    name: programName,
    slug: null,
    is_active: false,
  };
  assertImportStaysInactive(program);

  return {
    ok: true,
    plan: {
      program,
      days: dayRows,
    },
  };
}
