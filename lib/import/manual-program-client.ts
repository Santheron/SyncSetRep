import {
  MANUAL_SIGN_IN_LIST_MESSAGE,
  MANUAL_SIGN_IN_SAVE_MESSAGE,
  MANUAL_SIGN_IN_SWITCH_MESSAGE,
  saveManualProgram,
  saveOwnedProgramEdit,
  toSavedPrograms,
  type CatalogExercise,
  type OwnedProgramEditRpc,
  type OwnedProgramRow,
  type OwnedProgramSaveRpc,
  type SavedProgramSummary,
} from './manual-program.ts';
import { NO_ACTIVE_PROGRAM_MESSAGE } from '../active-program.ts';
import { isMissingColumnError } from '../postgrest.ts';
import {
  equipmentFromType,
  muscleFromCategory,
} from './planned-exercises.ts';
import {
  acceptedDraftId,
  assembleProgramDraft,
  DAY_NOT_IN_ROUTINE_MESSAGE,
  DRAFT_ID_MESSAGE,
  readDraftNumber,
  readDraftText,
  type ProgramDraft,
} from './program-draft.ts';
import type { ProgramReview } from './review-editor.ts';
import type { SaveImportedProgramPayload } from './save-payload.ts';
import { IMPORT_SIGN_IN_MESSAGE } from './save-plan.ts';
import {
  type ImportSaveRpc,
  type SaveImportedProgramResult,
} from './save-imported-program.ts';

type UserIdResult = { ok: true; data: string } | { ok: false; error: string };

type ListResult = { ok: true; data: SavedProgramSummary[] } | { ok: false; error: string };

type CatalogResult = { ok: true; data: CatalogExercise[] } | { ok: false; error: string };

export type SelectPrograms = (userId: string) => Promise<{
  data: OwnedProgramRow[] | null;
  error: { message?: string | null } | null;
}>;

export type SelectExercises = () => Promise<{
  data: Array<{
    id: number | string;
    name: string;
    category?: string | null;
    equipment_type?: string | null;
  }> | null;
  error: { message?: string | null } | null;
}>;

type ProgramIdentityRow = {
  id: number | string;
  name: string;
  is_active: boolean;
};

type DraftDayRow = {
  id: number | string;
  name: string;
  subtitle: string | null;
  day_order: number | string;
};

type DraftExerciseRelation = { name?: string | null } | { name?: string | null }[] | null;

type DraftExerciseRow = {
  id: number | string;
  program_day_id: number | string;
  exercise_id: number | string;
  exercise_order: number | string;
  target_sets: number | string | null;
  min_reps: number | string | null;
  max_reps: number | string | null;
  notes: string | null;
  exercise: DraftExerciseRelation;
};

export type SelectDraftProgram = (
  userId: string,
  programId: string,
) => Promise<{ data: ProgramIdentityRow | null; error: { message?: string | null } | null }>;

export type SelectActiveDraftProgram = (
  userId: string,
) => Promise<{ data: ProgramIdentityRow | null; error: { message?: string | null } | null }>;

export type SelectDraftDays = (
  programId: string,
) => Promise<{ data: DraftDayRow[] | null; error: { message?: string | null } | null }>;

export type SelectDraftExercises = (
  dayIds: readonly string[],
) => Promise<{ data: DraftExerciseRow[] | null; error: { message?: string | null } | null }>;

export type ProgramDraftResult =
  | { ok: true; draft: ProgramDraft; focusDayIndex: number; userId: string }
  | { ok: false; error: string };

const PROGRAM_COLUMNS = 'id, name, is_active';
const EXERCISE_COLUMNS = 'id, name, category, equipment_type';
const DRAFT_DAY_COLUMNS = 'id, name, subtitle, day_order';
const DRAFT_EXERCISE_COLUMNS =
  'id, program_day_id, exercise_id, exercise_order, target_sets, min_reps, max_reps, notes, exercise:exercises ( name )';

async function defaultGetUserId(): Promise<UserIdResult> {
  const module = await import('../current-user.ts');
  return module.getAuthenticatedUserId();
}

async function defaultSelectPrograms(userId: string) {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase
    .from('programs')
    .select(PROGRAM_COLUMNS)
    .eq('user_id', userId)
    .order('id', { ascending: true });
  return {
    data: (result.data ?? null) as OwnedProgramRow[] | null,
    error: result.error,
  };
}

