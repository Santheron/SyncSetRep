import {
  DAY_NAME_MAX,
  MAX_DAYS,
  NOTE_EDIT_MAX,
  PROGRAM_NAME_MAX,
  REPS_MAX,
  REPS_MIN,
  SETS_MAX,
  SETS_MIN,
  TEXT_FIELD_MAX,
} from './limits.ts';
import {
  addDay,
  addManualExercise,
  chooseExercise,
  moveDay,
  moveExercise,
  removeDay,
  removeExercise,
  renameDay,
  renameProgram,
  setDaySubtitle,
  setExerciseNotes,
  setUserNumber,
  toImportPreview,
  type ProgramReview,
  type ReviewNumberField,
} from './review-editor.ts';
import {
  saveImportedProgram,
  type ImportSaveRpc,
  type SaveImportedProgramResult,
} from './save-imported-program.ts';
import { IMPORT_CAPACITY_MESSAGE } from './save-plan.ts';

// Manual routines use the same review state as an import preview.
// They do not call a model or consume an import quota.
// Saving stays on save_imported_program and does not create a starter program.

export const MANUAL_NO_ACTIVE_PROGRAM_MESSAGE =
  'A new routine can be saved only while you already have a current program. Nothing was saved, and no starter program was created.';

export const MANUAL_SAVED_INACTIVE_MESSAGE =
  'Saved. This routine is not your current program.';

export const MANUAL_SETS_MESSAGE = `Enter sets from ${SETS_MIN} through ${SETS_MAX}.`;

export const MANUAL_REPS_MESSAGE = `Enter reps from ${REPS_MIN} through ${REPS_MAX}.`;

export const ADD_DAY_LABEL = 'Add day';
export const ADD_EXERCISE_LABEL = 'Add exercise';
export const SAVE_ROUTINE_LABEL = 'Save routine';
export const PROGRAM_NAME_LABEL = 'Program name';
export const CHOOSE_EXERCISE_LABEL = 'Choose exercise';

export type SavedProgramSummary = {
  id: string;
  name: string;
  isActive: boolean;
};

export type OwnedProgramRow = {
  id: number | string;
  name: string;
  is_active: boolean;
};

export type CatalogExercise = {
  id: string;
  name: string;
};

export type SavedProgramListItem = {
  id: string;
  name: string;
  statusLabel: 'Current program' | 'Saved program';
  canActivate: false;
};

export type ManualEdit =
  | { type: 'rename-program'; name: string }
  | { type: 'add-day' }
  | { type: 'remove-day'; dayIndex: number }
  | { type: 'rename-day'; dayIndex: number; name: string }
  | { type: 'set-subtitle'; dayIndex: number; subtitle: string }
  | { type: 'move-day'; dayIndex: number; direction: 'up' | 'down' }
  | { type: 'add-exercise'; dayIndex: number }
  | { type: 'remove-exercise'; dayIndex: number; exerciseIndex: number }
  | { type: 'move-exercise'; dayIndex: number; exerciseIndex: number; direction: 'up' | 'down' }
  | { type: 'choose-exercise'; dayIndex: number; exerciseIndex: number; exerciseId: string }
  | { type: 'set-notes'; dayIndex: number; exerciseIndex: number; notes: string };

export type ManualEditResult = {
  review: ProgramReview;
  error: string | null;
};

export function toSavedPrograms(rows: readonly OwnedProgramRow[]): SavedProgramSummary[] {
  return rows.map((row) => ({
    id: String(row.id),
    name: row.name,
    isActive: row.is_active === true,
  }));
}

export function hasCurrentProgram(programs: readonly SavedProgramSummary[]): boolean {
  return programs.some((program) => program.isActive);
}

export function savedProgramListItems(
  programs: readonly SavedProgramSummary[],
): SavedProgramListItem[] {
  return programs.map((program) => ({
    id: program.id,
    name: program.name,
    statusLabel: program.isActive ? 'Current program' : 'Saved program',
    canActivate: false,
  }));
}

export function filterCatalog(
  catalog: readonly CatalogExercise[],
  query: string,
): CatalogExercise[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...catalog];
  }
  return catalog.filter((exercise) => exercise.name.toLowerCase().includes(needle));
}

export function dayNameLabel(dayNumber: number): string {
  return `Day ${dayNumber} name`;
}

export function daySubtitleLabel(dayNumber: number): string {
  return `Day ${dayNumber} subtitle`;
}

export function removeDayLabel(dayNumber: number): string {
  return `Remove day ${dayNumber}`;
}

export function moveDayLabel(dayNumber: number, direction: 'up' | 'down'): string {
  return direction === 'up' ? `Move day ${dayNumber} up` : `Move day ${dayNumber} down`;
}

export function addExerciseLabel(dayNumber: number): string {
  return `Add exercise to day ${dayNumber}`;
}

export function removeExerciseLabel(dayNumber: number, exerciseNumber: number): string {
  return `Remove exercise ${exerciseNumber} from day ${dayNumber}`;
}

export function moveExerciseLabel(
  dayNumber: number,
  exerciseNumber: number,
  direction: 'up' | 'down',
): string {
  return direction === 'up'
    ? `Move exercise ${exerciseNumber} up on day ${dayNumber}`
    : `Move exercise ${exerciseNumber} down on day ${dayNumber}`;
}

