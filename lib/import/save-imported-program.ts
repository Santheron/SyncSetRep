import {
  IMPORT_CAPACITY_MESSAGE,
  IMPORT_DAY_NAME_MESSAGE,
  IMPORT_DUPLICATE_EXERCISE_MESSAGE,
  IMPORT_INVERTED_REPS_MESSAGE,
  IMPORT_NO_ACTIVE_PROGRAM_MESSAGE,
  IMPORT_NOTE_MESSAGE,
  IMPORT_PROGRAM_NAME_MESSAGE,
  IMPORT_SIGN_IN_MESSAGE,
  IMPORT_SUBTITLE_LENGTH_MESSAGE,
  IMPORT_UNACCEPTED_REPS_MESSAGE,
  IMPORT_UNACCEPTED_SETS_MESSAGE,
  IMPORT_UNRESOLVED_EXERCISE_MESSAGE,
  type ImportPreview,
} from './save-plan.ts';
import {
  IMPORT_INVALID_EXERCISE_ID_MESSAGE,
  toSavePayload,
  type SaveImportedProgramPayload,
} from './save-payload.ts';

export const IMPORT_SAVE_FAILED_MESSAGE = 'Could not save this program. Nothing was saved.';

export type SaveImportedProgramResult =
  | { ok: true; programId: string }
  | { ok: false; errors: string[] };

export type ImportSaveRpc = (
  name: 'save_imported_program',
  args: { p_program: SaveImportedProgramPayload },
) => Promise<{ data: unknown; error: { message?: string | null } | null }>;

type UserIdResult = { ok: true; data: string } | { ok: false; error: string };

const RPC_ERROR_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ['Not authenticated', IMPORT_SIGN_IN_MESSAGE],
  ['active_program_required', IMPORT_NO_ACTIVE_PROGRAM_MESSAGE],
  ['invalid_import: duplicate_exercise', IMPORT_DUPLICATE_EXERCISE_MESSAGE],
  ['invalid_import: unknown_exercise', IMPORT_UNRESOLVED_EXERCISE_MESSAGE],
  ['invalid_import: inverted_reps', IMPORT_INVERTED_REPS_MESSAGE],
  ['invalid_import: exercise_id', IMPORT_INVALID_EXERCISE_ID_MESSAGE],
  ['invalid_import: sets', IMPORT_UNACCEPTED_SETS_MESSAGE],
  ['invalid_import: reps', IMPORT_UNACCEPTED_REPS_MESSAGE],
  ['invalid_import: notes', IMPORT_NOTE_MESSAGE],
  ['invalid_import: subtitle', IMPORT_SUBTITLE_LENGTH_MESSAGE],
  ['invalid_import: program_name', IMPORT_PROGRAM_NAME_MESSAGE],
  ['invalid_import: day_name', IMPORT_DAY_NAME_MESSAGE],
  ['invalid_import: day_count', IMPORT_CAPACITY_MESSAGE],
  ['invalid_import: exercises_per_day', IMPORT_CAPACITY_MESSAGE],
  ['invalid_import: exercise_count', IMPORT_CAPACITY_MESSAGE],
];

function messageForRpcError(message: string | null | undefined): string {
  const text = message ?? '';
  for (const [code, friendly] of RPC_ERROR_MESSAGES) {
    if (text.includes(code)) {
      return friendly;
    }
  }
  return IMPORT_SAVE_FAILED_MESSAGE;
}

function programIdFromRpc(data: unknown): string | null {
  if (typeof data === 'number' && Number.isSafeInteger(data) && data > 0) {
    return String(data);
  }
  if (typeof data === 'string' && /^[1-9][0-9]*$/.test(data)) {
    return data;
  }
  return null;
}

async function defaultGetUserId(): Promise<UserIdResult> {
  const module = await import('../current-user.ts');
  return module.getAuthenticatedUserId();
}

async function defaultRpc(
  name: 'save_imported_program',
  args: { p_program: SaveImportedProgramPayload },
): Promise<{ data: unknown; error: { message?: string | null } | null }> {
  const module = await import('../supabase.ts');
  const result = await module.supabase.rpc(name, args);
  return { data: result.data, error: result.error };
}

export async function saveImportedProgram(
  preview: ImportPreview,
  options: {
    userId: string;
    hasActiveProgram: boolean;
    rpc: ImportSaveRpc;
    persistRestSeconds?: boolean;
    subtitleRequired?: boolean;
  },
): Promise<SaveImportedProgramResult> {
  const payload = toSavePayload(preview, options.userId, {
    hasActiveProgram: options.hasActiveProgram,
    persistRestSeconds: options.persistRestSeconds,
    subtitleRequired: options.subtitleRequired,
  });
  if (!payload.ok) {
    return payload;
  }

  let response: { data: unknown; error: { message?: string | null } | null };
  try {
    response = await options.rpc('save_imported_program', { p_program: payload.payload });
  } catch {
    return { ok: false, errors: [IMPORT_SAVE_FAILED_MESSAGE] };
  }

  if (response.error) {
    return { ok: false, errors: [messageForRpcError(response.error.message)] };
  }

  const programId = programIdFromRpc(response.data);
  if (programId == null) {
    return { ok: false, errors: [IMPORT_SAVE_FAILED_MESSAGE] };
  }
  return { ok: true, programId };
}

export async function saveImportedProgramForCurrentUser(
  preview: ImportPreview,
  options: {
    hasActiveProgram: boolean;
    persistRestSeconds?: boolean;
    subtitleRequired?: boolean;
    getUserId?: () => Promise<UserIdResult>;
    rpc?: ImportSaveRpc;
  },
): Promise<SaveImportedProgramResult> {
  const getUserId = options.getUserId ?? defaultGetUserId;
  const rpc = options.rpc ?? defaultRpc;
  const user = await getUserId();
  if (!user.ok || user.data.trim() === '') {
    return { ok: false, errors: [IMPORT_SIGN_IN_MESSAGE] };
  }
  return saveImportedProgram(preview, {
    userId: user.data,
    hasActiveProgram: options.hasActiveProgram,
    persistRestSeconds: options.persistRestSeconds,
    subtitleRequired: options.subtitleRequired,
    rpc,
  });
}
