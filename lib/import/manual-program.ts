import {
  DAY_NAME_MAX,
  MAX_DAYS,
  MAX_EXERCISES,
  MAX_EXERCISES_PER_DAY,
  NOTE_EDIT_MAX,
  PROGRAM_NAME_MAX,
  REPS_MAX,
  REPS_MIN,
  SETS_MAX,
  SETS_MIN,
  SOURCE_NAME_MAX,
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
  nameUnsavedExercise,
  renameProgram,
  setDaySubtitle,
  setExerciseLoadMode,
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
import { IMPORT_BLANK_SUBTITLE_MESSAGE, IMPORT_CAPACITY_MESSAGE } from './save-plan.ts';
import { toSavePayload, type SaveImportedProgramPayload } from './save-payload.ts';
import { isLoadMode, type LoadMode } from '../load-mode.ts';
import {
  CUSTOM_EXERCISE_WRITES_ENABLED,
  normalizeExerciseName,
  type PlannedExercise,
} from './planned-exercises.ts';
import { SUBTITLE_REQUIRED } from './flags.ts';

// Manual routines use the same review state as an import preview.
// They do not call a model or consume an import quota.
// An additional routine uses save_imported_program only when that call is supplied.
// The first routine uses save_owned_program only when that call is supplied.
// Neither path creates a starter program.

export const FIRST_PROGRAM_NOTICE =
  'This routine would become your current program. This build will not save it until program setup is reviewed. No starter program is created.';

export const FIRST_PROGRAM_UNAVAILABLE_MESSAGE =
  'Saving your first routine stays off until program setup is reviewed. Nothing was saved, and no starter program was created.';

export const MANUAL_SAVE_UNAVAILABLE_MESSAGE =
  'Saving a routine stays off in this build. Nothing was saved.';

export const LOCAL_DAY_NOTICE =
  'Days and exercises update on this screen right away. Save routine is the only step that would store them, and saving stays off in this build.';

export const DAY_ADDED_LOCALLY_MESSAGE = 'Day added on this screen. Nothing has been saved.';

export const EDIT_DRAFT_NOTICE =
  'This is a local preview of a saved routine. You can rename days, change exercises, sets, reps, and notes here. Existing workout days, exercise definitions, and workout history stay as they are.';

export const EDIT_SAVE_BLOCKED_MESSAGE =
  'Saving edits stays off in this build. Nothing was changed.';

export const EDIT_SAVED_MESSAGE = 'Saved. Workout history was not changed.';

export const CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE =
  'Saving a custom exercise stays off in this build. Nothing was saved.';

export const EDIT_DAY_LABEL = 'Edit day';

export const EDIT_ROUTINE_LABEL = 'Edit routine';

export const ALREADY_CURRENT_PROGRAM_MESSAGE =
  'You already have a current program. Nothing was saved.';

export const MANUAL_SAVED_INACTIVE_MESSAGE =
  'Saved. This routine is not your current program.';

export const MANUAL_SAVED_CURRENT_MESSAGE = 'Saved. This routine is your current program.';

export const MANUAL_SAVE_ONCE_MESSAGE = 'This screen will not save this routine again.';

export const VIEW_SAVED_PROGRAMS_LABEL = 'View saved programs';

export const MANUAL_SIGN_IN_SAVE_MESSAGE = 'Sign in before saving a routine. Nothing was saved.';

export const MANUAL_CHOOSE_EXERCISE_MESSAGE =
  'Choose an exercise for every movement before saving. Nothing was saved.';

export const MANUAL_DUPLICATE_EXERCISE_MESSAGE =
  'This day lists the same exercise twice. Choose a different exercise or remove one. Nothing was saved.';

export const MANUAL_SETS_SAVE_MESSAGE =
  `Enter sets from ${SETS_MIN} through ${SETS_MAX} for every exercise before saving. Nothing was saved.`;

export const MANUAL_REPS_SAVE_MESSAGE =
  `Enter rep min and max from ${REPS_MIN} through ${REPS_MAX} for every exercise before saving. Nothing was saved.`;

export const MANUAL_REPS_ORDER_MESSAGE =
  'Enter a rep minimum that is less than or equal to the rep maximum. Nothing was saved.';

export const MANUAL_NAME_SAVE_MESSAGE =
  `Enter a program name of 1 to ${PROGRAM_NAME_MAX} characters before saving. Nothing was saved.`;

export const MANUAL_DAY_NAME_SAVE_MESSAGE =
  `Enter a day name of 1 to ${DAY_NAME_MAX} characters before saving. Nothing was saved.`;

export const MANUAL_EXERCISE_NAME_SAVE_MESSAGE =
  `Enter an exercise name of 1 to ${PROGRAM_NAME_MAX} characters before saving. Nothing was saved.`;

export const MANUAL_SUBTITLE_SAVE_MESSAGE =
  `Enter a subtitle of ${TEXT_FIELD_MAX} characters or fewer before saving. Nothing was saved.`;

export const MANUAL_NOTE_SAVE_MESSAGE =
  `Shorten notes to ${NOTE_EDIT_MAX} characters or fewer before saving. Nothing was saved.`;

export const MANUAL_CAPACITY_SAVE_MESSAGE =
  'This routine has more days or exercises than can be saved. Nothing was saved.';

export const MANUAL_EMPTY_DAYS_MESSAGE = 'Add at least one day before saving. Nothing was saved.';

export const MANUAL_LOAD_MODE_MESSAGE =
  'Choose bodyweight, added weight, assisted, or external tracking for every exercise. Nothing was saved.';

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
  muscle?: string | null;
  equipment?: string | null;
  saved?: boolean;
};

