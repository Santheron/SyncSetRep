import { PROGRAM_NAME_MAX } from './limits.ts';
import { CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE } from './manual-program.ts';
import { normalizeExerciseName, CUSTOM_EXERCISE_WRITES_ENABLED } from './planned-exercises.ts';

export const CUSTOM_EXERCISE_NAME_MESSAGE =
  `Enter an exercise name of 1 to ${PROGRAM_NAME_MAX} characters. Nothing was saved.`;

export const CUSTOM_EXERCISE_CATALOG_MESSAGE =
  'Choose the matching library exercise. Nothing was saved.';

export const CUSTOM_EXERCISE_TAKEN_MESSAGE =
  'That exercise name is already in use. Nothing was saved.';

export const CUSTOM_EXERCISE_SIGN_IN_MESSAGE =
  'Sign in before saving an exercise. Nothing was saved.';

export const CUSTOM_EXERCISE_FAILED_MESSAGE =
  'Could not save this exercise. Nothing was saved.';

export type CreateCustomExerciseRpc = (
  name: string,
) => Promise<{ data: unknown; error: { message?: string | null } | null }>;

export type FindOwnedExercise = (name: string) => Promise<string | null>;

export type CreateCustomExerciseResult =
  | { ok: true; exerciseId: string; name: string }
  | { ok: false; error: string };

export function acceptedCustomExerciseName(value: string): string | null {
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

function exerciseId(data: unknown): string | null {
  if (typeof data === 'number' && Number.isSafeInteger(data) && data > 0) {
    return String(data);
  }
  if (typeof data === 'string' && /^[1-9][0-9]*$/.test(data)) {
    return data;
  }
  return null;
}

function failure(message: string | null | undefined): string {
  const text = message ?? '';
  if (text.includes('Not authenticated')) {
    return CUSTOM_EXERCISE_SIGN_IN_MESSAGE;
  }
  if (text.includes('use_catalog_exercise')) {
    return CUSTOM_EXERCISE_CATALOG_MESSAGE;
  }
  if (text.includes('exercise_name_taken')) {
    return CUSTOM_EXERCISE_TAKEN_MESSAGE;
  }
  if (text.includes('invalid_import: exercise_name') || text.includes('invalid_exercise_name')) {
    return CUSTOM_EXERCISE_NAME_MESSAGE;
  }
  return CUSTOM_EXERCISE_FAILED_MESSAGE;
}

async function defaultCreateRpc(name: string) {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase.rpc('create_custom_exercise', { p_name: name });
  return { data: result.data, error: result.error };
}

async function defaultFindOwnedExercise(name: string): Promise<string | null> {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase.from('exercises').select('id, name, owner_user_id').eq('name', name);
  if (result.error || !Array.isArray(result.data)) {
    return null;
  }
  const owned = result.data.find((row) => {
    if (!row || typeof row !== 'object') {
      return false;
    }
    const record = row as { name?: unknown; owner_user_id?: unknown };
    return record.name === name && record.owner_user_id != null;
  }) as { id?: unknown } | undefined;
  return exerciseId(owned?.id);
}

export async function createCustomExercise(
  name: string,
  options?: { rpc?: CreateCustomExerciseRpc; enabled?: boolean; findOwned?: FindOwnedExercise },
): Promise<CreateCustomExerciseResult> {
  const clean = acceptedCustomExerciseName(name);
  if (clean == null) {
    return { ok: false, error: CUSTOM_EXERCISE_NAME_MESSAGE };
  }
  const enabled = options?.enabled ?? CUSTOM_EXERCISE_WRITES_ENABLED;
  const rpc = options?.rpc ?? (enabled ? defaultCreateRpc : undefined);
  if (!rpc) {
    return { ok: false, error: CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE };
  }
  let response: { data: unknown; error: { message?: string | null } | null };
  try {
    response = await rpc(clean);
  } catch {
    return { ok: false, error: CUSTOM_EXERCISE_FAILED_MESSAGE };
  }
  if (response.error) {
    const mapped = failure(response.error.message);
    if (mapped === CUSTOM_EXERCISE_TAKEN_MESSAGE) {
      const findOwned = options?.findOwned ?? defaultFindOwnedExercise;
      try {
        const existing = await findOwned(clean);
        if (existing != null) {
          return { ok: true, exerciseId: existing, name: clean };
        }
      } catch {
        return { ok: false, error: CUSTOM_EXERCISE_TAKEN_MESSAGE };
      }
    }
    return { ok: false, error: mapped };
  }
  const id = exerciseId(response.data);
  if (id == null) {
    return { ok: false, error: CUSTOM_EXERCISE_FAILED_MESSAGE };
  }
  return { ok: true, exerciseId: id, name: clean };
}