async function defaultSelectExercises() {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase
    .from('exercises')
    .select(EXERCISE_COLUMNS)
    .order('name', { ascending: true });
  return {
    data: (result.data ?? null) as Array<{
      id: number | string;
      name: string;
      category?: string | null;
      equipment_type?: string | null;
    }> | null,
    error: result.error,
  };
}

async function defaultSaveRpc(
  name: 'save_imported_program',
  args: { p_program: SaveImportedProgramPayload },
) {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase.rpc(name, args);
  return { data: result.data, error: result.error };
}

export async function loadOwnedPrograms(io?: {
  getUserId?: () => Promise<UserIdResult>;
  selectPrograms?: SelectPrograms;
}): Promise<ListResult> {
  const getUserId = io?.getUserId ?? defaultGetUserId;
  const selectPrograms = io?.selectPrograms ?? defaultSelectPrograms;
  const user = await getUserId();
  if (!user.ok || user.data.trim() === '') {
    return { ok: false, error: MANUAL_SIGN_IN_LIST_MESSAGE };
  }
  const selected = await selectPrograms(user.data);
  if (selected.error) {
    const message = selected.error.message?.trim();
    return { ok: false, error: message ? message : 'Could not load programs.' };
  }
  return { ok: true, data: toSavedPrograms(selected.data ?? []) };
}

export async function loadExerciseCatalog(io?: {
  selectExercises?: SelectExercises;
}): Promise<CatalogResult> {
  const selectExercises = io?.selectExercises ?? defaultSelectExercises;
  const selected = await selectExercises();
  if (selected.error) {
    const message = selected.error.message?.trim();
    return { ok: false, error: message ? message : 'Could not load exercises.' };
  }
  return {
    ok: true,
    data: (selected.data ?? []).map((row) => ({
      id: String(row.id),
      name: row.name,
      muscle: muscleFromCategory(row.category),
      equipment: equipmentFromType(row.equipment_type),
    })),
  };
}

function exerciseRelationName(value: DraftExerciseRelation): string {
  const row = Array.isArray(value) ? value[0] : value;
  const name = row?.name?.trim();
  return name ? name : 'Exercise';
}

function draftQueryError(error: { message?: string | null } | null, fallback: string): string {
  const message = error?.message?.trim();
  return message ? message : fallback;
}

async function defaultSelectActiveProgram(userId: string) {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase
    .from('programs')
    .select(PROGRAM_COLUMNS)
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('id', { ascending: true })
    .limit(1);
  const row = Array.isArray(result.data) ? (result.data[0] ?? null) : null;
  return {
    data: row as ProgramIdentityRow | null,
    error: result.error,
  };
}

async function defaultSelectDraftProgram(userId: string, programId: string) {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase
    .from('programs')
    .select(PROGRAM_COLUMNS)
    .eq('user_id', userId)
    .eq('id', programId)
    .maybeSingle();
  return {
    data: (result.data ?? null) as ProgramIdentityRow | null,
    error: result.error,
  };
}

async function defaultSelectDraftDays(programId: string) {
  const { supabase } = await import('../supabase.ts');
  const withArchive = await supabase
    .from('program_days')
    .select(`${DRAFT_DAY_COLUMNS}, archived_at`)
    .eq('program_id', programId)
    .is('archived_at', null)
    .order('day_order', { ascending: true });
  const result =
    withArchive.error && isMissingColumnError(withArchive.error, 'archived_at')
      ? await supabase
          .from('program_days')
          .select(DRAFT_DAY_COLUMNS)
          .eq('program_id', programId)
          .order('day_order', { ascending: true })
      : withArchive;
  return {
    data: (result.data ?? null) as DraftDayRow[] | null,
    error: result.error,
  };
}

async function defaultSelectDraftExercises(dayIds: readonly string[]) {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase
    .from('program_exercises')
    .select(DRAFT_EXERCISE_COLUMNS)
    .in('program_day_id', [...dayIds]);
  return {
    data: (result.data ?? null) as DraftExerciseRow[] | null,
    error: result.error,
  };
}