export type CatalogFilters = {
  muscle?: string | null;
  equipment?: string | null;
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
  | { type: 'preview-exercise'; dayIndex: number; exerciseIndex: number; name: string }
  | { type: 'set-notes'; dayIndex: number; exerciseIndex: number; notes: string }
  | { type: 'set-load-mode'; dayIndex: number; exerciseIndex: number; loadMode: LoadMode | null };

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
  filters?: CatalogFilters,
): CatalogExercise[] {
  const needle = query.trim().toLowerCase();
  const muscle = filters?.muscle ?? null;
  const equipment = filters?.equipment ?? null;
  return catalog.filter((exercise) => {
    if (muscle && exercise.muscle !== muscle) {
      return false;
    }
    if (equipment && exercise.equipment !== equipment) {
      return false;
    }
    if (!needle) {
      return true;
    }
    return exercise.name.toLowerCase().includes(needle);
  });
}

export function mergeExerciseChoices(
  library: readonly CatalogExercise[],
  planned: readonly PlannedExercise[],
): CatalogExercise[] {
  const savedNames = new Set(library.map((exercise) => normalizeExerciseName(exercise.name)));
  const choices: CatalogExercise[] = library.map((exercise) => ({
    ...exercise,
    saved: true,
  }));
  for (const exercise of planned) {
    if (savedNames.has(normalizeExerciseName(exercise.name))) {
      continue;
    }
    choices.push({
      id: `planned:${normalizeExerciseName(exercise.name).replace(/ /g, '-')}`,
      name: exercise.name,
      muscle: exercise.muscle,
      equipment: exercise.equipment,
      saved: false,
    });
  }
  choices.sort((left, right) => left.name.localeCompare(right.name));
  return choices;
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
  sourceName?: string | null,
): string {
  if ((exerciseId == null || exerciseId === '') && sourceName && sourceName.trim() !== '') {
    return sourceName.trim();
  }
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
  if (edit.type === 'set-load-mode') {
    return {
      review: setExerciseLoadMode(review, edit.dayIndex, edit.exerciseIndex, edit.loadMode),
      error: null,
    };
  }
  if (edit.type === 'preview-exercise') {
    return {
      review: nameUnsavedExercise(
        review,
        edit.dayIndex,
        edit.exerciseIndex,
        edit.name.slice(0, SOURCE_NAME_MAX),
      ),
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

function pushMessage(errors: string[], message: string) {
  if (!errors.includes(message)) {
    errors.push(message);
  }
}

function acceptedManualInt(
  field: { acceptance: string; value: number | null },
  min: number,
  max: number,
): number | null {
  const accepted =
    field.acceptance === 'extracted' ||
    field.acceptance === 'accepted_suggestion' ||
    field.acceptance === 'user_entered';
  if (!accepted || typeof field.value !== 'number' || !Number.isInteger(field.value)) {
    return null;
  }
  if (field.value < min || field.value > max) {
    return null;
  }
  return field.value;
}

/** A database exercise id that save_imported_program can store. Planned and custom names are not ids. */
export function storedExerciseId(value: string | number | null | undefined): string | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) {
      return null;
    }
    text = String(value);
  } else if (typeof value === 'string') {
    text = value;
  } else {
    return null;
  }
  if (!/^[1-9][0-9]*$/.test(text) || text.length > 15) {
    return null;
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }
  return text;
}

