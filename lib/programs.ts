import {
  decideActiveProgram,
  NO_ACTIVE_PROGRAM_CODE,
  NO_ACTIVE_PROGRAM_MESSAGE,
  type NoActiveProgramCode,
} from '@/lib/active-program';
import { getAuthenticatedUserId } from '@/lib/current-user';
import { isActiveProgramDay } from '@/lib/load-mode';
import { isMissingColumnError } from '@/lib/postgrest';
import { logOwnedDataError } from '@/lib/rls-error';
import { supabase } from '@/lib/supabase';

export const ARCHIVED_DAY_MESSAGE = 'That workout day is no longer in your active routine.';

export type ProgramLoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: NoActiveProgramCode };

function formatError(error: { message?: string | null } | null, fallback: string): string {
  const message = error?.message?.trim();
  return message ? message : fallback;
}

export async function loadActiveProgram(): Promise<ProgramLoadResult<string>> {
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

  const decision = decideActiveProgram({
    signedIn: true,
    queryFailed: existingActive.error != null,
    activeId: existingActive.data?.id != null ? String(existingActive.data.id) : null,
  });

  if (decision.action === 'use') {
    return { ok: true, data: decision.programId };
  }

  if (decision.code === 'query-error') {
    logOwnedDataError({
      table: 'programs',
      operation: 'select',
      userId: userResult.data,
      error: existingActive.error ?? { message: 'Could not load your current program.' },
    });
    return {
      ok: false,
      error: formatError(existingActive.error, 'Could not load your current program.'),
    };
  }

  return {
    ok: false,
    error: NO_ACTIVE_PROGRAM_MESSAGE,
    code: NO_ACTIVE_PROGRAM_CODE,
  };
}

export async function assertOwnProgramDay(
  programDayId: string,
): Promise<ProgramLoadResult<{ programId: string }>> {
  const programResult = await loadActiveProgram();

  if (!programResult.ok) {
    return programResult;
  }

  const withArchive = await supabase
    .from('program_days')
    .select('id, archived_at')
    .eq('id', programDayId)
    .eq('program_id', programResult.data)
    .maybeSingle();
  const selected =
    withArchive.error && isMissingColumnError(withArchive.error, 'archived_at')
      ? await supabase
          .from('program_days')
          .select('id')
          .eq('id', programDayId)
          .eq('program_id', programResult.data)
          .maybeSingle()
      : withArchive;

  if (selected.error) {
    return { ok: false, error: selected.error.message };
  }

  if (!selected.data) {
    return { ok: false, error: 'That workout day is not in your program.' };
  }

  const archivedAt = (selected.data as { archived_at?: string | null }).archived_at;
  if (!isActiveProgramDay(archivedAt)) {
    return { ok: false, error: ARCHIVED_DAY_MESSAGE };
  }

  return { ok: true, data: { programId: programResult.data } };
}