export function chooseExerciseLabel(dayNumber: number, exerciseNumber: number): string {
  return `Choose exercise ${exerciseNumber} on day ${dayNumber}`;
}

export function setsLabel(dayNumber: number, exerciseNumber: number): string {
  return `Sets for exercise ${exerciseNumber} on day ${dayNumber}`;
}

export function repsMinLabel(dayNumber: number, exerciseNumber: number): string {
  return `Minimum reps for exercise ${exerciseNumber} on day ${dayNumber}`;
}

export function repsMaxLabel(dayNumber: number, exerciseNumber: number): string {
  return `Maximum reps for exercise ${exerciseNumber} on day ${dayNumber}`;
}

export function notesLabel(dayNumber: number, exerciseNumber: number): string {
  return `Notes for exercise ${exerciseNumber} on day ${dayNumber}`;
}

export function exerciseChoiceText(
  exerciseId: string | number | null,
  catalog: readonly CatalogExercise[],
): string {
  if (exerciseId == null || exerciseId === '') {
    return CHOOSE_EXERCISE_LABEL;
  }
  const id = String(exerciseId);
  const match = catalog.find((exercise) => exercise.id === id);
  return match ? match.name : `Exercise ${id}`;
}

function targetIndex(index: number, direction: 'up' | 'down'): number {
  return direction === 'up' ? index - 1 : index + 1;
}

export function applyManualEdit(review: ProgramReview, edit: ManualEdit): ManualEditResult {
  if (edit.type === 'rename-program') {
    return { review: renameProgram(review, edit.name.slice(0, PROGRAM_NAME_MAX)), error: null };
  }
  if (edit.type === 'add-day') {
    const next = addDay(review);
    if (next === review && review.days.length >= MAX_DAYS) {
      return { review, error: IMPORT_CAPACITY_MESSAGE };
    }
    return { review: next, error: null };
  }
  if (edit.type === 'remove-day') {
    return { review: removeDay(review, edit.dayIndex), error: null };
  }
  if (edit.type === 'rename-day') {
    return {
      review: renameDay(review, edit.dayIndex, edit.name.slice(0, DAY_NAME_MAX)),
      error: null,
    };
  }
  if (edit.type === 'set-subtitle') {
    return {
      review: setDaySubtitle(review, edit.dayIndex, edit.subtitle.slice(0, TEXT_FIELD_MAX)),
      error: null,
    };
  }
  if (edit.type === 'move-day') {
    return {
      review: moveDay(review, edit.dayIndex, targetIndex(edit.dayIndex, edit.direction)),
      error: null,
    };
  }
  if (edit.type === 'add-exercise') {
    const next = addManualExercise(review, edit.dayIndex);
    if (next === review) {
      return { review, error: IMPORT_CAPACITY_MESSAGE };
    }
    return { review: next, error: null };
  }
  if (edit.type === 'remove-exercise') {
    return {
      review: removeExercise(review, edit.dayIndex, edit.exerciseIndex),
      error: null,
    };
  }
  if (edit.type === 'move-exercise') {
    return {
      review: moveExercise(
        review,
        edit.dayIndex,
        edit.exerciseIndex,
        targetIndex(edit.exerciseIndex, edit.direction),
      ),
      error: null,
    };
  }
  if (edit.type === 'choose-exercise') {
    return {
      review: chooseExercise(review, edit.dayIndex, edit.exerciseIndex, edit.exerciseId),
      error: null,
    };
  }
  return {
    review: setExerciseNotes(review, edit.dayIndex, edit.exerciseIndex, edit.notes.slice(0, NOTE_EDIT_MAX)),
    error: null,
  };
}

export function applyManualNumber(
  review: ProgramReview,
  input: {
    dayIndex: number;
    exerciseIndex: number;
    field: ReviewNumberField;
    raw: string;
  },
): ManualEditResult {
  const raw = input.raw.trim();
  if (raw === '') {
    return {
      review: setUserNumber(review, input.dayIndex, input.exerciseIndex, input.field, null),
      error: null,
    };
  }
  if (!/^[0-9]+$/.test(raw)) {
    return {
      review,
      error: input.field === 'sets' ? MANUAL_SETS_MESSAGE : MANUAL_REPS_MESSAGE,
    };
  }
  const value = Number(raw);
  const next = setUserNumber(review, input.dayIndex, input.exerciseIndex, input.field, value);
  if (next === review) {
    return {
      review,
      error: input.field === 'sets' ? MANUAL_SETS_MESSAGE : MANUAL_REPS_MESSAGE,
    };
  }
  return { review: next, error: null };
}

export async function saveManualProgram(
  review: ProgramReview,
  options: {
    userId: string;
    programs: readonly SavedProgramSummary[];
    rpc: ImportSaveRpc;
  },
): Promise<SaveImportedProgramResult> {
  if (!hasCurrentProgram(options.programs)) {
    return { ok: false, errors: [MANUAL_NO_ACTIVE_PROGRAM_MESSAGE] };
  }
  return saveImportedProgram(toImportPreview(review), {
    userId: options.userId,
    hasActiveProgram: true,
    rpc: options.rpc,
  });
}
