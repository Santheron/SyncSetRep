import { getExerciseProgression } from '@/lib/progression';
import { supabase } from '@/lib/supabase';
import { unwrapRelation } from '@/lib/workout-format';

export type ProgramDayOption = {
  id: string;
  dayOrder: number;
  name: string;
  subtitle: string;
  exerciseCount: number;
};

export type UnfinishedSession = {
  id: string;
  programDayId: string;
  startedAt: string;
  name: string;
  subtitle: string;
};

export type WorkoutExercise = {
  id: string;
  name: string;
  category: string;
  exerciseType: string;
  equipmentType: string | null;
  warmupEnabled: boolean | null;
  minWeight: number | null;
  weightIncrement: number | null;
};

export type ProgramExercise = {
  id: string;
  programExerciseId: string;
  exerciseOrder: number;
  targetSets: number;
  minReps: number;
  maxReps: number;
  notes: string | null;
  exercise: WorkoutExercise | null;
};

export type ExerciseOverrides = Record<string, string>;
export type ExerciseSwapScope = 'session' | 'program';

export type WorkoutSetRecord = {
  id: string;
  exerciseId: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  rir: number | null;
  isCompleted: boolean;
};

export type PreviousWorkoutSession = {
  id: string;
  startedAt: string;
  finishedAt: string;
};

export type ExercisePreviousPerformance = {
  exerciseId: string;
  session: PreviousWorkoutSession;
  sets: WorkoutSetRecord[];
};

export type ActiveWorkout = {
  sessionId: string;
  finishedAt: string | null;
  programDay: {
    id: string;
    name: string;
    subtitle: string;
  };
  exercises: ProgramExercise[];
  sets: WorkoutSetRecord[];
  previousPerformance: ExercisePreviousPerformance[];
  previousError: string | null;
};

export type WorkoutSetDraft = {
  setId?: string;
  exerciseId: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  rir: number | null;
  isCompleted: boolean;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

type ProgramDayRow = {
  id: string;
  day_order: number;
  name: string;
  subtitle: string;
  program_exercises: { id: string }[] | null;
};

type ProgramDayRef = {
  id: string;
  name: string;
  subtitle: string;
};

type SessionRow = {
  id: string;
  program_day_id: string;
  started_at: string;
  finished_at: string | null;
  notes?: string | null;
  exercise_overrides?: ExerciseOverrides | null;
  program_day: ProgramDayRef | ProgramDayRef[] | null;
};

type ExerciseRow = {
  id: string;
  name: string;
  category: string;
  exercise_type: string;
  equipment_type: string | null;
  warmup_enabled: boolean | null;
  min_weight: number | null;
  weight_increment: number | null;
};

type ProgramExerciseRow = {
  id: string;
  exercise_order: number;
  target_sets: number;
  min_reps: number;
  max_reps: number;
  notes: string | null;
  exercise: ExerciseRow | ExerciseRow[] | null;
};

type WorkoutSetRow = {
  id: string;
  exercise_id: string;
  set_number: number;
  weight: number | null;
  reps: number | null;
  rir: number | null;
  is_completed: boolean | null;
};

type HistoricalSetRow = WorkoutSetRow & {
  workout_session_id: string;
};

type FinishedSessionRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
};

const PROGRAM_EXERCISE_SELECT = `
  id,
  exercise_order,
  target_sets,
  min_reps,
  max_reps,
  notes,
  exercise:exercises (
    id,
    name,
    category,
    exercise_type,
    equipment_type,
    warmup_enabled,
    min_weight,
    weight_increment
  )
`;

function toExercise(row: ExerciseRow | ExerciseRow[] | null): WorkoutExercise | null {
  const exercise = unwrapRelation(row);

  if (!exercise) {
    return null;
  }

  return {
    id: String(exercise.id),
    name: exercise.name ?? '',
    category: exercise.category ?? '',
    exerciseType: String(exercise.exercise_type ?? ''),
    equipmentType: exercise.equipment_type == null ? null : String(exercise.equipment_type),
    warmupEnabled:
      exercise.warmup_enabled === null || exercise.warmup_enabled === undefined
        ? null
        : Boolean(exercise.warmup_enabled),
    minWeight: toFiniteNumber(exercise.min_weight),
    weightIncrement: toFiniteNumber(exercise.weight_increment),
  };
}

