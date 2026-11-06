import { REPS_MAX, REPS_MIN, SETS_MAX, SETS_MIN } from './import/limits.ts';

// Today's plan is separate from the saved routine and from logged reps.
// Suggestions are never treated as numbers that were imported.

export const SUGGESTED_SETS = 3;
export const SUGGESTED_REPS = 8;

export const SUGGESTION_NOTE = 'Suggestion, not from the import: 3 sets × 8 reps.';

export const SUGGESTION_SETS_NOTE = 'Suggestion, not from the import: 3 sets.';

export const SUGGESTION_REPS_NOTE = 'Suggestion, not from the import: 8 reps.';

export type TodayTarget = {
  sets: number | null;
  reps: number | null;
};

export type TodayTargetStore = {
  read(sessionId: string): string | null;
  write(sessionId: string, value: string): void;
};

const SESSION_ID = /^[1-9][0-9]{0,18}$/;

export function missingTargetFields(input: {
  todaySets: number | null;
  todayReps: number | null;
  prescribedSets: number | null;
  prescribedRepsMin: number | null;
  prescribedRepsMax: number | null;
  recordedMax: number;
}): { sets: boolean; reps: boolean } {
  const setsKnown = input.todaySets != null || input.prescribedSets != null || input.recordedMax > 0;
  const repsKnown =
    input.todayReps != null || (input.prescribedRepsMin != null && input.prescribedRepsMax != null);
  return { sets: !setsKnown, reps: !repsKnown };
}

export function prescribedRepsLine(minReps: number, maxReps: number): string | null {
  if (!Number.isInteger(minReps) || !Number.isInteger(maxReps) || minReps < 1 || maxReps < 1 || minReps > maxReps) {
    return null;
  }
  return `${minReps}–${maxReps} reps`;
}

export function visibleSetCount(input: {
  todaySets: number | null;
  prescribedSets: number | null;
  recordedMax: number;
}): number {
  if (input.todaySets != null) {
    return input.todaySets;
  }
  if (input.prescribedSets != null) {
    return Math.max(input.prescribedSets, input.recordedMax);
  }
  return input.recordedMax;
}

export function plannedRepsLabel(input: {
  todayReps: number | null;
  prescribedRepsMin: number | null;
  prescribedRepsMax: number | null;
}): string {
  if (input.todayReps != null) {
    return String(input.todayReps);
  }
  if (input.prescribedRepsMin != null && input.prescribedRepsMax != null) {
    return input.prescribedRepsMin === input.prescribedRepsMax
      ? String(input.prescribedRepsMin)
      : `${input.prescribedRepsMin}–${input.prescribedRepsMax}`;
  }
  return '';
}

export function acceptedTodayTarget(input: {
  askSets: boolean;
  askReps: boolean;
  setsText: string;
  repsText: string;
  existingSets: number | null;
  existingReps: number | null;
}): { ok: true; sets: number | null; reps: number | null } | { ok: false; error: string } {
  const sets = input.askSets ? readCount(input.setsText, SETS_MIN, SETS_MAX, 'sets') : input.existingSets;
  const reps = input.askReps ? readCount(input.repsText, REPS_MIN, REPS_MAX, 'reps') : input.existingReps;
  if (input.askSets && typeof sets !== 'number') {
    return { ok: false, error: typeof sets === 'string' ? sets : 'Enter sets before continuing.' };
  }
  if (input.askReps && typeof reps !== 'number') {
    return { ok: false, error: typeof reps === 'string' ? reps : 'Enter reps before continuing.' };
  }
  return {
    ok: true,
    sets: typeof sets === 'number' ? sets : null,
    reps: typeof reps === 'number' ? reps : null,
  };
}

export function routineRepsToStore(input: {
  todayReps: number | null;
  prescribedRepsMin: number | null;
  prescribedRepsMax: number | null;
}): { min: number; max: number } | null {
  if (input.todayReps != null) {
    if (!inRange(input.todayReps, REPS_MIN, REPS_MAX)) {
      return null;
    }
    return { min: input.todayReps, max: input.todayReps };
  }
  if (
    input.prescribedRepsMin != null &&
    input.prescribedRepsMax != null &&
    inRange(input.prescribedRepsMin, REPS_MIN, REPS_MAX) &&
    inRange(input.prescribedRepsMax, REPS_MIN, REPS_MAX) &&
    input.prescribedRepsMin <= input.prescribedRepsMax
  ) {
    return { min: input.prescribedRepsMin, max: input.prescribedRepsMax };
  }
  return null;
}

