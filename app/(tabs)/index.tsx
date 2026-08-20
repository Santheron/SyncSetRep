import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

const palette = Colors.dark;

const placeholderExercises = [
  { name: 'Bench Press', detail: '4 sets · 6–8 reps' },
  { name: 'Incline Dumbbell Press', detail: '3 sets · 8–10 reps' },
  { name: 'Chest-Supported Row', detail: '4 sets · 8–10 reps' },
  { name: 'Lat Pulldown', detail: '3 sets · 10–12 reps' },
  { name: 'Overhead Press', detail: '3 sets · 8–10 reps' },
];

export default function WorkoutScreen() {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  async function startWorkout() {
    if (isStarting) {
      return;
    }

    setIsStarting(true);
    setStartError(null);

    try {
      const { data: programDay, error: dayError } = await supabase
        .from('program_days')
        .select('id')
        .order('day_order', { ascending: true })
        .limit(1)
        .single();

      if (dayError || !programDay) {
        setStartError(dayError?.message ?? 'No program day found.');
        return;
      }

      const { data: session, error: sessionError } = await supabase
        .from('workout_sessions')
        .insert({
          program_day_id: programDay.id,
          started_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (sessionError || !session) {
        setStartError(sessionError?.message ?? 'Could not start workout.');
        return;
      }

      router.push({
        pathname: '/workout/[sessionId]',
        params: { sessionId: String(session.id) },
      });
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <Screen>
      <View>
        <Text style={styles.kicker}>Upper</Text>
        <Text style={styles.title}>Today&apos;s Workout</Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start Workout"
        disabled={isStarting}
        onPress={() => {
          void startWorkout();
        }}
        style={({ pressed }) => [
          styles.startButton,
          (pressed || isStarting) && styles.startButtonPressed,
        ]}>
        <Text style={styles.startButtonLabel}>
          {isStarting ? 'Starting...' : 'Start Workout'}
        </Text>
      </Pressable>

      {startError ? (
        <Text style={styles.error}>Could not start workout. {startError}</Text>
      ) : null}

      <Text style={styles.sectionLabel}>Exercises</Text>

      {placeholderExercises.map((exercise) => (
        <Card key={exercise.name} style={styles.exerciseCard}>
          <Text style={styles.exerciseName}>{exercise.name}</Text>
          <Text style={styles.exerciseDetail}>{exercise.detail}</Text>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  title: {
    color: palette.text,
    fontSize: 32,
    fontWeight: '800',
  },
  startButton: {
    backgroundColor: palette.accent,
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
  },
  startButtonPressed: {
    opacity: 0.85,
  },
  startButtonLabel: {
    color: palette.accentText,
    fontSize: 20,
    fontWeight: '800',
  },
  error: {
    color: palette.text,
    fontSize: 16,
  },
  sectionLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 8,
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
  exerciseDetail: {
    color: palette.muted,
    fontSize: 16,
  },
});
