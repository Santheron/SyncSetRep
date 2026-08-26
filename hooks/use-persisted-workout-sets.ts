import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  formatSetInput,
  parseOptionalReps,
  parseOptionalRir,
  parseOptionalWeight,
  saveWorkoutSet,
  setKey,
  type WorkoutSetRecord,
} from '@/lib/workout-session';

const DEBOUNCE_MS = 450;

export type SetInputs = {
  weight: string;
  reps: string;
  rir: string;
};

type CompleteResult = {
  ok: boolean;
};

function emptyInputs(): SetInputs {
  return { weight: '', reps: '', rir: '' };
}

function recordsToState(sets: WorkoutSetRecord[]) {
  const inputs: Record<string, SetInputs> = {};
  const completed: Record<string, boolean> = {};
  const ids: Record<string, string> = {};

  for (const set of sets) {
    const key = setKey(set.exerciseId, set.setNumber);
    inputs[key] = {
      weight: formatSetInput(set.weight),
      reps: formatSetInput(set.reps),
      rir: formatSetInput(set.rir),
    };
    completed[key] = set.isCompleted;
    ids[key] = set.id;
  }

  return { inputs, completed, ids };
}

export function usePersistedWorkoutSets(
  sessionId: string | undefined,
  initialSets: WorkoutSetRecord[],
  isReadOnly: boolean,
  isReady: boolean,
) {
  const [inputs, setInputs] = useState<Record<string, SetInputs>>({});
  const [completedSets, setCompletedSets] = useState<Record<string, boolean>>({});
  const [setErrors, setSetErrors] = useState<Record<string, string>>({});

  const inputsRef = useRef(inputs);
  const completedRef = useRef(new Set<string>());
  const idsRef = useRef<Record<string, string>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const chainRef = useRef<Record<string, Promise<void>>>({});
  const pendingKeysRef = useRef(new Set<string>());
  const readyRef = useRef(isReady);
  const readOnlyRef = useRef(isReadOnly);

  inputsRef.current = inputs;
  readyRef.current = isReady;
  readOnlyRef.current = isReadOnly;

  const hydrate = useCallback((sets: WorkoutSetRecord[]) => {
    const next = recordsToState(sets);
    inputsRef.current = next.inputs;
    completedRef.current = new Set(
      Object.entries(next.completed)
        .filter(([, isCompleted]) => isCompleted)
        .map(([key]) => key),
    );
    idsRef.current = next.ids;
    setInputs(next.inputs);
    setCompletedSets(next.completed);
    setSetErrors({});
  }, []);

  const setFieldError = useCallback((key: string, message: string | null) => {
    setSetErrors((current) => {
      if (!message) {
        if (!current[key]) {
          return current;
        }

        const next = { ...current };
        delete next[key];
        return next;
      }

      return { ...current, [key]: message };
    });
  }, []);

  const persistKey = useCallback(
    async (targetSessionId: string, key: string) => {
      const [exerciseId, setNumberValue] = key.split(':');
      const setNumber = Number(setNumberValue);
      const values = inputsRef.current[key] ?? emptyInputs();

      if (!exerciseId || !Number.isInteger(setNumber)) {
        return;
      }

      const weight = parseOptionalWeight(values.weight);
      const reps = parseOptionalReps(values.reps);
      const rir = parseOptionalRir(values.rir);

      if (!weight.ready || !reps.ready || !rir.ready) {
        return;
      }

      const result = await saveWorkoutSet(targetSessionId, {
        setId: idsRef.current[key],
        exerciseId,
        setNumber,
        weight: weight.value,
        reps: reps.value,
        rir: rir.value,
        isCompleted: completedRef.current.has(key),
      });

      if (!result.ok) {
        setFieldError(key, result.error);
        return;
      }

      idsRef.current[key] = result.data.id;
      setFieldError(key, null);
    },
    [setFieldError],
  );

  const enqueuePersist = useCallback(
    (targetSessionId: string, key: string) => {
      const previous = chainRef.current[key] ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() => persistKey(targetSessionId, key));
      chainRef.current[key] = next;
      return next;
    },
    [persistKey],
  );

  const flushSession = useCallback(
    async (targetSessionId: string) => {
      const keys = new Set([
        ...Object.keys(timersRef.current),
        ...pendingKeysRef.current,
      ]);

      for (const key of Object.keys(timersRef.current)) {
        clearTimeout(timersRef.current[key]);
        delete timersRef.current[key];
      }

      pendingKeysRef.current.clear();
      await Promise.all([...keys].map((key) => enqueuePersist(targetSessionId, key)));
    },
    [enqueuePersist],
  );

  const schedulePersist = useCallback(
    (key: string) => {
      if (!sessionId || !readyRef.current || readOnlyRef.current || completedRef.current.has(key)) {
        return;
      }

      const targetSessionId = sessionId;
      pendingKeysRef.current.add(key);

      const existing = timersRef.current[key];

      if (existing) {
        clearTimeout(existing);
      }

      timersRef.current[key] = setTimeout(() => {
        delete timersRef.current[key];
        pendingKeysRef.current.delete(key);
        void enqueuePersist(targetSessionId, key);
      }, DEBOUNCE_MS);
    },
    [enqueuePersist, sessionId],
  );

  const updateInput = useCallback(
    (key: string, field: keyof SetInputs, value: string) => {
      if (!readyRef.current || readOnlyRef.current || completedRef.current.has(key)) {
        return;
      }

      setInputs((current) => {
        const next = {
          ...current,
          [key]: {
            ...(current[key] ?? emptyInputs()),
            [field]: value,
          },
        };
        inputsRef.current = next;
        return next;
      });
      setFieldError(key, null);
      schedulePersist(key);
    },
    [schedulePersist, setFieldError],
  );

  const completeSet = useCallback(
    async (exerciseId: string, setNumber: number): Promise<CompleteResult> => {
      const key = setKey(exerciseId, setNumber);

      if (!sessionId || !readyRef.current || readOnlyRef.current || completedRef.current.has(key)) {
        return { ok: false };
      }

      const values = inputsRef.current[key] ?? emptyInputs();
      const weight = parseOptionalWeight(values.weight);
      const reps = parseOptionalReps(values.reps);
      const rir = parseOptionalRir(values.rir);

      if (!weight.ready || weight.value === null || !reps.ready || reps.value === null) {
        setFieldError(key, 'Enter weight and reps before completing this set.');
        return { ok: false };
      }

      if (!rir.ready) {
        setFieldError(key, 'Enter a valid RIR or leave it blank.');
        return { ok: false };
      }

      completedRef.current.add(key);
      setCompletedSets((current) => ({ ...current, [key]: true }));
      setFieldError(key, null);

      const timer = timersRef.current[key];

      if (timer) {
        clearTimeout(timer);
        delete timersRef.current[key];
      }

      pendingKeysRef.current.delete(key);

      const result = await saveWorkoutSet(sessionId, {
        setId: idsRef.current[key],
        exerciseId,
        setNumber,
        weight: weight.value,
        reps: reps.value,
        rir: rir.value,
        isCompleted: true,
      });

      if (!result.ok) {
        completedRef.current.delete(key);
        setCompletedSets((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
        setFieldError(key, result.error);
        return { ok: false };
      }

      idsRef.current[key] = result.data.id;
      return { ok: true };
    },
    [sessionId, setFieldError],
  );

  const flushAll = useCallback(async () => {
    if (!sessionId || !readyRef.current) {
      return;
    }

    await flushSession(sessionId);
  }, [flushSession, sessionId]);

  useLayoutEffect(() => {
    if (!isReady || !sessionId) {
      return;
    }

    hydrate(initialSets);

    return () => {
      void flushSession(sessionId);
    };
    // Hydrate from the render where this session became ready so later parent
    // renders cannot reset in-progress inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [flushSession, hydrate, isReady, sessionId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && sessionId && readyRef.current) {
        void flushSession(sessionId);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [flushSession, sessionId]);

  return {
    inputs,
    completedSets,
    setErrors,
    updateInput,
    completeSet,
    flushAll,
  };
}