export function routineSetsToStore(input: { todaySets: number | null; prescribedSets: number | null; recordedMax: number }): number | null {
  const sets = input.todaySets ?? input.prescribedSets ?? (input.recordedMax > 0 ? input.recordedMax : null);
  if (sets == null || !inRange(sets, SETS_MIN, SETS_MAX)) {
    return null;
  }
  return sets;
}

export function acceptedProgramExerciseTargets(
  programExerciseId: string,
  targets: { sets: number; repsMin: number; repsMax: number },
):
  | { ok: true; id: string; sets: number; repsMin: number; repsMax: number }
  | { ok: false; error: string } {
  if (!/^[1-9][0-9]*$/.test(programExerciseId)) {
    return { ok: false, error: 'Choose the saved exercise before updating the routine.' };
  }
  if (!inRange(targets.sets, SETS_MIN, SETS_MAX)) {
    return { ok: false, error: 'Enter sets from 1 through 12 before updating the routine.' };
  }
  if (
    !inRange(targets.repsMin, REPS_MIN, REPS_MAX) ||
    !inRange(targets.repsMax, REPS_MIN, REPS_MAX) ||
    targets.repsMin > targets.repsMax
  ) {
    return { ok: false, error: 'Enter reps from 1 through 100 before updating the routine.' };
  }
  return {
    ok: true,
    id: programExerciseId,
    sets: targets.sets,
    repsMin: targets.repsMin,
    repsMax: targets.repsMax,
  };
}

export function canRemoveSet(set: { isCompleted: boolean }, finished: boolean): boolean {
  return !finished && !set.isCompleted;
}

export function removableSetNumber(
  sets: readonly { setNumber: number; isCompleted: boolean }[],
  finished: boolean,
): number | null {
  if (finished || sets.length === 0) {
    return null;
  }
  const max = sets.reduce((highest, set) => Math.max(highest, set.setNumber), 0);
  const highest = sets.find((set) => set.setNumber === max);
  if (!highest || highest.isCompleted) {
    return null;
  }
  return max;
}

export function readTodayTargets(store: TodayTargetStore, sessionId: string): Record<string, TodayTarget> {
  if (!SESSION_ID.test(sessionId)) {
    return {};
  }
  const raw = store.read(sessionId);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const targets: Record<string, TodayTarget> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^[1-9][0-9]{0,18}$/.test(key) || !value || typeof value !== 'object') {
        continue;
      }
      const record = value as Record<string, unknown>;
      targets[key] = {
        sets: optionalCount(record.sets, SETS_MIN, SETS_MAX),
        reps: optionalCount(record.reps, REPS_MIN, REPS_MAX),
      };
    }
    return targets;
  } catch {
    return {};
  }
}

export function writeTodayTarget(
  store: TodayTargetStore,
  sessionId: string,
  programExerciseId: string,
  target: TodayTarget,
): Record<string, TodayTarget> {
  const current = readTodayTargets(store, sessionId);
  if (!SESSION_ID.test(sessionId) || !/^[1-9][0-9]{0,18}$/.test(programExerciseId)) {
    return current;
  }
  const next = {
    ...current,
    [programExerciseId]: {
      sets: optionalCount(target.sets, SETS_MIN, SETS_MAX),
      reps: optionalCount(target.reps, REPS_MIN, REPS_MAX),
    },
  };
  store.write(sessionId, JSON.stringify(next));
  return next;
}

function readCount(value: string, min: number, max: number, label: string): number | string {
  const text = value.trim();
  if (!/^[0-9]+$/.test(text)) {
    return `Enter ${label} from ${min} through ${max}.`;
  }
  const parsed = Number(text);
  if (!inRange(parsed, min, max)) {
    return `Enter ${label} from ${min} through ${max}.`;
  }
  return parsed;
}

function optionalCount(value: unknown, min: number, max: number): number | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'number' || !inRange(value, min, max)) {
    return null;
  }
  return value;
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}
