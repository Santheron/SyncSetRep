import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

const palette = Colors.dark;

type ProgramDay = {
  id: string;
  name: string;
  subtitle: string;
};

type Exercise = {
  id: string;
  name: string;
  category: string;
  exercise_type: string;
};

type ProgramExerciseRow = {
  id: string;
  exercise_order: number;
  target_sets: number;
  min_reps: number;
  max_reps: number;
  notes: string | null;
  exercise: Exercise | Exercise[] | null;
};

type ProgramExercise = {
  id: string;
  exercise_order: number;
  target_sets: number;
  min_reps: number;
  max_reps: number;
  notes: string | null;
  exercise: Exercise | null;
};

function unwrapExercise(value: Exercise | Exercise[] | null): Exercise | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default function ProgramDayScreen() {
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const programDayId = Array.isArray(id) ? id[0] : id;

  const [programDay, setProgramDay] = useState<ProgramDay | null>(null);
  const [exercises, setExercises] = useState<ProgramExercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!programDayId) {
      setIsLoading(false);
      setErrorMessage('Missing program day.');
      return;
    }

    let isMounted = true;

    async function loadProgramDay() {
      const [dayResult, exercisesResult] = await Promise.all([
        supabase
          .from('program_days')
          .select('id, name, subtitle')
          .eq('id', programDayId)
          .single(),
        supabase
          .from('program_exercises')
          .select(
            `
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
              exercise_type
            )
          `,
          )
          .eq('program_day_id', programDayId)
          .order('exercise_order', { ascending: true }),
      ]);

      if (!isMounted) {
        return;
      }

      if (dayResult.error) {
        console.error('[ProgramDays] query error', {
          code: dayResult.error.code,
          message: dayResult.error.message,
          details: dayResult.error.details,
          hint: dayResult.error.hint,
        });
        setErrorMessage(
          [dayResult.error.code, dayResult.error.message, dayResult.error.details, dayResult.error.hint]
            .filter(Boolean)
            .join(' | '),
        );
        setProgramDay(null);
        setExercises([]);
        setIsLoading(false);
        return;
      }

      if (exercisesResult.error) {
        console.error('[ProgramExercises] query error', {
          code: exercisesResult.error.code,
          message: exercisesResult.error.message,
          details: exercisesResult.error.details,
          hint: exercisesResult.error.hint,
        });
        setErrorMessage(
          [
            exercisesResult.error.code,
            exercisesResult.error.message,
            exercisesResult.error.details,
            exercisesResult.error.hint,
          ]
            .filter(Boolean)
            .join(' | '),
        );
        setProgramDay(dayResult.data);
        setExercises([]);
        setIsLoading(false);
        return;
      }

      const rows = (exercisesResult.data ?? []) as ProgramExerciseRow[];

      setErrorMessage(null);
      setProgramDay(dayResult.data);
      setExercises(
        rows.map((row) => ({
          ...row,
          exercise: unwrapExercise(row.exercise),
        })),
      );
      setIsLoading(false);
    }

    void loadProgramDay();

    return () => {
      isMounted = false;
    };
  }, [programDayId]);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: programDay?.name ?? 'Workout Day',
          headerBackTitle: 'Program',
        }}
      />

      <Text style={styles.title}>{programDay?.name ?? 'Workout Day'}</Text>
      <Text style={styles.subtitle}>
        {isLoading
          ? 'Loading workout day...'
          : errorMessage
            ? 'Could not load workout day'
            : programDay?.subtitle}
      </Text>

      {isLoading ? (
        <Text style={styles.status}>Loading exercises...</Text>
      ) : errorMessage ? (
        <Text style={styles.error}>
          Could not load this workout day. {errorMessage}
        </Text>
      ) : (
        exercises.map((item) => {
          const notes = item.notes?.trim();

          return (
            <Card key={item.id} style={styles.exerciseCard}>
              <Text style={styles.exerciseName}>
                {item.exercise?.name ?? 'Unknown exercise'}
              </Text>
              {item.exercise?.category ? (
                <Text style={styles.exerciseCategory}>{item.exercise.category}</Text>
              ) : null}
              <Text style={styles.exerciseDetail}>
                {item.target_sets} sets · {item.min_reps}–{item.max_reps} reps
              </Text>
              {notes ? <Text style={styles.exerciseNotes}>{notes}</Text> : null}
            </Card>
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
  exerciseCard: {
    minHeight: 72,
    justifyContent: 'center',
    gap: 4,
  },
  exerciseName: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  exerciseCategory: {
    color: palette.muted,
    fontSize: 16,
  },
  exerciseDetail: {
    color: palette.muted,
    fontSize: 16,
  },
  exerciseNotes: {
    color: palette.muted,
    fontSize: 16,
  },
});