function toProgramExercise(row: ProgramExerciseRow): ProgramExercise {
  const id = String(row.id);

  return {
    id,
    programExerciseId: id,
    exerciseOrder: toFiniteNumber(row.exercise_order) ?? 0,
    targetSets: toFiniteNumber(row.target_sets) ?? 0,
    minReps: toFiniteNumber(row.min_reps) ?? 0,
    maxReps: toFiniteNumber(row.max_reps) ?? 0,
    notes: row.notes == null ? null : String(row.notes),
    exercise: toExercise(row.exercise),
  };
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toSetRecord(row: WorkoutSetRow): WorkoutSetRecord {
  return {
    id: String(row.id),
    exerciseId: String(row.exercise_id),
    setNumber: toFiniteNumber(row.set_number) ?? 0,
    weight: toFiniteNumber(row.weight),
    reps: toFiniteNumber(row.reps),
    rir: toFiniteNumber(row.rir),
    isCompleted: Boolean(row.is_completed),
  };
}

function pickSetRecord(
  rows: WorkoutSetRecord[],
  exerciseId: string,
  setNumber: number,
): WorkoutSetRecord | undefined {
  const matches = rows.filter(
    (row) => row.exerciseId === exerciseId && row.setNumber === setNumber,
  );

  return matches.find((row) => row.isCompleted) ?? matches[0];
}

async function fetchProgramExercises(programDayId: string): Promise<Result<ProgramExercise[]>> {
  const { data, error } = await supabase
    .from('program_exercises')
    .select(PROGRAM_EXERCISE_SELECT)
    .eq('program_day_id', programDayId)
    .order('exercise_order', { ascending: true });

  if (error) {
    console.error('[ProgramExercises] query error', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return { ok: false, error: formatSupabaseError(error) };
  }

  return {
    ok: true,
    data: ((data ?? []) as ProgramExerciseRow[]).map(toProgramExercise),
  };
}

async function fetchWorkoutExercisesByIds(ids: string[]): Promise<Result<WorkoutExercise[]>> {
  if (ids.length === 0) {
    return { ok: true, data: [] };
  }

  const { data, error } = await supabase
    .from('exercises')
    .select(
      'id, name, category, exercise_type, equipment_type, warmup_enabled, min_weight, weight_increment',
    )
    .in('id', ids);

  if (error) {
    console.error('[Exercises] query error', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return { ok: false, error: formatSupabaseError(error) };
  }

  return {
    ok: true,
    data: ((data ?? []) as ExerciseRow[])
      .map((row) => toExercise(row))
      .filter((exercise): exercise is WorkoutExercise => exercise !== null),
  };
}

function uniqueExerciseIds(ids: Array<string | null | undefined>): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const value of ids) {
    const id = value ? String(value) : '';

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    unique.push(id);
  }

  return unique;
}

function maxSetNumber(rows: WorkoutSetRecord[], exerciseId: string): number {
  let max = 0;

  for (const row of rows) {
    if (row.exerciseId === exerciseId && row.setNumber > max) {
      max = row.setNumber;
    }
  }

  return max;
}

function parseExerciseOverrides(row: SessionRow): ExerciseOverrides {
  const overrides: ExerciseOverrides = {};

  function merge(raw: unknown) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return;
    }

    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (key && value != null && String(value).trim()) {
        overrides[String(key)] = String(value);
      }
    }
  }

  merge(row.exercise_overrides);

  if (Object.keys(overrides).length === 0 && row.notes) {
    try {
      const parsed = JSON.parse(row.notes) as { exercise_overrides?: unknown };
      merge(parsed?.exercise_overrides);
    } catch {
      // Session notes are unused by the app; ignore non-JSON values.
    }
  }

  return overrides;
}

function isMissingColumnError(
  error: { code?: string | null; message?: string | null },
  column: string,
): boolean {
  const message = error.message?.toLowerCase() ?? '';
  const name = column.toLowerCase();
  return (
    (error.code === 'PGRST204' || error.code === '42703') && message.includes(name)
  );
}

async function planExercisesForSession(
  programDayId: string,
  finishedAt: string | null,
  setRows: WorkoutSetRecord[],
  overrides: ExerciseOverrides,
): Promise<Result<ProgramExercise[]>> {
  const currentResult = await fetchProgramExercises(programDayId);

  if (!currentResult.ok) {
    return currentResult;
  }

  const overrideIds = uniqueExerciseIds(Object.values(overrides));
  const setExerciseIds = uniqueExerciseIds(setRows.map((row) => row.exerciseId));
  const programExerciseIds = uniqueExerciseIds(
    currentResult.data.map((item) => item.exercise?.id),
  );
  const missingIds = uniqueExerciseIds([
    ...setExerciseIds,
    ...overrideIds,
  ]).filter((id) => !programExerciseIds.includes(id));
  const missingResult = await fetchWorkoutExercisesByIds(missingIds);

  if (!missingResult.ok) {
    return missingResult;
  }

  const exercisesById = new Map<string, WorkoutExercise>();

  for (const item of currentResult.data) {
    if (item.exercise?.id) {
      exercisesById.set(String(item.exercise.id), item.exercise);
    }
  }

  for (const exercise of missingResult.data) {
    exercisesById.set(exercise.id, exercise);
  }

  if (finishedAt || (setRows.length === 0 && overrideIds.length === 0)) {
    return currentResult;
  }

  const plan: ProgramExercise[] = [];
  const used = new Set<string>();

  for (const item of currentResult.data) {
    const programExerciseId = String(item.programExerciseId || item.id);
    const originalExercise = item.exercise;
    const originalId = originalExercise?.id ? String(originalExercise.id) : null;
    const overrideId = overrides[programExerciseId]
      ? String(overrides[programExerciseId])
      : null;
    const replacement =
      overrideId && overrideId !== originalId
        ? exercisesById.get(overrideId) ?? null
        : null;
    const displayExercise = replacement ?? originalExercise;
    const displayId = displayExercise?.id ? String(displayExercise.id) : null;
    const completedOriginal =
      originalId && displayId && originalId !== displayId
        ? setRows.filter((row) => row.exerciseId === originalId && row.isCompleted)
        : [];

    if (completedOriginal.length > 0 && originalExercise && originalId) {
      plan.push({
        ...item,
        id: `${programExerciseId}:logged`,
        programExerciseId,
        targetSets: Math.max(
          maxSetNumber(setRows, originalId),
          completedOriginal.length,
        ),
        exercise: originalExercise,
      });
      used.add(originalId);
    }

    if (!displayId || !displayExercise) {
      continue;
    }

    const hasDisplaySets = setRows.some((row) => row.exerciseId === displayId);
    const keepWithoutSets =
      setRows.length === 0 || Boolean(overrideId) || hasDisplaySets;

    if (!keepWithoutSets) {
      continue;
    }

    const remainingTarget = Math.max(
      item.targetSets - completedOriginal.length,
      maxSetNumber(setRows, displayId),
    );

    if (!hasDisplaySets && remainingTarget < 1) {
      continue;
    }

    plan.push({
      ...item,
      id:
        completedOriginal.length > 0
          ? `${programExerciseId}:swap`
          : programExerciseId,
      programExerciseId,
      targetSets: Math.max(remainingTarget, hasDisplaySets ? maxSetNumber(setRows, displayId) : item.targetSets),
      exercise: displayExercise,
    });
    used.add(displayId);
  }

  for (const exerciseId of setExerciseIds) {
    if (used.has(exerciseId)) {
      continue;
    }

    const exercise = exercisesById.get(exerciseId);

    if (!exercise) {
      continue;
    }

    plan.push({
      id: `session:${exerciseId}`,
      programExerciseId: `session:${exerciseId}`,
      exerciseOrder: plan.length + 1,
      targetSets: Math.max(maxSetNumber(setRows, exerciseId), 1),
      minReps: 0,
      maxReps: 0,
      notes: null,
      exercise,
    });
  }

  if (plan.length === 0) {
    return currentResult;
  }

  return { ok: true, data: plan };
}

