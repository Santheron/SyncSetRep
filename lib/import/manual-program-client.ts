import {
  saveManualProgram,
  toSavedPrograms,
  type CatalogExercise,
  type OwnedProgramRow,
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
    return { ok: false, error: IMPORT_SIGN_IN_MESSAGE };
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

export async function saveManualProgramForCurrentUser(
  review: ProgramReview,
  io?: {
    getUserId?: () => Promise<UserIdResult>;
    loadPrograms?: () => Promise<ListResult>;
    rpc?: ImportSaveRpc;
  },
): Promise<SaveImportedProgramResult> {
  const getUserId = io?.getUserId ?? defaultGetUserId;
  const loadPrograms = io?.loadPrograms ?? (() => loadOwnedPrograms());
  const rpc = io?.rpc ?? defaultSaveRpc;
  const user = await getUserId();
  if (!user.ok || user.data.trim() === '') {
    return { ok: false, errors: [IMPORT_SIGN_IN_MESSAGE] };
  }
  const programs = await loadPrograms();
  if (!programs.ok) {
    return { ok: false, errors: [programs.error] };
  }
  return saveManualProgram(review, {
    userId: user.data,
    programs: programs.data,
    rpc,
  });
}
