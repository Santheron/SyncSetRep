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
  exerciseOrder: number;
  targetSets: number;
  minReps: number;
  maxReps: number;
  notes: string | null;
  exercise: WorkoutExercise | null;
};

export type WorkoutSetRecord = {
  id: string;
  exerciseId: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  rir: number | null;
  isCompleted: boolean;
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
    id: exercise.id,
    name: exercise.name,
    category: exercise.category,
    exerciseType: exercise.exercise_type,
    equipmentType: exercise.equipment_type,
    warmupEnabled: exercise.warmup_enabled,
    minWeight: exercise.min_weight,
    weightIncrement: exercise.weight_increment,
  };
}

function toProgramExercise(row: ProgramExerciseRow): ProgramExercise {
  return {
    id: row.id,
    exerciseOrder: row.exercise_order,
    targetSets: row.target_sets,
    minReps: row.min_reps,
    maxReps: row.max_reps,
    notes: row.notes,
    exercise: toExercise(row.exercise),
  };
}

function toSetRecord(row: WorkoutSetRow): WorkoutSetRecord {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    setNumber: row.set_number,
    weight: row.weight,
    reps: row.reps,
    rir: row.rir,
    isCompleted: Boolean(row.is_completed),
  };
}

function pickSetRow(
  rows: WorkoutSetRow[],
  exerciseId: string,
  setNumber: number,
): WorkoutSetRow | undefined {
  const matches = rows.filter(
    (row) => row.exercise_id === exerciseId && row.set_number === setNumber,
  );

  return matches.find((row) => row.is_completed) ?? matches[0];
}

async function fetchProgramExercises(programDayId: string): Promise<Result<ProgramExercise[]>> {
  const { data, error } = await supabase
    .from('program_exercises')
    .select(PROGRAM_EXERCISE_SELECT)
    .eq('program_day_id', programDayId)
    .order('exercise_order', { ascending: true });

  if (error) {
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    data: ((data ?? []) as ProgramExerciseRow[]).map(toProgramExercise),
  };
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
    .in('id', sessionIds);

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
    return { ok: false, error: error.message };
  }

  const days = ((data ?? []) as ProgramDayRow[]).map((row) => ({
    id: row.id,
    dayOrder: row.day_order,
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
      id: row.id,
      programDayId: row.program_day_id,
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
  const exercisesResult = await fetchProgramExercises(programDayId);

  if (!exercisesResult.ok) {
    return exercisesResult;
  }

  const { data: session, error: sessionError } = await supabase
    .from('workout_sessions')
    .insert({
      program_day_id: programDayId,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (sessionError || !session) {
    return { ok: false, error: sessionError?.message ?? 'Could not start workout.' };
  }

  const setRows = exercisesResult.data.flatMap((item) => {
    const exerciseId = item.exercise?.id;

    if (!exerciseId || item.targetSets < 1) {
      return [];
    }

    return Array.from({ length: item.targetSets }, (_, index) => ({
      workout_session_id: session.id,
      exercise_id: exerciseId,
      set_number: index + 1,
      weight: null,
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
}

export async function loadActiveWorkout(sessionId: string): Promise<Result<ActiveWorkout>> {
  const { data: session, error: sessionError } = await supabase
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
    .eq('id', sessionId)
    .single();

  if (sessionError || !session) {
    return { ok: false, error: sessionError?.message ?? 'Workout session not found.' };
  }

  const sessionRow = session as SessionRow;
  const programDay = unwrapRelation(sessionRow.program_day);

  if (!programDay) {
    return { ok: false, error: 'Program day not found for this workout.' };
  }

  const [exercisesResult, setsResult] = await Promise.all([
    fetchProgramExercises(sessionRow.program_day_id),
    supabase
      .from('workout_sets')
      .select('id, exercise_id, set_number, weight, reps, rir, is_completed')
      .eq('workout_session_id', sessionId)
      .order('set_number', { ascending: true }),
  ]);

  if (!exercisesResult.ok) {
    return exercisesResult;
  }

  if (setsResult.error) {
    return { ok: false, error: setsResult.error.message };
  }

  const setRows = (setsResult.data ?? []) as WorkoutSetRow[];
  const sets: WorkoutSetRecord[] = [];

  for (const item of exercisesResult.data) {
    const exerciseId = item.exercise?.id;

    if (!exerciseId) {
      continue;
    }

    for (let setNumber = 1; setNumber <= item.targetSets; setNumber += 1) {
      const row = pickSetRow(setRows, exerciseId, setNumber);

      if (row) {
        sets.push(toSetRecord(row));
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
    },
  };
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

  if (draft.setId) {
    const { data, error } = await supabase
      .from('workout_sets')
      .update(values)
      .eq('id', draft.setId)
      .select('id')
      .single();

    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Could not save set.' };
    }

    return { ok: true, data: { id: String(data.id) } };
  }

  const { data: existingRows, error: existingError } = await supabase
    .from('workout_sets')
    .select('id')
    .eq('workout_session_id', sessionId)
    .eq('exercise_id', draft.exerciseId)
    .eq('set_number', draft.setNumber)
    .limit(1);

  if (existingError) {
    return { ok: false, error: existingError.message };
  }

  const existingId = existingRows?.[0]?.id;

  if (existingId) {
    const { data, error } = await supabase
      .from('workout_sets')
      .update(values)
      .eq('id', existingId)
      .select('id')
      .single();

    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Could not save set.' };
    }

    return { ok: true, data: { id: String(data.id) } };
  }

  const { data, error } = await supabase
    .from('workout_sets')
    .insert({
      workout_session_id: sessionId,
      exercise_id: draft.exerciseId,
      set_number: draft.setNumber,
      ...values,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Could not save set.' };
  }

  return { ok: true, data: { id: String(data.id) } };
}

export async function finishWorkoutSession(sessionId: string): Promise<Result<true>> {
  const { error } = await supabase
    .from('workout_sessions')
    .update({ finished_at: new Date().toISOString() })
    .eq('id', sessionId)
    .is('finished_at', null);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, data: true };
}

export function formatSetInput(value: number | null): string {
  if (value === null) {
    return '';
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
