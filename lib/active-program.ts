export const NO_ACTIVE_PROGRAM_CODE = 'no-active-program' as const;

export type NoActiveProgramCode = typeof NO_ACTIVE_PROGRAM_CODE;

export const NO_ACTIVE_PROGRAM_MESSAGE =
  'You do not have a current program. Open Saved programs to choose one, or build a routine. Nothing was created.';

export type ActiveProgramDecision =
  | { action: 'use'; programId: string }
  | { action: 'refuse'; code: 'signed-out' | 'query-error' | 'no-active-program' };

export function decideActiveProgram(input: {
  signedIn: boolean;
  queryFailed: boolean;
  activeId: string | null;
}): ActiveProgramDecision {
  if (!input.signedIn) {
    return { action: 'refuse', code: 'signed-out' };
  }

  if (input.queryFailed) {
    return { action: 'refuse', code: 'query-error' };
  }

  if (input.activeId != null && input.activeId !== '') {
    return { action: 'use', programId: input.activeId };
  }

  return { action: 'refuse', code: 'no-active-program' };
}

export function programLoadErrorText(
  failurePrefix: string,
  result: { error: string; code?: string },
): string {
  if (result.code === NO_ACTIVE_PROGRAM_CODE) {
    return result.error;
  }

  return `${failurePrefix} ${result.error}`;
}
