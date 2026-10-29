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
import { toSavePayload, type SaveImportedProgramPayload } from './save-payload.ts';

// Manual routines use the same review state as an import preview.
// They do not call a model or consume an import quota.
// An additional routine stays on save_imported_program.
// The first routine uses save_owned_program only when that call is supplied.
// Neither path creates a starter program.

export const FIRST_PROGRAM_NOTICE =
  'This routine would become your current program. This build will not save it until program setup is reviewed. No starter program is created.';

export const FIRST_PROGRAM_UNAVAILABLE_MESSAGE =
  'Saving your first routine stays off until program setup is reviewed. Nothing was saved, and no starter program was created.';

export const ALREADY_CURRENT_PROGRAM_MESSAGE =
  'You already have a current program. Nothing was saved.';

export const MANUAL_SAVED_INACTIVE_MESSAGE =
  'Saved. This routine is not your current program.';

export const MANUAL_SAVED_CURRENT_MESSAGE = 'Saved. This routine is your current program.';

export const MANUAL_SAVE_ONCE_MESSAGE = 'This screen will not save this routine again.';

export const VIEW_SAVED_PROGRAMS_LABEL = 'View saved programs';

export const MANUAL_SIGN_IN_SAVE_MESSAGE = 'Sign in before saving a routine. Nothing was saved.';

export const MANUAL_SIGN_IN_LIST_MESSAGE = 'Sign in to see your saved routines.';

export const MANUAL_SIGN_IN_SWITCH_MESSAGE =
  'Sign in before choosing a current program. Nothing was changed.';

export const UNFINISHED_WORKOUT_SWITCH_MESSAGE =
  'An unfinished workout stays on its original day. Completed workouts stay saved.';

export const USE_ROUTINE_LABEL = 'Use this routine';

export const KEEP_CURRENT_PROGRAM_LABEL = 'Keep the current program';

export const MANUAL_SETS_MESSAGE = `Enter sets from ${SETS_MIN} through ${SETS_MAX}.`;

export const MANUAL_REPS_MESSAGE = `Enter reps from ${REPS_MIN} through ${REPS_MAX}.`;

export const ADD_DAY_LABEL = 'Add day';
export const ADD_EXERCISE_LABEL = 'Add exercise';
export const SAVE_ROUTINE_LABEL = 'Save routine';
export const SAVE_FIRST_ROUTINE_LABEL = 'Save and use this routine';
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

export type OwnedProgramSaveRpc = (args: {
  p_program: SaveImportedProgramPayload;
  p_make_current: true;
}) => Promise<{ data: unknown; error: { message?: string | null } | null }>;

export type SavedProgramListItem = {
  id: string;
  name: string;
  statusLabel: 'Current program' | 'Saved program';
  offerSwitch: boolean;
};

export type ProgramSwitchPrompt = {
  programId: string;
  title: string;
  body: string;
  confirmLabel: typeof USE_ROUTINE_LABEL;
  cancelLabel: typeof KEEP_CURRENT_PROGRAM_LABEL;
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
    offerSwitch: program.isActive === false,
  }));
}

export function requestProgramSwitch(
  programs: readonly SavedProgramSummary[],
  programId: string,
): { ok: true; prompt: ProgramSwitchPrompt } | { ok: false; error: string } {
  const program = programs.find((item) => item.id === programId);

  if (!program) {
    return { ok: false, error: 'That saved program is not in this list. Nothing was changed.' };
  }

  if (program.isActive) {
    return {
      ok: false,
      error: 'That program is already your current program. Nothing was changed.',
    };
  }

  return {
    ok: true,
    prompt: {
      programId: program.id,
      title: `Use ${program.name} as your current program?`,
      body: UNFINISHED_WORKOUT_SWITCH_MESSAGE,
      confirmLabel: USE_ROUTINE_LABEL,
      cancelLabel: KEEP_CURRENT_PROGRAM_LABEL,
    },
  };
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

function ownedProgramId(data: unknown): string | null {
  if (typeof data === 'number' && Number.isSafeInteger(data) && data > 0) {
    return String(data);
  }
  if (typeof data === 'string' && /^[1-9][0-9]*$/.test(data)) {
    return data;
  }
  return null;
}

function ownedSaveError(message: string | null | undefined): string {
  const text = message ?? '';
  if (text.includes('Not authenticated')) {
    return MANUAL_SIGN_IN_SAVE_MESSAGE;
  }
  if (text.includes('active_program_exists')) {
    return ALREADY_CURRENT_PROGRAM_MESSAGE;
  }
  return 'Could not save this routine. Nothing was saved.';
}

export async function saveManualProgram(
  review: ProgramReview,
  options: {
    userId: string;
    programs: readonly SavedProgramSummary[];
    rpc: ImportSaveRpc;
    ownedRpc?: OwnedProgramSaveRpc;
  },
): Promise<SaveImportedProgramResult> {
  if (!hasCurrentProgram(options.programs)) {
    const payload = toSavePayload(toImportPreview(review), options.userId, {
      hasActiveProgram: true,
    });
    if (!payload.ok) {
      return payload;
    }
    if (!options.ownedRpc) {
      return { ok: false, errors: [FIRST_PROGRAM_UNAVAILABLE_MESSAGE] };
    }
    let response: { data: unknown; error: { message?: string | null } | null };
    try {
      response = await options.ownedRpc({
        p_program: payload.payload,
        p_make_current: true,
      });
    } catch {
      return { ok: false, errors: ['Could not save this routine. Nothing was saved.'] };
    }
    if (response.error) {
      return { ok: false, errors: [ownedSaveError(response.error.message)] };
    }
    const programId = ownedProgramId(response.data);
    if (programId == null) {
      return { ok: false, errors: ['Could not save this routine. Nothing was saved.'] };
    }
    return { ok: true, programId };
  }
  return saveImportedProgram(toImportPreview(review), {
    userId: options.userId,
    hasActiveProgram: true,
    rpc: options.rpc,
  });
}
