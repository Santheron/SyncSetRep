import { useCallback, useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';

import {
  DEFAULT_REST_MS,
  REST_EXTENSION_MS,
  formatRestClock,
  remainingMs,
  type RestTimerStatus,
} from '@/lib/rest-timer';

export function useRestTimer(defaultMs = DEFAULT_REST_MS) {
  const [status, setStatus] = useState<RestTimerStatus>('idle');
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [pausedRemainingMs, setPausedRemainingMs] = useState(defaultMs);
  const [now, setNow] = useState(() => Date.now());
  const hasSignaledRef = useRef(false);

  const remaining =
    status === 'running' && endsAt !== null
      ? remainingMs(endsAt, now)
      : status === 'paused'
        ? pausedRemainingMs
        : status === 'complete'
          ? 0
          : defaultMs;

  useEffect(() => {
    if (status !== 'running') {
      return;
    }

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => {
      clearInterval(interval);
    };
  }, [status]);

  useEffect(() => {
    if (status === 'running' && remaining <= 0) {
      setStatus('complete');
      setEndsAt(null);
    }
  }, [remaining, status]);

  useEffect(() => {
    if (status !== 'complete' || hasSignaledRef.current) {
      return;
    }

    hasSignaledRef.current = true;

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => undefined,
    );
  }, [status]);

  const start = useCallback(
    (durationMs = defaultMs) => {
      hasSignaledRef.current = false;
      const nextEndsAt = Date.now() + durationMs;
      setEndsAt(nextEndsAt);
      setPausedRemainingMs(durationMs);
      setNow(Date.now());
      setStatus('running');
    },
    [defaultMs],
  );

  const pause = useCallback(() => {
    if (status !== 'running' || endsAt === null) {
      return;
    }

    setPausedRemainingMs(remainingMs(endsAt));
    setStatus('paused');
  }, [endsAt, status]);

  const resume = useCallback(() => {
    if (status !== 'paused') {
      return;
    }

    hasSignaledRef.current = false;
    const nextEndsAt = Date.now() + pausedRemainingMs;
    setEndsAt(nextEndsAt);
    setNow(Date.now());
    setStatus('running');
  }, [pausedRemainingMs, status]);

  const reset = useCallback(() => {
    start(defaultMs);
  }, [defaultMs, start]);

  const addThirty = useCallback(() => {
    if (status === 'running' && endsAt !== null) {
      setEndsAt(endsAt + REST_EXTENSION_MS);
      return;
    }

    if (status === 'paused') {
      setPausedRemainingMs(pausedRemainingMs + REST_EXTENSION_MS);
      return;
    }

    start(status === 'idle' ? defaultMs + REST_EXTENSION_MS : REST_EXTENSION_MS);
  }, [defaultMs, endsAt, pausedRemainingMs, start, status]);

  const skip = useCallback(() => {
    hasSignaledRef.current = true;
    setEndsAt(null);
    setPausedRemainingMs(0);
    setStatus('complete');
  }, []);

  return {
    status,
    remainingMs: remaining,
    formatted: formatRestClock(remaining),
    start,
    pause,
    resume,
    reset,
    addThirty,
    skip,
  };
}
