import { useEffect, useState } from 'react';
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
import { usePersistedWorkoutSets } from '@/hooks/use-persisted-workout-sets';
import { useRestTimer } from '@/hooks/use-rest-timer';
import { parsePositiveWeight } from '@/lib/warmup';
import {
  finishWorkoutSession,
  loadActiveWorkout,
  setKey,
  type ProgramExercise,
  type WorkoutSetRecord,
} from '@/lib/workout-session';

const palette = Colors.dark;
const EMPTY_SETS: WorkoutSetRecord[] = [];

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const { sessionId: sessionIdParam } = useLocalSearchParams<{
    sessionId: string | string[];
  }>();
  const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;

  const [programDayName, setProgramDayName] = useState<string | null>(null);
  const [programDaySubtitle, setProgramDaySubtitle] = useState<string | null>(null);
  const [exercises, setExercises] = useState<ProgramExercise[]>([]);
  const [initialSets, setInitialSets] = useState<WorkoutSetRecord[]>(EMPTY_SETS);
  const [isFinished, setIsFinished] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isFinishing, setIsFinishing] = useState(false);
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [warmupExerciseId, setWarmupExerciseId] = useState<string | null>(null);

  const restTimer = useRestTimer();
  const startRestTimer = restTimer.start;
  const isReady = Boolean(sessionId) && loadedSessionId === sessionId && !errorMessage;
  const persisted = usePersistedWorkoutSets(sessionId, initialSets, isFinished, isReady);
  const { inputs, completedSets, setErrors, updateInput, completeSet, flushAll } = persisted;

  useEffect(() => {
    if (!sessionId) {
      setIsLoading(false);
      setLoadedSessionId(null);
      setErrorMessage('Missing workout session.');
      return;
    }

    const id = sessionId;
    let isMounted = true;

    async function loadWorkout() {
      setIsLoading(true);
      const result = await loadActiveWorkout(id);

      if (!isMounted) {
        return;
      }

      if (!result.ok) {
        setErrorMessage(result.error);
        setProgramDayName(null);
        setProgramDaySubtitle(null);
        setExercises([]);
        setInitialSets(EMPTY_SETS);
        setIsFinished(false);
        setLoadedSessionId(null);
        setIsLoading(false);
        return;
      }

      setErrorMessage(null);
      setProgramDayName(result.data.programDay.name);
      setProgramDaySubtitle(result.data.programDay.subtitle);
      setExercises(result.data.exercises);
      setInitialSets(result.data.sets);
      setIsFinished(Boolean(result.data.finishedAt));
      setLoadedSessionId(id);
      setIsLoading(false);
    }

    void loadWorkout();

    return () => {
      isMounted = false;
    };
  }, [sessionId]);

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

  async function handleCompleteSet(exerciseId: string, setNumber: number) {
    const result = await completeSet(exerciseId, setNumber);

    if (result.ok) {
      startRestTimer();
    }
  }

  async function handleFinishWorkout() {
    if (!sessionId || isFinishing || isFinished) {
      return;
    }

    setIsFinishing(true);
    setFinishError(null);

    await flushAll();

    const result = await finishWorkoutSession(sessionId);

    if (!result.ok) {
      setFinishError(result.error);
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
          title: programDayName ?? 'Workout',
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
          <Text style={styles.kicker}>{programDayName ?? 'Workout'}</Text>
          <Text style={styles.title}>Active Workout</Text>
        </View>
        <Text style={styles.subtitle}>
          {isLoading
            ? 'Loading workout...'
            : errorMessage
              ? 'Could not load workout'
              : isFinished
                ? 'This workout is already finished.'
                : programDaySubtitle}
        </Text>

        {isLoading ? (
          <Text style={styles.status}>Loading exercises...</Text>
        ) : errorMessage ? (
          <Text style={styles.error}>Could not load this workout. {errorMessage}</Text>
        ) : (
          exercises.map((item) => {
            const exerciseId = item.exercise?.id;
            const notes = item.notes?.trim();
            const setCount = item.targetSets;

            return (
              <Card key={item.id} style={styles.exerciseCard}>
                <View style={styles.exerciseHeader}>
                  <Text style={styles.exerciseName}>
                    {item.exercise?.name ?? 'Unknown exercise'}
                  </Text>
                  {item.exercise?.warmupEnabled ? (
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
                  {setCount} sets · {item.minReps}–{item.maxReps} reps
                </Text>
                {notes ? <Text style={styles.exerciseMeta}>{notes}</Text> : null}

                {exerciseId
                  ? Array.from({ length: setCount }, (_, index) => {
                      const setNumber = index + 1;
                      const key = setKey(exerciseId, setNumber);
                      const isCompleted = Boolean(completedSets[key]);
                      const values = inputs[key] ?? { weight: '', reps: '', rir: '' };
                      const inputsDisabled = isCompleted || isFinished;

                      return (
                        <View key={key} style={styles.setBlock}>
                          <Text style={styles.setLabel}>Set {setNumber}</Text>
                          <View style={styles.setRow}>
                            <TextInput
                              accessibilityLabel={`Set ${setNumber} weight`}
                              editable={!inputsDisabled}
                              keyboardType="decimal-pad"
                              onChangeText={(value) => updateInput(key, 'weight', value)}
                              placeholder="Weight"
                              placeholderTextColor={palette.muted}
                              style={[
                                styles.setInput,
                                inputsDisabled && styles.setInputDisabled,
                              ]}
                              value={values.weight}
                            />
                            <TextInput
                              accessibilityLabel={`Set ${setNumber} reps`}
                              editable={!inputsDisabled}
                              keyboardType="number-pad"
                              onChangeText={(value) => updateInput(key, 'reps', value)}
                              placeholder="Reps"
                              placeholderTextColor={palette.muted}
                              style={[
                                styles.setInput,
                                inputsDisabled && styles.setInputDisabled,
                              ]}
                              value={values.reps}
                            />
                            <TextInput
                              accessibilityLabel={`Set ${setNumber} RIR`}
                              editable={!inputsDisabled}
                              keyboardType="number-pad"
                              onChangeText={(value) => updateInput(key, 'rir', value)}
                              placeholder="RIR"
                              placeholderTextColor={palette.muted}
                              style={[
                                styles.rirInput,
                                inputsDisabled && styles.setInputDisabled,
                              ]}
                              value={values.rir}
                            />
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={
                                isCompleted
                                  ? `Set ${setNumber} completed`
                                  : `Complete set ${setNumber}`
                              }
                              disabled={isCompleted || isFinished}
                              onPress={() => {
                                void handleCompleteSet(exerciseId, setNumber);
                              }}
                              style={({ pressed }) => [
                                styles.completeButton,
                                isCompleted && styles.completeButtonDone,
                                pressed && !isCompleted && !isFinished && styles.pressed,
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
          disabled={isFinishing || !sessionId || isFinished}
          onPress={() => {
            void handleFinishWorkout();
          }}
          style={({ pressed }) => [
            styles.finishButton,
            (pressed || isFinishing || isFinished) && styles.pressed,
          ]}>
          <Text style={styles.finishButtonLabel}>
            {isFinished ? 'Finished' : isFinishing ? 'Finishing...' : 'Finish Workout'}
          </Text>
        </Pressable>

        {finishError ? (
          <Text style={styles.error}>Could not finish workout. {finishError}</Text>
        ) : null}
      </Screen>

      <WarmupModal
        visible={warmupExerciseId !== null && warmupExercise !== null}
        exerciseName={warmupExercise?.name ?? ''}
        equipmentType={warmupExercise?.equipmentType ?? null}
        warmupEnabled={Boolean(warmupExercise?.warmupEnabled)}
        minWeight={warmupExercise?.minWeight ?? null}
        weightIncrement={warmupExercise?.weightIncrement ?? null}
        initialWorkingWeight={
          warmupExercise
            ? getEnteredWorkingWeight(warmupExercise.id, warmupItem?.targetSets ?? 0)
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
    flexWrap: 'wrap',
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
  rirInput: {
    width: 58,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 8,
    textAlign: 'center',
  },
  setInputDisabled: {
    opacity: 0.7,
  },
  completeButton: {
    minHeight: 48,
    minWidth: 96,
    borderRadius: 12,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
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
