import { getAuthenticatedUserId } from '@/lib/current-user';
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

  const existing = await supabase
    .from('programs')
    .select('id')
    .eq('user_id', userResult.data)
    .eq('is_active', true)
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!existing.error && existing.data?.id != null) {
    return { ok: true, data: String(existing.data.id) };
  }

  const { data, error } = await supabase.rpc('copy_starter_program_for_current_user');

  if (error || data == null) {
    return {
      ok: false,
      error: formatError(error, 'Could not create your program.'),
    };
  }

  return { ok: true, data: String(data) };
}

export async function assertOwnProgramDay(programDayId: string): Promise<Result<true>> {
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

  return { ok: true, data: true };
}
