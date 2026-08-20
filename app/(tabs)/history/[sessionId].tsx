import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import {
  formatSetLoad,
  formatWorkoutDate,
  formatWorkoutDuration,
  unwrapRelation,
} from '@/lib/workout-format';

const palette = Colors.dark;

type ProgramDayRef = {
  name: string;
};

type ExerciseRef = {
  id: string;
  name: string;
  equipment_type: string | null;
};

type WorkoutSetRow = {
  id: string;
  exercise_id: string;
  set_number: number;
  weight: number | null;
  reps: number | null;
  exercise: ExerciseRef | ExerciseRef[] | null;
};

type ProgramExerciseOrder = {
  exercise_id: string;
  exercise_order: number;
};

type HistorySet = {
  id: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
};

type ExerciseGroup = {
  exerciseId: string;
  name: string;
  sets: HistorySet[];
};

type HistoryDetail = {
  name: string;
  date: string;
  duration: string | null;
  totalSets: number;
  exercises: ExerciseGroup[];
};

function groupSets(
  rows: WorkoutSetRow[],
  exerciseOrder: Map<string, number>,
): ExerciseGroup[] {
  const groups = new Map<string, ExerciseGroup>();

  for (const row of rows) {
    const exercise = unwrapRelation(row.exercise);
    const existing = groups.get(row.exercise_id);

    const nextSet: HistorySet = {
      id: row.id,
      setNumber: row.set_number,
      weight: row.weight,
      reps: row.reps,
    };

    if (existing) {
      existing.sets.push(nextSet);
    } else {
      groups.set(row.exercise_id, {
        exerciseId: row.exercise_id,
        name: exercise?.name ?? 'Unknown exercise',
        sets: [nextSet],
      });
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      sets: [...group.sets].sort((a, b) => a.setNumber - b.setNumber),
    }))
    .sort((a, b) => {
      const orderA = exerciseOrder.get(a.exerciseId);
      const orderB = exerciseOrder.get(b.exerciseId);

      if (orderA !== undefined && orderB !== undefined) {
        return orderA - orderB;
      }

      if (orderA !== undefined) {
        return -1;
      }

      if (orderB !== undefined) {
        return 1;
      }

      return a.name.localeCompare(b.name);
    });
}

export default function HistoryDetailScreen() {
  const { sessionId: sessionIdParam } = useLocalSearchParams<{
    sessionId: string | string[];
  }>();
  const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;

  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setIsLoading(false);
      setErrorMessage('Missing workout session.');
      return;
    }

    let isMounted = true;

    async function loadDetail() {
      const { data: session, error: sessionError } = await supabase
        .from('workout_sessions')
        .select(
          `
          id,
          started_at,
          finished_at,
          program_day_id,
          program_day:program_days (
            name
          )
        `,
        )
        .eq('id', sessionId)
        .single();

      if (!isMounted) {
        return;
      }

      if (sessionError || !session) {
        setErrorMessage(sessionError?.message ?? 'Workout not found.');
        setIsLoading(false);
        return;
      }

      const [setsResult, orderResult] = await Promise.all([
        supabase
          .from('workout_sets')
          .select(
            `
            id,
            exercise_id,
            set_number,
            weight,
            reps,
            exercise:exercises (
              id,
              name,
              equipment_type
            )
          `,
          )
          .eq('workout_session_id', sessionId)
          .order('set_number', { ascending: true }),
        supabase
          .from('program_exercises')
          .select('exercise_id, exercise_order')
          .eq('program_day_id', session.program_day_id)
          .order('exercise_order', { ascending: true }),
      ]);

      if (!isMounted) {
        return;
      }

      if (setsResult.error) {
        setErrorMessage(setsResult.error.message);
        setIsLoading(false);
        return;
      }

      const programDay = unwrapRelation(session.program_day as ProgramDayRef | ProgramDayRef[] | null);
      const orderRows = (orderResult.data ?? []) as ProgramExerciseOrder[];
      const exerciseOrder = new Map(
        orderRows.map((row) => [row.exercise_id, row.exercise_order]),
      );
      const exercises = groupSets((setsResult.data ?? []) as WorkoutSetRow[], exerciseOrder);
      const totalSets = exercises.reduce((count, group) => count + group.sets.length, 0);

      setErrorMessage(null);
      setDetail({
        name: programDay?.name ?? 'Workout',
        date: formatWorkoutDate(session.started_at),
        duration: formatWorkoutDuration(session.started_at, session.finished_at),
        totalSets,
        exercises,
      });
      setIsLoading(false);
    }

    void loadDetail();

    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: detail?.name ?? 'Workout',
          headerBackTitle: 'History',
        }}
      />

      <Text style={styles.title}>{detail?.name ?? 'Workout'}</Text>
      <Text style={styles.subtitle}>
        {isLoading
          ? 'Loading workout...'
          : errorMessage
            ? 'Could not load workout'
            : detail?.date}
      </Text>

      {isLoading ? (
        <Text style={styles.status}>Loading workout details...</Text>
      ) : errorMessage ? (
        <Text style={styles.error}>Could not load this workout. {errorMessage}</Text>
      ) : detail ? (
        <>
          <Card style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Summary</Text>
            <Text style={styles.summaryLine}>{detail.date}</Text>
            {detail.duration ? (
              <Text style={styles.summaryLine}>{detail.duration}</Text>
            ) : null}
            <Text style={styles.summaryLine}>
              {detail.totalSets} {detail.totalSets === 1 ? 'set' : 'sets'}
            </Text>
          </Card>

          {detail.exercises.map((exercise) => (
            <Card key={exercise.exerciseId} style={styles.exerciseCard}>
              <Text style={styles.exerciseName}>{exercise.name}</Text>
              {exercise.sets.map((set) => (
                <Text key={set.id} style={styles.setLine}>
                  Set {set.setNumber} — {formatSetLoad(set.weight)} × {set.reps ?? 0}
                </Text>
              ))}
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: palette.text,
    fontSize: 32,
    fontWeight: '800',
  },
  subtitle: {
    color: palette.muted,
    fontSize: 16,
    marginBottom: 4,
  },
  status: {
    color: palette.muted,
    fontSize: 16,
  },
  error: {
    color: palette.text,
    fontSize: 16,
  },
  summaryCard: {
    gap: 4,
  },
  summaryLabel: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  summaryLine: {
    color: palette.muted,
    fontSize: 16,
  },
  exerciseCard: {
    gap: 6,
  },
  exerciseName: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  setLine: {
    color: palette.muted,
    fontSize: 16,
  },
});
