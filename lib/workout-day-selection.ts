export type UnfinishedSessionIdentity = {
  id: string;
  programDayId: string;
  startedAt: string;
};

export type UnfinishedSessionPartition<T> = {
  sameDay: T[];
  otherDays: T[];
};

function compareIdDescending(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftId = BigInt(left);
    const rightId = BigInt(right);

    if (leftId === rightId) {
      return 0;
    }

    return leftId > rightId ? -1 : 1;
  }

  return right < left ? -1 : 1;
}

export function compareUnfinishedSessions(
  left: UnfinishedSessionIdentity,
  right: UnfinishedSessionIdentity,
): number {
  const leftTime = Date.parse(left.startedAt);
  const rightTime = Date.parse(right.startedAt);
  const leftValid = Number.isFinite(leftTime);
  const rightValid = Number.isFinite(rightTime);

  if (leftValid && rightValid && leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  if (leftValid !== rightValid) {
    return leftValid ? -1 : 1;
  }

  return compareIdDescending(left.id, right.id);
}

export function sortUnfinishedSessions<T extends UnfinishedSessionIdentity>(sessions: readonly T[]): T[] {
  return [...sessions].sort(compareUnfinishedSessions);
}

export function formatUnfinishedSessionWhen(isoDate: string): string {
  const date = new Date(isoDate);

  if (Number.isNaN(date.getTime())) {
    return 'Unknown start time';
  }

  const day = date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  return `${day} · ${time}`;
}

export type DiscardConfirmationChoice = 'cancel' | 'discard';

export function discardChoiceApplies(choice: DiscardConfirmationChoice): boolean {
  return choice === 'discard';
}

export function applyDiscardConfirmation(
  choice: DiscardConfirmationChoice,
  onDiscard: () => void,
): void {
  if (discardChoiceApplies(choice)) {
    onDiscard();
  }
}

export type WorkoutScreenSource = 'home' | 'select';
export type WorkoutScreenAction = 'start' | 'resume' | 'discard';

export type WorkoutNavigationTarget =
  | { stay: true }
  | {
      stay: false;
      method: 'push' | 'replace';
      pathname: '/workout/[sessionId]';
      sessionId: string;
    }
  | {
      stay: false;
      method: 'push';
      pathname: '/workout/select';
    };

export function workoutNavigationTarget(
  source: WorkoutScreenSource,
  action: WorkoutScreenAction,
  sessionId: string | null,
): WorkoutNavigationTarget {
  if (action === 'discard') {
    return { stay: true };
  }

  if (action === 'start' && source === 'home') {
    return { stay: false, method: 'push', pathname: '/workout/select' };
  }

  const id = String(sessionId ?? '').trim();

  if (!id) {
    return { stay: true };
  }

  return {
    stay: false,
    method: source === 'home' ? 'push' : 'replace',
    pathname: '/workout/[sessionId]',
    sessionId: id,
  };
}

export function selectUnfinishedDeleteIds(
  requestedIds: readonly string[],
  unfinishedOwnedIds: readonly string[],
): { ok: true; ids: string[] } | { ok: false; error: string } {
  const requested = [...new Set(requestedIds.map((sessionId) => String(sessionId).trim()).filter(Boolean))];
  const owned = new Set(unfinishedOwnedIds.map((sessionId) => String(sessionId)));

  if (requested.length === 0) {
    return { ok: true, ids: [] };
  }

  if (requested.some((sessionId) => !owned.has(sessionId))) {
    return {
      ok: false,
      error: 'That workout is no longer unfinished. Completed workouts stay saved.',
    };
  }

  return { ok: true, ids: requested };
}

export function createAsyncLock() {
  let tail: Promise<void> = Promise.resolve();

  return function runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export function partitionUnfinishedSessions<T extends UnfinishedSessionIdentity>(
  sessions: readonly T[],
  programDayId: string,
): UnfinishedSessionPartition<T> {
  const selectedDayId = String(programDayId);
  const sameDay: T[] = [];
  const otherDays: T[] = [];

  for (const session of sortUnfinishedSessions(sessions)) {
    if (String(session.programDayId) === selectedDayId) {
      sameDay.push(session);
    } else {
      otherDays.push(session);
    }
  }

  return { sameDay, otherDays };
}
