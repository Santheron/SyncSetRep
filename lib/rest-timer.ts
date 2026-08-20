export const DEFAULT_REST_MS = 90_000;
export const REST_EXTENSION_MS = 30_000;

export type RestTimerStatus = 'idle' | 'running' | 'paused' | 'complete';

export function remainingMs(endsAt: number, now = Date.now()): number {
  return Math.max(0, endsAt - now);
}

export function formatRestClock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
