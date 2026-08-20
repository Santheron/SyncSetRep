import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { RestTimerCard } from '@/components/rest-timer';
import { WarmupModal } from '@/components/warmup-modal';
import { Colors } from '@/constants/theme';
import { useRestTimer } from '@/hooks/use-rest-timer';
import { supabase } from '@/lib/supabase';
import { parsePositiveWeight } from '@/lib/warmup';

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

type SetInputs = {
  weight: string;
  reps: string;
};

function unwrapExercise(value: Exercise | Exercise[] | null): Exercise | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function setKey(exerciseId: string, setNumber: number) {
  return `${exerciseId}:${setNumber}`;
}

function parseWeight(value: string): number | null {
  const parsed = Number(value.trim());

  if (!value.trim() || !Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function parseReps(value: string): number | null {
  const parsed = Number(value.trim());

  if (!value.trim() || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const { sessionId: sessionIdParam } = useLocalSearchParams<{
    sessionId: string | string[];
  }>();
  const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;

  const [programDay, setProgramDay] = useState<ProgramDay | null>(null);
  const [exercises, setExercises] = useState<ProgramExercise[]>([]);
  const [inputs, setInputs] = useState<Record<string, SetInputs>>({});
  const [completedSets, setCompletedSets] = useState<Record<string, boolean>>({});
  const [setErrors, setSetErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isFinishing, setIsFinishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [warmupExerciseId, setWarmupExerciseId] = useState<string | null>(null);

  const pendingSetsRef = useRef(new Set<string>());
  const completedSetsRef = useRef(new Set<string>());
  const restTimer = useRestTimer();
  const startRestTimer = restTimer.start;

  useEffect(() => {
    if (!sessionId) {
      setIsLoading(false);
      setErrorMessage('Missing workout session.');
      return;
    }

    let isMounted = true;

    async function loadWorkout() {
      const { data: session, error: sessionError } = await supabase
        .from('workout_sessions')
        .select('id, program_day_id')
        .eq('id', sessionId)
        .single();

      if (!isMounted) {
        return;
      }

      if (sessionError || !session) {
        setErrorMessage(sessionError?.message ?? 'Workout session not found.');
        setIsLoading(false);
        return;
      }

      const [dayResult, exercisesResult] = await Promise.all([
        supabase
          .from('program_days')
          .select('id, name, subtitle')
          .eq('id', session.program_day_id)
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
              exercise_type,
              equipment_type,
              warmup_enabled,
              min_weight,
              weight_increment
            )
          `,
          )
          .eq('program_day_id', session.program_day_id)
          .order('exercise_order', { ascending: true }),
      ]);

      if (!isMounted) {
        return;
      }

      if (dayResult.error) {
        setErrorMessage(dayResult.error.message);
        setIsLoading(false);
        return;
      }

      if (exercisesResult.error) {
        setErrorMessage(exercisesResult.error.message);
        setProgramDay(dayResult.data);
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

    void loadWorkout();

    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  function updateInput(key: string, field: keyof SetInputs, value: string) {
    setInputs((current) => ({
      ...current,
      [key]: {
        weight: current[key]?.weight ?? '',
        reps: current[key]?.reps ?? '',
        [field]: value,
      },
    }));
  }

  function getEnteredWorkingWeight(exerciseId: string, setCount: number): number | null {
    for (let setNumber = 1; setNumber <= setCount; setNumber += 1) {
      const weight = parsePositiveWeight(
        inputs[setKey(exerciseId, setNumber)]?.weight ?? '',
      );

      if (weight !== null) {
        return weight;
      }
    }

    return null;
  }

  async function completeSet(exerciseId: string, setNumber: number) {
    if (!sessionId) {
      return;
    }

    const key = setKey(exerciseId, setNumber);

    if (completedSetsRef.current.has(key) || pendingSetsRef.current.has(key)) {
      return;
    }

    const weight = parseWeight(inputs[key]?.weight ?? '');
    const reps = parseReps(inputs[key]?.reps ?? '');

    if (weight === null || reps === null) {
      setSetErrors((current) => ({
        ...current,
        [key]: 'Enter weight and reps before completing this set.',
      }));
      return;
    }

    pendingSetsRef.current.add(key);
    setSetErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });

    const { error } = await supabase.from('workout_sets').insert({
      workout_session_id: sessionId,
      exercise_id: exerciseId,
      set_number: setNumber,
      weight,
      reps,
      rir: null,
      is_completed: true,
    });

    if (error) {
      pendingSetsRef.current.delete(key);
      setSetErrors((current) => ({
        ...current,
        [key]: error.message,
      }));
      return;
    }

    completedSetsRef.current.add(key);
    pendingSetsRef.current.delete(key);
    setCompletedSets((current) => ({
      ...current,
      [key]: true,
    }));
    startRestTimer();
  }

  async function finishWorkout() {
    if (!sessionId || isFinishing) {
      return;
    }

    setIsFinishing(true);
    setFinishError(null);

    const { error } = await supabase
      .from('workout_sessions')
      .update({ finished_at: new Date().toISOString() })
      .eq('id', sessionId);

    if (error) {
      setFinishError(error.message);
      setIsFinishing(false);
      return;
    }

    router.dismissTo('/');
  }

  const warmupItem = exercises.find(
    (item) => (item.exercise?.id ?? item.id) === warmupExerciseId,
  );
  const warmupExercise = warmupItem?.exercise ?? null;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          title: programDay?.name ?? 'Workout',
          headerBackTitle: 'Workout',
        }}
      />

      {isLoading || errorMessage ? null : (
        <RestTimerCard
          formatted={restTimer.formatted}
          status={restTimer.status}
          onAddThirty={restTimer.addThirty}
          onPause={restTimer.pause}
          onReset={restTimer.reset}
          onResume={restTimer.resume}
          onSkip={restTimer.skip}
        />
      )}

      <Screen keyboardShouldPersistTaps="handled">
        <View>
          <Text style={styles.kicker}>{programDay?.name ?? 'Workout'}</Text>
          <Text style={styles.title}>Active Workout</Text>
        </View>
        <Text style={styles.subtitle}>
          {isLoading
            ? 'Loading workout...'
            : errorMessage
              ? 'Could not load workout'
              : programDay?.subtitle}
        </Text>

        {isLoading ? (
          <Text style={styles.status}>Loading exercises...</Text>
        ) : errorMessage ? (
          <Text style={styles.error}>Could not load this workout. {errorMessage}</Text>
        ) : (
          exercises.map((item) => {
            const exerciseId = item.exercise?.id;
            const notes = item.notes?.trim();
            const setCount = item.target_sets;

            return (
              <Card key={item.id} style={styles.exerciseCard}>
                <View style={styles.exerciseHeader}>
                  <Text style={styles.exerciseName}>
                    {item.exercise?.name ?? 'Unknown exercise'}
                  </Text>
                  {item.exercise?.warmup_enabled ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Warm up ${item.exercise.name}`}
                      onPress={() => setWarmupExerciseId(item.exercise?.id ?? item.id)}
                      style={({ pressed }) => [
                        styles.warmupButton,
                        pressed && styles.pressed,
                      ]}>
                      <Text style={styles.warmupButtonLabel}>Warm Up</Text>
                    </Pressable>
                  ) : null}
                </View>
                {item.exercise?.category ? (
                  <Text style={styles.exerciseMeta}>{item.exercise.category}</Text>
                ) : null}
                <Text style={styles.exerciseMeta}>
                  {setCount} sets · {item.min_reps}–{item.max_reps} reps
                </Text>
                {notes ? <Text style={styles.exerciseMeta}>{notes}</Text> : null}

                {exerciseId
                  ? Array.from({ length: setCount }, (_, index) => {
                      const setNumber = index + 1;
                      const key = setKey(exerciseId, setNumber);
                      const isCompleted = Boolean(completedSets[key]);
                      const values = inputs[key] ?? { weight: '', reps: '' };

                      return (
                        <View key={key} style={styles.setBlock}>
                          <Text style={styles.setLabel}>Set {setNumber}</Text>
                          <View style={styles.setRow}>
                            <TextInput
                              accessibilityLabel={`Set ${setNumber} weight`}
                              editable={!isCompleted}
                              keyboardType="decimal-pad"
                              onChangeText={(value) => updateInput(key, 'weight', value)}
                              placeholder="Weight"
                              placeholderTextColor={palette.muted}
                              style={[styles.setInput, isCompleted && styles.setInputDisabled]}
                              value={values.weight}
                            />
                            <TextInput
                              accessibilityLabel={`Set ${setNumber} reps`}
                              editable={!isCompleted}
                              keyboardType="number-pad"
                              onChangeText={(value) => updateInput(key, 'reps', value)}
                              placeholder="Reps"
                              placeholderTextColor={palette.muted}
                              style={[styles.setInput, isCompleted && styles.setInputDisabled]}
                              value={values.reps}
                            />
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={
                                isCompleted
                                  ? `Set ${setNumber} completed`
                                  : `Complete set ${setNumber}`
                              }
                              disabled={isCompleted}
                              onPress={() => {
                                void completeSet(exerciseId, setNumber);
                              }}
                              style={({ pressed }) => [
                                styles.completeButton,
                                isCompleted && styles.completeButtonDone,
                                pressed && !isCompleted && styles.pressed,
                              ]}>
                              <Text
                                style={[
                                  styles.completeButtonLabel,
                                  isCompleted && styles.completeButtonLabelDone,
                                ]}>
                                {isCompleted ? 'Done' : 'Complete'}
                              </Text>
                            </Pressable>
                          </View>
                          {setErrors[key] ? (
                            <Text style={styles.setError}>{setErrors[key]}</Text>
                          ) : null}
                        </View>
                      );
                    })
                  : null}
              </Card>
            );
          })
        )}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Finish Workout"
          disabled={isFinishing || !sessionId}
          onPress={() => {
            void finishWorkout();
          }}
          style={({ pressed }) => [
            styles.finishButton,
            (pressed || isFinishing) && styles.pressed,
          ]}>
          <Text style={styles.finishButtonLabel}>
            {isFinishing ? 'Finishing...' : 'Finish Workout'}
          </Text>
        </Pressable>

        {finishError ? (
          <Text style={styles.error}>Could not finish workout. {finishError}</Text>
        ) : null}
      </Screen>

      <WarmupModal
        visible={warmupExerciseId !== null && warmupExercise !== null}
        exerciseName={warmupExercise?.name ?? ''}
        equipmentType={warmupExercise?.equipment_type ?? null}
        warmupEnabled={Boolean(warmupExercise?.warmup_enabled)}
        minWeight={warmupExercise?.min_weight ?? null}
        weightIncrement={warmupExercise?.weight_increment ?? null}
        initialWorkingWeight={
          warmupExercise
            ? getEnteredWorkingWeight(warmupExercise.id, warmupItem?.target_sets ?? 0)
            : null
        }
        onClose={() => setWarmupExerciseId(null)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: palette.background,
  },
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
    gap: 12,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  exerciseName: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
  },
  warmupButton: {
    minHeight: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.accent,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warmupButtonLabel: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  exerciseMeta: {
    color: palette.muted,
    fontSize: 16,
  },
  setBlock: {
    gap: 8,
    marginTop: 4,
  },
  setLabel: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  setInput: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 12,
  },
  setInputDisabled: {
    opacity: 0.7,
  },
  completeButton: {
    minHeight: 48,
    minWidth: 108,
    borderRadius: 12,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  completeButtonDone: {
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
  },
  completeButtonLabel: {
    color: palette.accentText,
    fontSize: 14,
    fontWeight: '800',
  },
  completeButtonLabelDone: {
    color: palette.accent,
  },
  setError: {
    color: palette.text,
    fontSize: 14,
  },
  finishButton: {
    backgroundColor: palette.accent,
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    marginTop: 8,
  },
  finishButtonLabel: {
    color: palette.accentText,
    fontSize: 20,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
});