export async function loadProgramDraftForCurrentUser(
  target: { programId?: string; dayId?: string },
  io?: {
    getUserId?: () => Promise<UserIdResult>;
    selectActiveProgram?: SelectActiveDraftProgram;
    selectProgram?: SelectDraftProgram;
    selectDays?: SelectDraftDays;
    selectDraftExercises?: SelectDraftExercises;
  },
): Promise<ProgramDraftResult> {
  const programId = target.programId?.trim();
  const dayId = target.dayId?.trim();
  if (programId && !acceptedDraftId(programId)) {
    return { ok: false, error: DRAFT_ID_MESSAGE };
  }
  if (dayId && !acceptedDraftId(dayId)) {
    return { ok: false, error: DAY_NOT_IN_ROUTINE_MESSAGE };
  }
  if (!programId && !dayId) {
    return { ok: false, error: DRAFT_ID_MESSAGE };
  }
  const getUserId = io?.getUserId ?? defaultGetUserId;
  const user = await getUserId();
  if (!user.ok || user.data.trim() === '') {
    return { ok: false, error: 'Sign in to edit a saved routine. Nothing was changed.' };
  }
  const selectActiveProgram = io?.selectActiveProgram ?? defaultSelectActiveProgram;
  const selectProgram = io?.selectProgram ?? defaultSelectDraftProgram;
  const selectDays = io?.selectDays ?? defaultSelectDraftDays;
  const selectDraftExercises = io?.selectDraftExercises ?? defaultSelectDraftExercises;
  const selectedProgram = programId
    ? await selectProgram(user.data, programId)
    : await selectActiveProgram(user.data);
  if (selectedProgram.error) {
    return { ok: false, error: draftQueryError(selectedProgram.error, 'Could not load this routine.') };
  }
  if (!selectedProgram.data) {
    return {
      ok: false,
      error: programId ? 'That routine is not available. Nothing was changed.' : NO_ACTIVE_PROGRAM_MESSAGE,
    };
  }
  const loadedProgramId = String(selectedProgram.data.id);
  const daysResult = await selectDays(loadedProgramId);
  if (daysResult.error) {
    return { ok: false, error: draftQueryError(daysResult.error, 'Could not load this routine.') };
  }
  const dayRows = daysResult.data ?? [];
  const dayIds = dayRows.map((day) => String(day.id));
  const exerciseResult =
    dayIds.length === 0
      ? { data: [] as DraftExerciseRow[], error: null }
      : await selectDraftExercises(dayIds);
  if (exerciseResult.error) {
    return { ok: false, error: draftQueryError(exerciseResult.error, 'Could not load this routine.') };
  }
  const assembled = assembleProgramDraft({
    programId: loadedProgramId,
    name: readDraftText(selectedProgram.data.name),
    isActive: selectedProgram.data.is_active === true,
    focusDayId: dayId,
    days: dayRows.map((day) => ({
      id: String(day.id),
      name: readDraftText(day.name),
      subtitle: day.subtitle,
      dayOrder: readDraftNumber(day.day_order) ?? 0,
    })),
    exercises: (exerciseResult.data ?? []).map((row) => ({
      id: String(row.id),
      programDayId: String(row.program_day_id),
      exerciseId: String(row.exercise_id),
      name: exerciseRelationName(row.exercise),
      order: readDraftNumber(row.exercise_order) ?? 0,
      targetSets: readDraftNumber(row.target_sets),
      minReps: readDraftNumber(row.min_reps),
      maxReps: readDraftNumber(row.max_reps),
      notes: row.notes,
    })),
  });
  if (!assembled.ok) {
    return assembled;
  }
  return {
    ok: true,
    draft: assembled.draft,
    focusDayIndex: assembled.focusDayIndex,
    userId: user.data,
  };
}

export const MANUAL_SAVE_RPC_ENABLED = false;

export const OWNED_PROGRAM_RPC_ENABLED = false;

async function defaultOwnedSaveRpc(args: {
  p_program: SaveImportedProgramPayload;
  p_make_current: true;
}) {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase.rpc('save_owned_program', args);
  return { data: result.data, error: result.error };
}

export async function saveManualProgramForCurrentUser(
  review: ProgramReview,
  io?: {
    getUserId?: () => Promise<UserIdResult>;
    loadPrograms?: () => Promise<ListResult>;
    rpc?: ImportSaveRpc;
    ownedRpc?: OwnedProgramSaveRpc;
  },
): Promise<SaveImportedProgramResult> {
  const getUserId = io?.getUserId ?? defaultGetUserId;
  const loadPrograms = io?.loadPrograms ?? (() => loadOwnedPrograms());
  const rpc = io?.rpc ?? (MANUAL_SAVE_RPC_ENABLED ? defaultSaveRpc : undefined);
  const ownedRpc = io?.ownedRpc ?? (OWNED_PROGRAM_RPC_ENABLED ? defaultOwnedSaveRpc : undefined);
  const user = await getUserId();
  if (!user.ok || user.data.trim() === '') {
    return { ok: false, errors: [MANUAL_SIGN_IN_SAVE_MESSAGE] };
  }
  const programs = await loadPrograms();
  if (!programs.ok) {
    return { ok: false, errors: manualSaveErrors([programs.error]) };
  }
  const saved = await saveManualProgram(review, {
    userId: user.data,
    programs: programs.data,
    rpc,
    ownedRpc,
  });
  if (!saved.ok) {
    return { ok: false, errors: manualSaveErrors(saved.errors) };
  }
  return saved;
}