async function fetchWorkoutSets(sessionId: string): Promise<Result<WorkoutSetRecord[]>> {
  const { data, error } = await supabase
    .from('workout_sets')
    .select('id, exercise_id, set_number, weight, reps, rir, is_completed')
    .eq('workout_session_id', sessionId)
    .order('set_number', { ascending: true });

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    data: ((data ?? []) as WorkoutSetRow[]).map(toSetRecord),
  };
}

const SESSION_SELECT_WITH_OVERRIDES = `
  id,
  program_day_id,
  started_at,
  finished_at,
  notes,
  exercise_overrides,
  program_day:program_days (
    id,
    name,
    subtitle
  )
`;

const SESSION_SELECT_BASE = `
  id,
  program_day_id,
  started_at,
  finished_at,
  notes,
  program_day:program_days (
    id,
    name,
    subtitle
  )
`;

async function fetchWorkoutSession(sessionId: string): Promise<Result<SessionRow>> {
  const withOverrides = await supabase
    .from('workout_sessions')
    .select(SESSION_SELECT_WITH_OVERRIDES)
    .eq('id', sessionId)
    .maybeSingle();

  if (
    withOverrides.error &&
    isMissingColumnError(withOverrides.error, 'exercise_overrides')
  ) {
    const fallback = await supabase
      .from('workout_sessions')
      .select(SESSION_SELECT_BASE)
      .eq('id', sessionId)
      .maybeSingle();

    if (fallback.error || !fallback.data) {
      return {
        ok: false,
        error: fallback.error?.message ?? 'Workout session not found.',
      };
    }

    return { ok: true, data: fallback.data as SessionRow };
  }

  if (withOverrides.error || !withOverrides.data) {
    return {
      ok: false,
      error: withOverrides.error?.message ?? 'Workout session not found.',
    };
  }

  return { ok: true, data: withOverrides.data as SessionRow };
}

function formatSupabaseError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}): string {
  console.error('[Supabase]', {
    code: error.code ?? null,
    message: error.message ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  });

  return [
    error.code,
    error.message,
    error.details,
    error.hint,
  ]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .join(' | ');
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallback;
}

function logPreviousPerformance(details: {
  exerciseId: string;
  exerciseName: string;
  activeSessionId: string | null;
  historicalSessionsFound: number;
  selectedSessionId: string | null;
  setsFound: number;
}) {
  console.log(`[PreviousPerformance]
exerciseId: ${details.exerciseId}
exerciseName: ${details.exerciseName}
activeSessionId: ${details.activeSessionId}
historicalSessionsFound: ${details.historicalSessionsFound}
selectedSessionId: ${details.selectedSessionId}
setsFound: ${details.setsFound}`);
}

function isNewerFinishedSession(
  candidate: FinishedSessionRow,
  current: FinishedSessionRow | null,
): boolean {
  if (!candidate.finished_at) {
    return false;
  }

  const candidateTime = Date.parse(candidate.finished_at);

  if (!Number.isFinite(candidateTime)) {
    return false;
  }

  if (!current?.finished_at) {
    return true;
  }

  const currentTime = Date.parse(current.finished_at);

  if (!Number.isFinite(currentTime) || candidateTime !== currentTime) {
    return !Number.isFinite(currentTime) || candidateTime > currentTime;
  }

  return candidate.started_at > current.started_at;
}

