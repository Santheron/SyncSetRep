import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import {
  formatWorkoutDate,
  formatWorkoutDuration,
  unwrapRelation,
} from '@/lib/workout-format';

const palette = Colors.dark;

type ProgramDayRef = {
  name: string;
};

type WorkoutSetRef = {
  id: string;
  exercise_id: string;
  is_completed: boolean | null;
};

type SessionRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  program_day: ProgramDayRef | ProgramDayRef[] | null;
  workout_sets: WorkoutSetRef[] | null;
};

type HistoryWorkout = {
  id: string;
  date: string;
  name: string;
  exerciseCount: number;
  setCount: number;
  duration: string | null;
};

function toHistoryWorkout(row: SessionRow): HistoryWorkout {
  const programDay = unwrapRelation(row.program_day);
  const completedSets = (row.workout_sets ?? []).filter((set) => set.is_completed);
  const exerciseIds = new Set(completedSets.map((set) => set.exercise_id));

  return {
    id: row.id,
    date: formatWorkoutDate(row.started_at),
    name: programDay?.name ?? 'Workout',
    exerciseCount: exerciseIds.size,
    setCount: completedSets.length,
    duration: formatWorkoutDuration(row.started_at, row.finished_at),
  };
}

export default function HistoryScreen() {
  const [workouts, setWorkouts] = useState<HistoryWorkout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function loadHistory() {
        const { data, error } = await supabase
          .from('workout_sessions')
          .select(
            `
            id,
            started_at,
            finished_at,
            program_day:program_days (
              name
            ),
            workout_sets (
              id,
              exercise_id,
              is_completed
            )
          `,
          )
          .not('finished_at', 'is', null)
          .order('started_at', { ascending: false });

        if (!isMounted) {
          return;
        }

        if (error) {
          setErrorMessage(error.message);
          setWorkouts([]);
        } else {
          setErrorMessage(null);
          setWorkouts(((data ?? []) as SessionRow[]).map(toHistoryWorkout));
        }

        setIsLoading(false);
      }

      void loadHistory();

      return () => {
        isMounted = false;
      };
    }, []),
  );

  return (
    <Screen>
      <Text style={styles.title}>History</Text>
      <Text style={styles.subtitle}>
        {isLoading
          ? 'Loading history...'
          : errorMessage
            ? 'Could not load history'
            : workouts.length === 0
              ? 'Previous workouts will appear here.'
              : `${workouts.length} completed workouts`}
      </Text>

      {isLoading ? (
        <Text style={styles.status}>Loading completed workouts...</Text>
      ) : errorMessage ? (
        <Text style={styles.error}>Could not load history. {errorMessage}</Text>
      ) : (
        workouts.map((workout) => {
          const summaryParts = [
            `${workout.exerciseCount} ${workout.exerciseCount === 1 ? 'exercise' : 'exercises'}`,
            `${workout.setCount} ${workout.setCount === 1 ? 'set' : 'sets'}`,
          ];

          if (workout.duration) {
            summaryParts.push(workout.duration);
          }

          return (
            <Link
              key={workout.id}
              href={{
                pathname: '/history/[sessionId]',
                params: { sessionId: workout.id },
              }}
              asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${workout.name}. ${workout.date}. ${summaryParts.join(' · ')}`}
                style={({ pressed }) => pressed && styles.pressed}>
                <Card style={styles.row}>
                  <Text style={styles.date}>{workout.date}</Text>
                  <Text style={styles.name}>{workout.name}</Text>
                  <Text style={styles.summary}>{summaryParts.join(' · ')}</Text>
                </Card>
              </Pressable>
            </Link>
          );
        })
      )}
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
  pressed: {
    opacity: 0.85,
  },
  row: {
    minHeight: 88,
    justifyContent: 'center',
    gap: 4,
  },
  date: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  name: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  summary: {
    color: palette.muted,
    fontSize: 16,
  },
});