function manualSaveErrors(errors: readonly string[]): string[] {
  return errors.map((error) =>
    error === IMPORT_SIGN_IN_MESSAGE ? MANUAL_SIGN_IN_SAVE_MESSAGE : error,
  );
}

export const OWNED_PROGRAM_EDIT_ENABLED = false;

async function defaultEditRpc(args: Parameters<OwnedProgramEditRpc>[0]) {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase.rpc('update_owned_program', args);
  return { data: result.data, error: result.error };
}

export async function saveOwnedProgramEditForCurrentUser(
  review: ProgramReview,
  target: { programId: string },
  io?: {
    getUserId?: () => Promise<UserIdResult>;
    rpc?: OwnedProgramEditRpc;
    subtitleRequired?: boolean;
    allowCustomExercises?: boolean;
  },
): Promise<SaveImportedProgramResult> {
  const getUserId = io?.getUserId ?? defaultGetUserId;
  const rpc = io?.rpc ?? (OWNED_PROGRAM_EDIT_ENABLED ? defaultEditRpc : undefined);
  const user = await getUserId();
  if (!user.ok || user.data.trim() === '') {
    return { ok: false, errors: [MANUAL_SIGN_IN_SAVE_MESSAGE] };
  }
  return saveOwnedProgramEdit(review, {
    userId: user.data,
    programId: target.programId,
    rpc,
    subtitleRequired: io?.subtitleRequired,
    allowCustomExercises: io?.allowCustomExercises,
  });
}

export const ACTIVATION_RPC_ENABLED = false;

export const PROGRAM_SWITCH_UNAVAILABLE_MESSAGE =
  'Program switching stays off in this build. Nothing was changed.';

export type ActivateOwnedProgramRpc = (
  programId: string,
) => Promise<{ data: unknown; error: { message?: string | null } | null }>;

export type ActivateOwnedProgramResult =
  | { ok: true; programId: string }
  | { ok: false; error: string };

const PROGRAM_ID_LIMIT = 9223372036854775807n;

export function acceptedOwnedProgramId(programId: string): boolean {
  if (!/^[1-9][0-9]*$/.test(programId) || programId.length > 19) {
    return false;
  }
  try {
    const value = BigInt(programId);
    return value >= 1n && value <= PROGRAM_ID_LIMIT;
  } catch {
    return false;
  }
}

function activationFailure(message: string | null | undefined): string {
  const text = message?.trim() ?? '';
  if (text.includes('Not authenticated') || text === IMPORT_SIGN_IN_MESSAGE) {
    return MANUAL_SIGN_IN_SWITCH_MESSAGE;
  }
  if (text.includes('program_not_found')) {
    return 'That program is not available to switch to. Nothing was changed.';
  }
  if (text.includes('active_program_count')) {
    return 'Could not keep exactly one current program. Nothing was changed.';
  }
  return 'Could not switch programs. Nothing was changed.';
}

async function defaultActivateRpc(programId: string) {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase.rpc('activate_owned_program', { p_program_id: programId });
  return { data: result.data, error: result.error };
}

export async function activateOwnedProgramForCurrentUser(
  programId: string,
  io?: {
    getUserId?: () => Promise<UserIdResult>;
    rpc?: ActivateOwnedProgramRpc;
  },
): Promise<ActivateOwnedProgramResult> {
  const getUserId = io?.getUserId ?? defaultGetUserId;
  const user = await getUserId();
  if (!user.ok || user.data.trim() === '') {
    return { ok: false, error: MANUAL_SIGN_IN_SWITCH_MESSAGE };
  }
  if (!acceptedOwnedProgramId(programId)) {
    return { ok: false, error: 'Choose a saved program. Nothing was changed.' };
  }
  if (!io?.rpc && !ACTIVATION_RPC_ENABLED) {
    return { ok: false, error: PROGRAM_SWITCH_UNAVAILABLE_MESSAGE };
  }
  const rpc = io?.rpc ?? ((id: string) => defaultActivateRpc(id));
  const result = await rpc(programId);
  if (result.error || result.data == null || String(result.data).trim() === '') {
    return { ok: false, error: activationFailure(result.error?.message) };
  }
  return { ok: true, programId: String(result.data) };
}