async function fetchPreviousPerformanceByExercises(
  exercises: { exerciseId: string; exerciseName: string }[],
  excludeSessionId?: string,
): Promise<Result<ExercisePreviousPerformance[]>> {
  const uniqueExercises: { exerciseId: string; exerciseName: string }[] = [];
  const seen = new Set<string>();

  for (const exercise of exercises) {
    const exerciseId = String(exercise.exerciseId);

    if (!exerciseId || seen.has(exerciseId)) {
      continue;
    }

    seen.add(exerciseId);
    uniqueExercises.push({
      exerciseId,
      exerciseName: exercise.exerciseName,
    });
  }

  const exerciseIds = uniqueExercises.map((exercise) => exercise.exerciseId);
  console.log('[PreviousPerformance] request start', {
    activeSessionId: excludeSessionId ?? null,
    exerciseIds,
  });

  if (uniqueExercises.length === 0) {
    console.log('[PreviousPerformance] result built', { count: 0 });
    return { ok: true, data: [] };
  }

  let setsQuery = supabase
    .from('workout_sets')
    .select(
      'id, exercise_id, set_number, weight, reps, rir, is_completed, workout_session_id',
    )
    .in('exercise_id', exerciseIds)
    .eq('is_completed', true);

  if (excludeSessionId) {
    setsQuery = setsQuery.neq('workout_session_id', excludeSessionId);
  }

  const { data: setRows, error: setsError } = await setsQuery.order('set_number', {
    ascending: true,
  });

  console.log('[PreviousPerformance] sets response', {
    error: setsError ?? null,
    count: setRows?.length ?? 0,
    sampleWeightType:
      setRows && setRows.length > 0 ? typeof (setRows[0] as HistoricalSetRow).weight : null,
  });

  if (setsError) {
    console.error('[PreviousPerformance] query error', setsError);
    return { ok: false, error: setsError.message };
  }

  const historicalSets = ((setRows ?? []) as HistoricalSetRow[]).filter(
    (row) => toFiniteNumber(row.reps) !== null,
  );
  const sessionIds = [
    ...new Set(historicalSets.map((row) => String(row.workout_session_id))),
  ];
  const sessionsById = new Map<string, FinishedSessionRow>();

  if (sessionIds.length > 0) {
    const { data: sessions, error: sessionsError } = await supabase
      .from('workout_sessions')
      .select('id, started_at, finished_at')
      .in('id', sessionIds)
      .not('finished_at', 'is', null);

    console.log('[PreviousPerformance] sessions response', {
      error: sessionsError ?? null,
      count: sessions?.length ?? 0,
    });

    if (sessionsError) {
      console.error('[PreviousPerformance] query error', sessionsError);
      return { ok: false, error: sessionsError.message };
    }

    for (const session of (sessions ?? []) as FinishedSessionRow[]) {
      if (!session.finished_at) {
        continue;
      }

      sessionsById.set(String(session.id), {
        id: String(session.id),
        started_at: session.started_at,
        finished_at: session.finished_at,
      });
    }
  } else {
    console.log('[PreviousPerformance] sessions response', {
      error: null,
      count: 0,
    });
  }

  const previousPerformance: ExercisePreviousPerformance[] = [];

  for (const exercise of uniqueExercises) {
    const exerciseRows = historicalSets.filter(
      (row) => String(row.exercise_id) === exercise.exerciseId,
    );
    const historicalSessionIds = new Set<string>();
    let selectedSession: FinishedSessionRow | null = null;

    for (const row of exerciseRows) {
      const session = sessionsById.get(String(row.workout_session_id));

      if (!session) {
        continue;
      }

      historicalSessionIds.add(session.id);

      if (isNewerFinishedSession(session, selectedSession)) {
        selectedSession = session;
      }
    }

    const selectedSets = selectedSession
      ? exerciseRows
          .filter((row) => String(row.workout_session_id) === selectedSession.id)
          .sort(
            (a, b) =>
              (toFiniteNumber(a.set_number) ?? 0) - (toFiniteNumber(b.set_number) ?? 0),
          )
          .map(toSetRecord)
      : [];

    logPreviousPerformance({
      exerciseId: exercise.exerciseId,
      exerciseName: exercise.exerciseName,
      activeSessionId: excludeSessionId ?? null,
      historicalSessionsFound: historicalSessionIds.size,
      selectedSessionId: selectedSession?.id ?? null,
      setsFound: selectedSets.length,
    });

    if (!selectedSession?.finished_at) {
      continue;
    }

    previousPerformance.push({
      exerciseId: exercise.exerciseId,
      session: {
        id: selectedSession.id,
        startedAt: selectedSession.started_at,
        finishedAt: selectedSession.finished_at,
      },
      sets: selectedSets,
    });
  }

  console.log('[PreviousPerformance] result built', {
    count: previousPerformance.length,
  });
  return { ok: true, data: previousPerformance };
}

export async function fetchPreviousPerformanceForExercises(
  exercises: { exerciseId: string; exerciseName: string }[],
  excludeSessionId?: string,
): Promise<Result<ExercisePreviousPerformance[]>> {
  try {
    return await fetchPreviousPerformanceByExercises(exercises, excludeSessionId);
  } catch (error) {
    console.error('[PreviousPerformance] query error', error);
    return {
      ok: false,
      error: errorMessage(error, 'Could not load previous performance.'),
    };
  }
}

function previousSetsForExercise(
  previousPerformance: ExercisePreviousPerformance[] | null | undefined,
  exerciseId: string,
): WorkoutSetRecord[] {
  const id = String(exerciseId);
  const match = (previousPerformance ?? []).find(
    (item) => String(item.exerciseId) === id,
  );

  return Array.isArray(match?.sets) ? match.sets : [];
}

function recommendedStartWeight(
  item: ProgramExercise,
  previousSets: WorkoutSetRecord[] | null | undefined,
): number | null {
  if (!item.exercise) {
    return null;
  }

  try {
    const progression = getExerciseProgression({
      name: item.exercise.name ?? '',
      category: item.exercise.category,
      exerciseType: item.exercise.exerciseType,
      equipmentType: item.exercise.equipmentType,
      targetSets: item.targetSets,
      minReps: item.minReps,
      maxReps: item.maxReps,
      weightIncrement: item.exercise.weightIncrement,
      previousSets: previousSets ?? [],
    });

    if (progression.isBodyweight) {
      return null;
    }

    const weight = toFiniteNumber(progression.recommendedWeight);
    return weight !== null && weight > 0 ? weight : null;
  } catch (error) {
    console.error('[PreviousPerformance] prefill skipped', {
      exerciseId: item.exercise.id,
      exerciseName: item.exercise.name,
      error,
    });
    return null;
  }
}

async function deleteSessionsAndSets(sessionIds: string[]): Promise<Result<true>> {
  if (sessionIds.length === 0) {
    return { ok: true, data: true };
  }

  const { error: setsError } = await supabase
    .from('workout_sets')
    .delete()
    .in('workout_session_id', sessionIds);

  if (setsError) {
    return { ok: false, error: setsError.message };
  }

  const { error: sessionsError } = await supabase
    .from('workout_sessions')
    .delete()
    .in('id', sessionIds)
    .is('finished_at', null);

  if (sessionsError) {
    return { ok: false, error: sessionsError.message };
  }

  return { ok: true, data: true };
}

