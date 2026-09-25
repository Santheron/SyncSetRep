import { getAuthenticatedUserId } from '@/lib/current-user';
import { logOwnedDataError } from '@/lib/rls-error';
import { supabase } from '@/lib/supabase';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

function formatError(error: { message?: string | null } | null, fallback: string): string {
  const message = error?.message?.trim();
  return message ? message : fallback;
}

export async function ensureOwnProgram(): Promise<Result<string>> {
  const userResult = await getAuthenticatedUserId();

  if (!userResult.ok) {
    return userResult;
  }

  const existingActive = await supabase
    .from('programs')
    .select('id')
    .eq('user_id', userResult.data)
    .eq('is_active', true)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!existingActive.error && existingActive.data?.id != null) {
    return { ok: true, data: String(existingActive.data.id) };
  }

  const existingAny = await supabase
    .from('programs')
    .select('id')
    .eq('user_id', userResult.data)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!existingAny.error && existingAny.data?.id != null) {
    return { ok: true, data: String(existingAny.data.id) };
  }

  const { data, error } = await supabase.rpc('copy_starter_program_for_current_user');

  if (error || data == null) {
    logOwnedDataError({
      table: 'programs',
      operation: 'rpc',
      userId: userResult.data,
      error: error ?? { message: 'copy_starter_program_for_current_user returned no id' },
    });
    return {
      ok: false,
      error: formatError(error, 'Could not create your program.'),
    };
  }

  return { ok: true, data: String(data) };
}

export async function assertOwnProgramDay(
  programDayId: string,
): Promise<Result<{ programId: string }>> {
  const programResult = await ensureOwnProgram();

  if (!programResult.ok) {
    return programResult;
  }

  const { data, error } = await supabase
    .from('program_days')
    .select('id')
    .eq('id', programDayId)
    .eq('program_id', programResult.data)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  if (!data) {
    return { ok: false, error: 'That workout day is not in your program.' };
  }

  return { ok: true, data: { programId: programResult.data } };
}
