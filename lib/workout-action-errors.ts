export type WorkoutAction = 'start' | 'save-set' | 'discard';

export type WorkoutActionErrorInput = {
  action: WorkoutAction;
  code?: string | null;
  message?: string | null;
};

function codeFromMessage(message: string): string {
  const match = message.match(/\b(23505|23503|42501|PGRST\d+)\b/i);
  return match?.[1] ?? '';
}

function messageLooksTechnical(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes('duplicate key') ||
    lowered.includes('row-level security') ||
    lowered.includes('permission denied') ||
    lowered.includes('jwt') ||
    lowered.includes('failed to fetch') ||
    lowered.includes('network request failed') ||
    lowered.includes('pgrst') ||
    lowered.includes('violates') ||
    lowered.includes('timeout') ||
    lowered.includes('fetch failed')
  );
}

function friendlyTechnicalMessage(action: WorkoutAction, code: string, message: string): string {
  const lowered = `${code} ${message}`.toLowerCase();

  if (
    code === '42501' ||
    lowered.includes('row-level security') ||
    lowered.includes('permission denied') ||
    lowered.includes('jwt')
  ) {
    return 'Your account does not have permission to change this workout. Sign in again, then retry. Completed workouts were not deleted.';
  }

  if (
    lowered.includes('failed to fetch') ||
    lowered.includes('network request failed') ||
    lowered.includes('fetch failed') ||
    lowered.includes('timeout')
  ) {
    return 'The connection dropped before this change was saved. Check your connection and try again. Completed workouts were not deleted.';
  }

  if (code === '23505' || lowered.includes('duplicate key') || lowered.includes('unique')) {
    if (action === 'start') {
      return 'A workout was already started for this day. Resume that workout instead of creating another.';
    }

    if (action === 'save-set') {
      return 'This set is already saved for this exercise. Refresh the workout before logging it again. Other sets were left unchanged.';
    }

    return 'That change conflicts with a workout that already exists. Refresh and try again. Completed workouts were not deleted.';
  }

  if (action === 'start') {
    return 'The workout could not be started. Nothing new was kept, and completed workouts were not deleted.';
  }

  if (action === 'save-set') {
    return 'This set was not saved. Your other sets are still here.';
  }

  return 'This unfinished workout was not discarded. Completed workouts stay saved.';
}

export function formatWorkoutActionError(input: WorkoutActionErrorInput): string {
  const message = (input.message ?? '').trim();
  const code = (input.code ?? '').trim() || codeFromMessage(message);

  if (!message || messageLooksTechnical(message)) {
    return friendlyTechnicalMessage(input.action, code, message);
  }

  return message;
}