export async function listProgramDays(): Promise<Result<ProgramDayOption[]>> {
  const { data, error } = await supabase
    .from('program_days')
    .select(
      `
      id,
      day_order,
      name,
      subtitle,
      program_exercises (
        id
      )
    `,
    )
    .order('day_order', { ascending: true });

  if (error) {
    console.error('[ProgramDays] query error', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return { ok: false, error: formatSupabaseError(error) };
  }

  const days = ((data ?? []) as ProgramDayRow[]).map((row) => ({
    id: String(row.id),
    dayOrder: toFiniteNumber(row.day_order) ?? 0,
    name: row.name,
    subtitle: row.subtitle,
    exerciseCount: row.program_exercises?.length ?? 0,
  }));

  return { ok: true, data: days };
}

export async function listUnfinishedSessions(): Promise<Result<UnfinishedSession[]>> {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(
      `
      id,
      program_day_id,
      started_at,
      finished_at,
      program_day:program_days (
        id,
        name,
        subtitle
      )
    `,
    )
    .is('finished_at', null)
    .order('started_at', { ascending: false });

  if (error) {
    return { ok: false, error: error.message };
  }

  const sessions = ((data ?? []) as SessionRow[]).map((row) => {
    const programDay = unwrapRelation(row.program_day);

    return {
      id: String(row.id),
      programDayId: String(row.program_day_id),
      startedAt: row.started_at,
      name: programDay?.name ?? 'Workout',
      subtitle: programDay?.subtitle ?? '',
    };
  });

  return { ok: true, data: sessions };
}

export async function getLatestUnfinishedSession(): Promise<Result<UnfinishedSession | null>> {
  const result = await listUnfinishedSessions();

  if (!result.ok) {
    return result;
  }

  return { ok: true, data: result.data[0] ?? null };
}

export async function discardUnfinishedSessions(): Promise<Result<true>> {
  const result = await listUnfinishedSessions();

  if (!result.ok) {
    return result;
  }

  return deleteSessionsAndSets(result.data.map((session) => session.id));
}

export async function startWorkoutForDay(programDayId: string): Promise<Result<{ sessionId: string }>> {
  try {
    console.log('[StartWorkout] pressed', { programDayId });
    const unfinishedResult = await listUnfinishedSessions();

    if (!unfinishedResult.ok) {
      return unfinishedResult;
    }

    if (unfinishedResult.data.length > 0) {
      const existing = unfinishedResult.data[0];
      console.log('[startWorkout] reusing unfinished session', {
        session_id: existing.id,
        program_day_id: existing.programDayId,
      });
      return { ok: true, data: { sessionId: String(existing.id) } };
    }

    const exercisesResult = await fetchProgramExercises(programDayId);

    if (!exercisesResult.ok) {
      return { ok: false, error: exercisesResult.error };
    }

    const { data: session, error: sessionError } = await supabase
      .from('workout_sessions')
      .insert({
        program_day_id: programDayId,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle();

    if (sessionError || !session) {
      console.log('[startWorkout] insert error', {
        program_day_id: programDayId,
        error_code: sessionError?.code,
        error_message: sessionError?.message,
      });
      return { ok: false, error: sessionError?.message ?? 'Could not start workout.' };
    }

    console.log('[StartWorkout] session created', { sessionId: String(session.id) });

    let previousPerformance: ExercisePreviousPerformance[] = [];

    try {
      const previousResult = await fetchPreviousPerformanceForExercises(
        exercisesResult.data.flatMap((item) =>
          item.exercise
            ? [{ exerciseId: String(item.exercise.id), exerciseName: item.exercise.name }]
            : [],
        ),
      );

      if (previousResult.ok) {
        previousPerformance = previousResult.data;
      } else {
        console.error('[PreviousPerformance] query error', previousResult.error);
      }
    } catch (error) {
      console.error('[PreviousPerformance] query error', error);
    }

    const setRows = exercisesResult.data.flatMap((item) => {
      const exerciseId = item.exercise?.id ? String(item.exercise.id) : null;
      const targetSets = toFiniteNumber(item.targetSets) ?? 0;

      if (!exerciseId || targetSets < 1) {
        return [];
      }

      const recommendedWeight = recommendedStartWeight(
        item,
        previousSetsForExercise(previousPerformance, exerciseId),
      );

      return Array.from({ length: targetSets }, (_, index) => ({
        workout_session_id: session.id,
        exercise_id: exerciseId,
        set_number: index + 1,
        weight: recommendedWeight,
        reps: null,
        rir: null,
        is_completed: false,
      }));
    });

    if (setRows.length > 0) {
      const { error: setsError } = await supabase.from('workout_sets').insert(setRows);

      if (setsError) {
        await deleteSessionsAndSets([session.id]);
        return { ok: false, error: setsError.message };
      }
    }

    return { ok: true, data: { sessionId: String(session.id) } };
  } catch (error) {
    console.error('[WorkoutStart CRASH]', error);
    return {
      ok: false,
      error: errorMessage(error, 'Could not start workout.'),
    };
  }
}

export async function loadActiveWorkout(sessionId: string): Promise<Result<ActiveWorkout>> {
  try {
    const sessionResult = await fetchWorkoutSession(sessionId);

  if (!sessionResult.ok) {
    return sessionResult;
  }

  const sessionRow = sessionResult.data;
  const programDay = unwrapRelation(sessionRow.program_day);

  if (!programDay) {
    return { ok: false, error: 'Program day not found for this workout.' };
  }

  const setsResult = await fetchWorkoutSets(sessionId);

  if (!setsResult.ok) {
    return { ok: false, error: setsResult.error };
  }

  const overrides = parseExerciseOverrides(sessionRow);
  const exercisesResult = await planExercisesForSession(
    sessionRow.program_day_id,
    sessionRow.finished_at,
    setsResult.data,
    overrides,
  );

  if (!exercisesResult.ok) {
    return { ok: false, error: exercisesResult.error };
  }

  const setRows = setsResult.data;
  const sets: WorkoutSetRecord[] = [];

  for (const item of exercisesResult.data) {
    const exerciseId = item.exercise?.id ? String(item.exercise.id) : null;
    const targetSets = toFiniteNumber(item.targetSets) ?? 0;

    if (!exerciseId) {
      continue;
    }

    for (let setNumber = 1; setNumber <= targetSets; setNumber += 1) {
      const row = pickSetRecord(setRows, exerciseId, setNumber);

      if (row) {
        sets.push(row);
      }
    }
  }

  return {
    ok: true,
    data: {
      sessionId: String(sessionRow.id),
      finishedAt: sessionRow.finished_at,
      programDay: {
        id: programDay.id,
        name: programDay.name,
        subtitle: programDay.subtitle,
      },
      exercises: exercisesResult.data,
      sets,
      previousPerformance: [],
      previousError: null,
    },
  };
  } catch (error) {
    console.error('[WorkoutStart CRASH]', error);
    return {
      ok: false,
      error: errorMessage(error, 'Could not load workout.'),
    };
  }
}

function logSaveWorkoutSet(message: string, details: Record<string, unknown>) {
  console.log('[saveWorkoutSet]', message, details);
}

export async function listExercisesForPicker(): Promise<Result<WorkoutExercise[]>> {
  const { data, error } = await supabase
    .from('exercises')
    .select(
      'id, name, category, exercise_type, equipment_type, warmup_enabled, min_weight, weight_increment',
    )
    .order('name', { ascending: true });

  if (error) {
    return { ok: false, error: formatSupabaseError(error) };
  }

  return {
    ok: true,
    data: ((data ?? []) as ExerciseRow[])
      .map((row) => toExercise(row))
      .filter((exercise): exercise is WorkoutExercise => exercise !== null),
  };
}

async function saveSessionExerciseOverrides(
  sessionId: string,
  overrides: ExerciseOverrides,
): Promise<Result<true>> {
  const { error } = await supabase
    .from('workout_sessions')
    .update({ exercise_overrides: overrides })
    .eq('id', sessionId)
    .select('id')
    .maybeSingle();

  if (!error) {
    return { ok: true, data: true };
  }

  if (!isMissingColumnError(error, 'exercise_overrides')) {
    return { ok: false, error: formatSupabaseError(error) };
  }

  const payload = JSON.stringify({ exercise_overrides: overrides });
  const { data: session, error: readError } = await supabase
    .from('workout_sessions')
    .select('id, notes')
    .eq('id', sessionId)
    .maybeSingle();

  if (readError) {
    return { ok: false, error: readError.message };
  }

  const notes = session?.notes == null ? '' : String(session.notes).trim();

  if (notes && !notes.includes('"exercise_overrides"')) {
    return { ok: true, data: true };
  }

  const { error: notesError } = await supabase
    .from('workout_sessions')
    .update({ notes: payload })
    .eq('id', sessionId);

  if (notesError) {
    return { ok: false, error: notesError.message };
  }

  return { ok: true, data: true };
}

async function replaceIncompleteSets(input: {
  sessionId: string;
  fromExerciseId: string;
  toExercise: WorkoutExercise;
  programItem: ProgramExercise;
  keepCompleted: boolean;
  previousSets: WorkoutSetRecord[];
}): Promise<Result<true>> {
  const setsResult = await fetchWorkoutSets(input.sessionId);

  if (!setsResult.ok) {
    return setsResult;
  }

  const fromSets = setsResult.data.filter(
    (row) => row.exerciseId === input.fromExerciseId,
  );
  const completed = fromSets.filter((row) => row.isCompleted);
  const incomplete = fromSets.filter((row) => !row.isCompleted);
  const existingReplacement = setsResult.data.filter(
    (row) => row.exerciseId === input.toExercise.id,
  );

  if (existingReplacement.length > 0 && completed.length === 0) {
    return {
      ok: false,
      error: 'That exercise is already in this workout.',
    };
  }

  if (completed.length > 0 && !input.keepCompleted) {
    return {
      ok: false,
      error: 'You already logged sets for this exercise.',
    };
  }

  if (incomplete.length > 0) {
    const { error: deleteError } = await supabase
      .from('workout_sets')
      .delete()
      .eq('workout_session_id', input.sessionId)
      .eq('exercise_id', input.fromExerciseId)
      .eq('is_completed', false);

    if (deleteError) {
      return { ok: false, error: deleteError.message };
    }
  }

  const remainingCount =
    completed.length > 0
      ? Math.max(input.programItem.targetSets - completed.length, incomplete.length, 0)
      : Math.max(input.programItem.targetSets, incomplete.length, 1);

  if (remainingCount < 1) {
    return { ok: true, data: true };
  }

  const recommendedWeight = recommendedStartWeight(
    {
      ...input.programItem,
      exercise: input.toExercise,
    },
    input.previousSets,
  );

  const rows = Array.from({ length: remainingCount }, (_, index) => ({
    workout_session_id: input.sessionId,
    exercise_id: input.toExercise.id,
    set_number: index + 1,
    weight: recommendedWeight,
    reps: null,
    rir: null,
    is_completed: false,
  }));

  const { error: insertError } = await supabase.from('workout_sets').insert(rows);

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  return { ok: true, data: true };
}

export async function swapWorkoutExercise(input: {
  sessionId: string;
  programExerciseId: string;
  fromExerciseId: string;
  toExerciseId: string;
  scope: ExerciseSwapScope;
  keepCompletedSets: boolean;
}): Promise<Result<ActiveWorkout>> {
  const fromExerciseId = String(input.fromExerciseId);
  const toExerciseId = String(input.toExerciseId);
  const programExerciseId = String(input.programExerciseId);

  if (!fromExerciseId || !toExerciseId || fromExerciseId === toExerciseId) {
    return { ok: false, error: 'Choose a different exercise to swap in.' };
  }

  const workoutResult = await loadActiveWorkout(input.sessionId);

  if (!workoutResult.ok) {
    return workoutResult;
  }

  const programItem = workoutResult.data.exercises.find(
    (item) =>
      String(item.programExerciseId) === programExerciseId &&
      String(item.exercise?.id) === fromExerciseId,
  );

  if (!programItem?.exercise) {
    return { ok: false, error: 'Could not find that exercise in this workout.' };
  }

  const replacementResult = await fetchWorkoutExercisesByIds([toExerciseId]);

  if (!replacementResult.ok) {
    return replacementResult;
  }

  const toExercise = replacementResult.data[0];

  if (!toExercise) {
    return { ok: false, error: 'Replacement exercise not found.' };
  }

  const previousResult = await fetchPreviousPerformanceForExercises(
    [{ exerciseId: toExercise.id, exerciseName: toExercise.name }],
    input.sessionId,
  );
  const previousSets = previousResult.ok
    ? previousSetsForExercise(previousResult.data, toExercise.id)
    : [];

  const setsResult = await replaceIncompleteSets({
    sessionId: input.sessionId,
    fromExerciseId,
    toExercise,
    programItem,
    keepCompleted: input.keepCompletedSets,
    previousSets,
  });

  if (!setsResult.ok) {
    return setsResult;
  }

  const sessionResult = await fetchWorkoutSession(input.sessionId);

  if (!sessionResult.ok) {
    return sessionResult;
  }

  const overrides = parseExerciseOverrides(sessionResult.data);
  overrides[programExerciseId] = toExerciseId;
  const overrideResult = await saveSessionExerciseOverrides(input.sessionId, overrides);

  if (!overrideResult.ok) {
    return overrideResult;
  }

  if (input.scope === 'program') {
    if (!/^\d+$/.test(programExerciseId)) {
      return {
        ok: false,
        error: 'This exercise is not a program template row, so it cannot be replaced in the program.',
      };
    }

    const { data, error } = await supabase
      .from('program_exercises')
      .update({ exercise_id: toExerciseId })
      .eq('id', programExerciseId)
      .select('id')
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        error: `Swapped for this workout, but the program was not updated. ${formatSupabaseError(error)}`,
      };
    }

    if (!data) {
      return {
        ok: false,
        error:
          'Swapped for this workout, but the program row was not found so it was not updated.',
      };
    }
  }

  return loadActiveWorkout(input.sessionId);
}

export async function saveWorkoutSet(
  sessionId: string,
  draft: WorkoutSetDraft,
): Promise<Result<{ id: string }>> {
  const values = {
    weight: draft.weight,
    reps: draft.reps,
    rir: draft.rir,
    is_completed: draft.isCompleted,
  };
  const logBase = {
    workout_session_id: sessionId,
    exercise_id: draft.exerciseId,
    set_number: draft.setNumber,
    setId: draft.setId ?? null,
    is_completed: draft.isCompleted,
  };

  logSaveWorkoutSet('start', logBase);

  const { data: existingRows, error: existingError } = await supabase
    .from('workout_sets')
    .select('id')
    .eq('workout_session_id', sessionId)
    .eq('exercise_id', draft.exerciseId)
    .eq('set_number', draft.setNumber)
    .limit(1);

  if (existingError) {
    logSaveWorkoutSet('lookup error', {
      ...logBase,
      error_code: existingError.code,
      error_message: existingError.message,
    });
    return { ok: false, error: existingError.message };
  }

  if ((existingRows?.length ?? 0) > 1) {
    logSaveWorkoutSet('duplicate rows found; updating first match', {
      ...logBase,
      duplicate_count: existingRows?.length,
    });
  }

  let existingId = existingRows?.[0]?.id ? String(existingRows[0].id) : null;

  if (!existingId && draft.setId) {
    const { data: existingById, error: existingByIdError } = await supabase
      .from('workout_sets')
      .select('id')
      .eq('id', draft.setId)
      .eq('workout_session_id', sessionId)
      .maybeSingle();

    if (existingByIdError) {
      logSaveWorkoutSet('lookup by id error', {
        ...logBase,
        error_code: existingByIdError.code,
        error_message: existingByIdError.message,
      });
      return { ok: false, error: existingByIdError.message };
    }

    existingId = existingById?.id ? String(existingById.id) : null;
  }

  logSaveWorkoutSet('existing row check', {
    ...logBase,
    existingRowFound: Boolean(existingId),
    existingId,
  });

  if (existingId) {
    logSaveWorkoutSet('performing UPDATE', { ...logBase, existingId });

    const { data, error } = await supabase
      .from('workout_sets')
      .update(values)
      .eq('id', existingId)
      .eq('workout_session_id', sessionId)
      .select('id')
      .maybeSingle();

    if (error) {
      logSaveWorkoutSet('UPDATE error', {
        ...logBase,
        action: 'UPDATE',
        existingId,
        error_code: error.code,
        error_message: error.message,
      });
      return { ok: false, error: error.message };
    }

    if (!data) {
      logSaveWorkoutSet('UPDATE matched zero rows', { ...logBase, existingId });
      return {
        ok: false,
        error: 'Could not update this set because no matching workout_set row was found.',
      };
    }

    logSaveWorkoutSet('UPDATE succeeded', { ...logBase, action: 'UPDATE', id: data.id });
    return { ok: true, data: { id: String(data.id) } };
  }

  logSaveWorkoutSet('performing INSERT', logBase);

  const { data, error } = await supabase
    .from('workout_sets')
    .insert({
      workout_session_id: sessionId,
      exercise_id: draft.exerciseId,
      set_number: draft.setNumber,
      ...values,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    logSaveWorkoutSet('INSERT error', {
      ...logBase,
      action: 'INSERT',
      error_code: error.code,
      error_message: error.message,
    });

    if (error.code === '23505') {
      const { data: conflictRows, error: conflictError } = await supabase
        .from('workout_sets')
        .select('id')
        .eq('workout_session_id', sessionId)
        .eq('exercise_id', draft.exerciseId)
        .eq('set_number', draft.setNumber)
        .limit(1);

      if (conflictError) {
        logSaveWorkoutSet('INSERT conflict lookup error', {
          ...logBase,
          action: 'UPDATE',
          error_code: conflictError.code,
          error_message: conflictError.message,
        });
        return { ok: false, error: conflictError.message };
      }

      const conflictId = conflictRows?.[0]?.id ? String(conflictRows[0].id) : null;

      if (!conflictId) {
        return { ok: false, error: error.message };
      }

      logSaveWorkoutSet('INSERT unique conflict; performing UPDATE', {
        ...logBase,
        action: 'UPDATE',
        existingId: conflictId,
      });

      const { data: updated, error: updateError } = await supabase
        .from('workout_sets')
        .update(values)
        .eq('id', conflictId)
        .eq('workout_session_id', sessionId)
        .select('id')
        .maybeSingle();

      if (updateError) {
        logSaveWorkoutSet('UPDATE error', {
          ...logBase,
          action: 'UPDATE',
          existingId: conflictId,
          error_code: updateError.code,
          error_message: updateError.message,
        });
        return { ok: false, error: updateError.message };
      }

      if (!updated) {
        return {
          ok: false,
          error: 'Could not update this set because no matching workout_set row was found.',
        };
      }

      logSaveWorkoutSet('UPDATE succeeded', {
        ...logBase,
        action: 'UPDATE',
        id: updated.id,
      });
      return { ok: true, data: { id: String(updated.id) } };
    }

    return { ok: false, error: error.message };
  }

  if (!data) {
    logSaveWorkoutSet('INSERT returned no row', logBase);
    return {
      ok: false,
      error: 'Could not save this set because insert did not return a workout_set row.',
    };
  }

  logSaveWorkoutSet('INSERT succeeded', { ...logBase, action: 'INSERT', id: data.id });
  return { ok: true, data: { id: String(data.id) } };
}

export async function finishWorkoutSession(sessionId: string): Promise<Result<true>> {
  const finishedAt = new Date().toISOString();

  console.log('[finishWorkout] start', {
    session_id: sessionId,
    finished_at: finishedAt,
  });

  const { data, error } = await supabase
    .from('workout_sessions')
    .update({ finished_at: finishedAt })
    .eq('id', sessionId)
    .is('finished_at', null)
    .select('id, finished_at')
    .maybeSingle();

  if (error) {
    console.log('[finishWorkout] error', {
      session_id: sessionId,
      error_code: error.code,
      error_message: error.message,
    });
    return { ok: false, error: error.message };
  }

  if (!data) {
    console.log('[finishWorkout] no matching unfinished session', {
      session_id: sessionId,
    });
    return {
      ok: false,
      error: 'Workout was already finished or not found.',
    };
  }

  console.log('[finishWorkout] succeeded', {
    session_id: data.id,
    finished_at: data.finished_at,
  });

  return { ok: true, data: true };
}

export type PersonalRecord = {
  exerciseName: string;
  heaviestWeight: number;
  bestReps: number;
};

export async function listPersonalRecords(): Promise<Result<PersonalRecord[]>> {
  const { data, error } = await supabase
    .from('workout_sets')
    .select(
      `
      weight,
      reps,
      exercise:exercises (
        name
      )
    `,
    )
    .eq('is_completed', true);

  if (error) {
    return { ok: false, error: error.message };
  }

  const byName = new Map<string, PersonalRecord>();

  for (const row of data ?? []) {
    const exercise = unwrapRelation(
      (row as { exercise?: { name: string } | { name: string }[] | null }).exercise,
    );
    const name = exercise?.name ?? 'Exercise';
    const weight = Number((row as { weight: number | null }).weight);
    const reps = Number((row as { reps: number | null }).reps);

    if (!Number.isFinite(weight) || weight <= 0) {
      continue;
    }

    const record: PersonalRecord = {
      exerciseName: name,
      heaviestWeight: weight,
      bestReps: Number.isFinite(reps) ? reps : 0,
    };
    const existing = byName.get(name);

    if (
      !existing ||
      record.heaviestWeight > existing.heaviestWeight ||
      (record.heaviestWeight === existing.heaviestWeight && record.bestReps > existing.bestReps)
    ) {
      byName.set(name, record);
    }
  }

  return {
    ok: true,
    data: [...byName.values()].sort((a, b) => b.heaviestWeight - a.heaviestWeight),
  };
}

export function formatSetInput(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);

  if (Number.isFinite(numeric)) {
    return String(numeric);
  }

  return String(value);
}

export function parseOptionalWeight(value: string): { ready: boolean; value: number | null } {
  const trimmed = value.trim();

  if (!trimmed) {
    return { ready: true, value: null };
  }

  if (trimmed === '.' || trimmed === '-' || trimmed.endsWith('.') || /[eE]$/.test(trimmed)) {
    return { ready: false, value: null };
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ready: false, value: null };
  }

  return { ready: true, value: parsed };
}

export function parseOptionalReps(value: string): { ready: boolean; value: number | null } {
  const trimmed = value.trim();

  if (!trimmed) {
    return { ready: true, value: null };
  }

  const parsed = Number(trimmed);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return { ready: false, value: null };
  }

  return { ready: true, value: parsed };
}

export function parseOptionalRir(value: string): { ready: boolean; value: number | null } {
  return parseOptionalReps(value);
}

export function setKey(exerciseId: string, setNumber: number) {
  return `${exerciseId}:${setNumber}`;
}