function customExerciseName(value: string | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const name = value.trim();
  if (name.length < 1 || name.length > PROGRAM_NAME_MAX) {
    return null;
  }
  if (normalizeExerciseName(name) === '') {
    return null;
  }
  return name;
}

export function routineUsesStoredExerciseIds(review: ProgramReview): boolean {
  return review.days.every((day) =>
    day.exercises.every((exercise) => storedExerciseId(exercise.exerciseId) != null),
  );
}

export function validateManualRoutine(
  review: ProgramReview,
  options?: { subtitleRequired?: boolean },
): { ok: true } | { ok: false; errors: string[] } {
  const subtitleRequired = options?.subtitleRequired ?? SUBTITLE_REQUIRED;
  const errors: string[] = [];
  const programName = typeof review.programName === 'string' ? review.programName.trim() : '';
  if (programName.length < 1 || programName.length > PROGRAM_NAME_MAX) {
    pushMessage(errors, MANUAL_NAME_SAVE_MESSAGE);
  }

  const days = Array.isArray(review.days) ? review.days : [];
  if (days.length === 0) {
    pushMessage(errors, MANUAL_EMPTY_DAYS_MESSAGE);
  }
  if (days.length > MAX_DAYS) {
    pushMessage(errors, MANUAL_CAPACITY_SAVE_MESSAGE);
  }

  let total = 0;
  for (const day of days) {
    const name = typeof day.name === 'string' ? day.name.trim() : '';
    if (name.length < 1 || name.length > DAY_NAME_MAX) {
      pushMessage(errors, MANUAL_DAY_NAME_SAVE_MESSAGE);
    }
    const subtitle = typeof day.subtitle === 'string' ? day.subtitle.trim() : '';
    if (subtitleRequired && subtitle.length === 0) {
      pushMessage(errors, IMPORT_BLANK_SUBTITLE_MESSAGE);
    }
    if (subtitle.length > TEXT_FIELD_MAX) {
      pushMessage(errors, MANUAL_SUBTITLE_SAVE_MESSAGE);
    }

    const exercises = Array.isArray(day.exercises) ? day.exercises : [];
    total += exercises.length;
    if (exercises.length > MAX_EXERCISES_PER_DAY) {
      pushMessage(errors, MANUAL_CAPACITY_SAVE_MESSAGE);
    }

    const seen = new Set<string>();
    for (const exercise of exercises) {
      const storedId = storedExerciseId(exercise.exerciseId);
      const named = customExerciseName(exercise.sourceName);
      if (storedId != null) {
        const key = `id:${storedId}`;
        if (seen.has(key)) {
          pushMessage(errors, MANUAL_DUPLICATE_EXERCISE_MESSAGE);
        } else {
          seen.add(key);
        }
      } else if (named != null) {
        const key = `name:${normalizeExerciseName(named)}`;
        if (seen.has(key)) {
          pushMessage(errors, MANUAL_DUPLICATE_EXERCISE_MESSAGE);
        } else {
          seen.add(key);
        }
      } else if (typeof exercise.sourceName === 'string' && exercise.sourceName.trim() !== '') {
        pushMessage(errors, MANUAL_EXERCISE_NAME_SAVE_MESSAGE);
      } else {
        pushMessage(errors, MANUAL_CHOOSE_EXERCISE_MESSAGE);
      }

      const sets = acceptedManualInt(exercise.sets, SETS_MIN, SETS_MAX);
      const repsMin = acceptedManualInt(exercise.repsMin, REPS_MIN, REPS_MAX);
      const repsMax = acceptedManualInt(exercise.repsMax, REPS_MIN, REPS_MAX);
      if (sets == null) {
        pushMessage(errors, MANUAL_SETS_SAVE_MESSAGE);
      }
      if (repsMin == null || repsMax == null) {
        pushMessage(errors, MANUAL_REPS_SAVE_MESSAGE);
      } else if (repsMin > repsMax) {
        pushMessage(errors, MANUAL_REPS_ORDER_MESSAGE);
      }

      const notes = typeof exercise.notes === 'string' ? exercise.notes.trim() : '';
      if (notes.length > NOTE_EDIT_MAX) {
        pushMessage(errors, MANUAL_NOTE_SAVE_MESSAGE);
      }
      if (exercise.loadMode != null && !isLoadMode(exercise.loadMode)) {
        pushMessage(errors, MANUAL_LOAD_MODE_MESSAGE);
      }
    }
  }

  if (total > MAX_EXERCISES) {
    pushMessage(errors, MANUAL_CAPACITY_SAVE_MESSAGE);
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

function previewForStoredSave(review: ProgramReview) {
  const preview = toImportPreview(review);
  return {
    ...preview,
    issues: [],
    days: preview.days.map((day) => ({
      ...day,
      exercises: day.exercises.map((exercise) => ({
        ...exercise,
        matchStatus: 'manual' as const,
      })),
    })),
  };
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

export function previewProgramEdit(
  review: ProgramReview,
  userId: string,
  options?: { subtitleRequired?: boolean },
): { ok: false; errors: string[] } {
  if (userId.trim() === '') {
    return { ok: false, errors: [MANUAL_SIGN_IN_SAVE_MESSAGE] };
  }
  const valid = validateManualRoutine(review, options);
  if (!valid.ok) {
    return valid;
  }
  return { ok: false, errors: [EDIT_SAVE_BLOCKED_MESSAGE] };
}

export type OwnedProgramUpdateExercise = {
  exercise_id?: string;
  custom_name?: string;
  target_sets: number;
  min_reps: number;
  max_reps: number;
  notes: string | null;
  load_mode?: LoadMode;
};

export type OwnedProgramUpdateDay = {
  day_id?: string;
  name: string;
  subtitle: string | null;
  exercises: OwnedProgramUpdateExercise[];
};

export type OwnedProgramUpdatePayload = {
  program_id: string;
  name: string;
  days: OwnedProgramUpdateDay[];
};

export type OwnedProgramEditRpc = (args: {
  p_program: OwnedProgramUpdatePayload;
}) => Promise<{ data: unknown; error: { message?: string | null } | null }>;

function emptyToNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function ownedProgramUpdatePayload(
  review: ProgramReview,
  programId: string,
  options?: { subtitleRequired?: boolean; allowCustomExercises?: boolean },
): { ok: true; payload: OwnedProgramUpdatePayload } | { ok: false; errors: string[] } {
  const valid = validateManualRoutine(review, options);
  if (!valid.ok) {
    return valid;
  }
  const programText = storedExerciseId(programId);
  if (programText == null) {
    return { ok: false, errors: ['Choose a saved routine. Nothing was changed.'] };
  }
  const allowCustom = options?.allowCustomExercises ?? CUSTOM_EXERCISE_WRITES_ENABLED;
  if (!allowCustom && !routineUsesStoredExerciseIds(review)) {
    return { ok: false, errors: [CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE] };
  }

  const days: OwnedProgramUpdateDay[] = [];
  for (const day of review.days) {
    const exercises: OwnedProgramUpdateExercise[] = [];
    for (const exercise of day.exercises) {
      const sets = acceptedManualInt(exercise.sets, SETS_MIN, SETS_MAX);
      const repsMin = acceptedManualInt(exercise.repsMin, REPS_MIN, REPS_MAX);
      const repsMax = acceptedManualInt(exercise.repsMax, REPS_MIN, REPS_MAX);
      if (sets == null || repsMin == null || repsMax == null) {
        return { ok: false, errors: [MANUAL_SETS_SAVE_MESSAGE] };
      }
      const storedId = storedExerciseId(exercise.exerciseId);
      const named = customExerciseName(exercise.sourceName);
      const row: OwnedProgramUpdateExercise = {
        target_sets: sets,
        min_reps: repsMin,
        max_reps: repsMax,
        notes: emptyToNull(exercise.notes),
      };
      if (storedId != null) {
        row.exercise_id = storedId;
      } else if (named != null) {
        row.custom_name = named;
      } else {
        return { ok: false, errors: [MANUAL_CHOOSE_EXERCISE_MESSAGE] };
      }
      if (isLoadMode(exercise.loadMode)) {
        row.load_mode = exercise.loadMode;
      }
      exercises.push(row);
    }
    const dayId = storedExerciseId(day.storedDayId);
    const nextDay: OwnedProgramUpdateDay = {
      name: day.name.trim(),
      subtitle: emptyToNull(day.subtitle),
      exercises,
    };
    if (dayId != null) {
      nextDay.day_id = dayId;
    }
    days.push(nextDay);
  }

  return {
    ok: true,
    payload: {
      program_id: programText,
      name: review.programName.trim(),
      days,
    },
  };
}

function editSaveError(message: string | null | undefined): string {
  const text = message ?? '';
  if (text.includes('Not authenticated')) {
    return MANUAL_SIGN_IN_SAVE_MESSAGE;
  }
  if (text.includes('archived_day_locked')) {
    return 'That day is archived. Nothing was changed.';
  }
  if (text.includes('program_day_not_found') || text.includes('program_not_found')) {
    return 'That routine is not available to edit. Nothing was changed.';
  }
  if (text.includes('use_catalog_exercise')) {
    return 'Choose the matching library exercise. Nothing was changed.';
  }
  if (text.includes('exercise_name_taken')) {
    return 'That exercise name is already in use. Nothing was changed.';
  }
  return 'Could not save these edits. Nothing was changed.';
}

export async function saveOwnedProgramEdit(
  review: ProgramReview,
  options: {
    userId: string;
    programId: string;
    rpc?: OwnedProgramEditRpc;
    subtitleRequired?: boolean;
    allowCustomExercises?: boolean;
  },
): Promise<SaveImportedProgramResult> {
  if (typeof options.userId !== 'string' || options.userId.trim() === '') {
    return { ok: false, errors: [MANUAL_SIGN_IN_SAVE_MESSAGE] };
  }
  const payload = ownedProgramUpdatePayload(review, options.programId, options);
  if (!payload.ok) {
    return payload;
  }
  if (!options.rpc) {
    return { ok: false, errors: [EDIT_SAVE_BLOCKED_MESSAGE] };
  }
  let response: { data: unknown; error: { message?: string | null } | null };
  try {
    response = await options.rpc({ p_program: payload.payload });
  } catch {
    return { ok: false, errors: ['Could not save these edits. Nothing was changed.'] };
  }
  if (response.error) {
    return { ok: false, errors: [editSaveError(response.error.message)] };
  }
  const programId = ownedProgramId(response.data);
  if (programId == null) {
    return { ok: false, errors: ['Could not save these edits. Nothing was changed.'] };
  }
  return { ok: true, programId };
}

export async function saveManualProgram(
  review: ProgramReview,
  options: {
    userId: string;
    programs: readonly SavedProgramSummary[];
    rpc?: ImportSaveRpc;
    ownedRpc?: OwnedProgramSaveRpc;
    subtitleRequired?: boolean;
    persistRestSeconds?: boolean;
  },
): Promise<SaveImportedProgramResult> {
  if (typeof options.userId !== 'string' || options.userId.trim() === '') {
    return { ok: false, errors: [MANUAL_SIGN_IN_SAVE_MESSAGE] };
  }
  const valid = validateManualRoutine(review, options);
  if (!valid.ok) {
    return valid;
  }
  const canStoreIds = routineUsesStoredExerciseIds(review);
  if (!hasCurrentProgram(options.programs)) {
    if (!options.ownedRpc || !canStoreIds) {
      return { ok: false, errors: [FIRST_PROGRAM_UNAVAILABLE_MESSAGE] };
    }
    const payload = toSavePayload(previewForStoredSave(review), options.userId, {
      hasActiveProgram: true,
      subtitleRequired: options.subtitleRequired,
      persistRestSeconds: options.persistRestSeconds,
    });
    if (!payload.ok) {
      return payload;
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
  if (!options.rpc || !canStoreIds) {
    return { ok: false, errors: [MANUAL_SAVE_UNAVAILABLE_MESSAGE] };
  }
  return saveImportedProgram(previewForStoredSave(review), {
    userId: options.userId,
    hasActiveProgram: true,
    rpc: options.rpc,
    subtitleRequired: options.subtitleRequired,
    persistRestSeconds: options.persistRestSeconds,
  });
}
