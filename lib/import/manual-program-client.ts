import {
  MANUAL_SIGN_IN_LIST_MESSAGE,
  MANUAL_SIGN_IN_SAVE_MESSAGE,
  MANUAL_SIGN_IN_SWITCH_MESSAGE,
  saveManualProgram,
  toSavedPrograms,
  type CatalogExercise,
  type OwnedProgramRow,
  type OwnedProgramSaveRpc,
  type SavedProgramSummary,
} from './manual-program.ts';
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
  data: Array<{ id: number | string; name: string }> | null;
  error: { message?: string | null } | null;
}>;

const PROGRAM_COLUMNS = 'id, name, is_active';
const EXERCISE_COLUMNS = 'id, name';

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
    data: (result.data ?? null) as Array<{ id: number | string; name: string }> | null,
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
    })),
  };
}

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
  const rpc = io?.rpc ?? defaultSaveRpc;
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
