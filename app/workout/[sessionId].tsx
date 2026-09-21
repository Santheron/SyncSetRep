import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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
import { ExercisePickerSheet } from '@/components/exercise-picker-sheet';
import { ExerciseProgressionBlock } from '@/components/exercise-progression';
import { RestTimerCard } from '@/components/rest-timer';
import { PlateLoadHint } from '@/components/plate-load';
import { WarmupModal } from '@/components/warmup-modal';
import { Colors } from '@/constants/theme';
import { usePersistedWorkoutSets } from '@/hooks/use-persisted-workout-sets';
import { useRestTimer } from '@/hooks/use-rest-timer';
import { buildWorkoutProgressions } from '@/lib/progression';
import { parsePositiveWeight } from '@/lib/warmup';
import {
  fetchPreviousPerformanceForExercises,
  finishWorkoutSession,
  listExercisesForPicker,
  loadActiveWorkout,
  setKey,
  swapWorkoutExercise,
  type ExercisePreviousPerformance,
  type ExerciseSwapScope,
  type ProgramExercise,
  type WorkoutExercise,
  type WorkoutSetRecord,
} from '@/lib/workout-session';

const palette = Colors.dark;
const EMPTY_SETS: WorkoutSetRecord[] = [];

export default function ActiveWorkoutScreen() {
  const router = useRouter();
  const { sessionId: sessionIdParam } = useLocalSearchParams<{
    sessionId: string | string[];
  }>();
  const rawSessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;
  const sessionId =
    rawSessionId == null || rawSessionId === '' ? undefined : String(rawSessionId);

  const [programDayName, setProgramDayName] = useState<string | null>(null);
  const [programDaySubtitle, setProgramDaySubtitle] = useState<string | null>(null);
  const [exercises, setExercises] = useState<ProgramExercise[]>([]);
  const [initialSets, setInitialSets] = useState<WorkoutSetRecord[]>(EMPTY_SETS);
  const [previousPerformance, setPreviousPerformance] = useState<
    ExercisePreviousPerformance[]
  >([]);
  const [previousError, setPreviousError] = useState<string | null>(null);
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
  const { inputs, completedSets, setErrors, updateInput, completeSet, flushAll, applySets } =
    persisted;
  const [pickerItem, setPickerItem] = useState<ProgramExercise | null>(null);
  const [pickerExercises, setPickerExercises] = useState<WorkoutExercise[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  const progressions = useMemo(() => {
    try {
      const previousByExerciseId = new Map<
        string,
        { date: string | null; sets: WorkoutSetRecord[] }
      >();

      for (const item of Array.isArray(previousPerformance) ? previousPerformance : []) {
        if (!item?.exerciseId) {
          continue;
        }

        previousByExerciseId.set(String(item.exerciseId), {
          date: item.session?.finishedAt ?? item.session?.startedAt ?? null,
          sets: Array.isArray(item.sets) ? item.sets : [],
        });
      }

      return buildWorkoutProgressions(exercises ?? [], previousByExerciseId);
    } catch (error) {
      console.error('[START WORKOUT ERROR]', error);
      console.error('[WORKOUT SCREEN ERROR]', error);
      return new Map();
    }
  }, [exercises, previousPerformance]);

  useEffect(() => {
    console.log('[WorkoutScreen] mounted', { sessionId });

    if (!sessionId) {
      setIsLoading(false);
      setLoadedSessionId(null);
      setErrorMessage('Missing workout session.');
      return;
    }

    const id = sessionId;
    let isMounted = true;

    async function loadPreviousPerformance(items: ProgramExercise[]) {
      try {
        console.log('[PreviousPerformance] start');
        const previousResult = await fetchPreviousPerformanceForExercises(
          items.flatMap((item) =>
            item.exercise
              ? [
                  {
                    exerciseId: String(item.exercise.id),
                    exerciseName: item.exercise.name,
                  },
                ]
              : [],
          ),
          id,
        );

        if (!isMounted) {
          return;
        }

        if (!previousResult.ok) {
          console.error('[PREVIOUS PERFORMANCE ERROR]', previousResult.error);
          setPreviousPerformance([]);
          setPreviousError(previousResult.error);
          return;
        }

        console.log('[PreviousPerformance] result', {
          count: previousResult.data.length,
          exerciseIds: previousResult.data.map((item) => item.exerciseId),
        });
        setPreviousPerformance(previousResult.data);
        setPreviousError(null);
        console.log('[WorkoutScreen] previous performance loaded');
      } catch (error) {
        console.error('[PREVIOUS PERFORMANCE ERROR]', error);
        if (isMounted) {
          setPreviousPerformance([]);
          setPreviousError('Could not load previous performance.');
        }
      }
    }

    async function loadWorkout() {
      try {
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
          setPreviousPerformance([]);
          setPreviousError(null);
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
        setPreviousPerformance([]);
        setPreviousError(null);
        setIsFinished(Boolean(result.data.finishedAt));
        setLoadedSessionId(id);
        setIsLoading(false);
        console.log('[WorkoutScreen] exercises', result.data.exercises.length);
        console.log('[WorkoutScreen] persisted sets', result.data.sets.length);

        void loadPreviousPerformance(result.data.exercises);
      } catch (error) {
        console.error('[WORKOUT SCREEN ERROR]', error);
        if (!isMounted) {
          return;
        }

        setErrorMessage(
          error instanceof Error ? error.message : 'Could not load this workout.',
        );
        setPreviousPerformance([]);
        setIsLoading(false);
      }
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

  function hasCompletedSets(exerciseId: string, setCount: number): boolean {
    for (let setNumber = 1; setNumber <= setCount; setNumber += 1) {
      if (completedSets[setKey(exerciseId, setNumber)]) {
        return true;
      }
    }

    return false;
  }

  async function openExercisePicker(item: ProgramExercise) {
    const exerciseId = item.exercise?.id ? String(item.exercise.id) : null;
    const programExerciseId = String(item.programExerciseId || item.id);

    if (!exerciseId || programExerciseId.startsWith('session:') || isFinished || isSwapping) {
      return;
    }

    const openPicker = async () => {
      setPickerItem(item);
      setPickerLoading(true);
      setPickerError(null);
      const result = await listExercisesForPicker();

      if (!result.ok) {
        setPickerExercises([]);
        setPickerError(result.error);
        setPickerLoading(false);
        return;
      }

      setPickerExercises(result.data.filter((exercise) => exercise.id !== exerciseId));
      setPickerLoading(false);
    };

    if (hasCompletedSets(exerciseId, Number(item.targetSets) || 0)) {
      Alert.alert(
        'You already logged sets for this exercise.',
        'Keep completed sets and switch remaining sets?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Keep completed sets and switch remaining sets',
            onPress: () => {
              void openPicker();
            },
          },
        ],
      );
      return;
    }

    void openPicker();
  }

  async function confirmExerciseSwap(exercise: WorkoutExercise, scope: ExerciseSwapScope) {
    if (!sessionId || !pickerItem?.exercise || isSwapping) {
      return;
    }

    const fromExerciseId = String(pickerItem.exercise.id);
    const programExerciseId = String(pickerItem.programExerciseId || pickerItem.id);
    const keepCompletedSets = hasCompletedSets(
      fromExerciseId,
      Number(pickerItem.targetSets) || 0,
    );

    setIsSwapping(true);
    setSwapError(null);
    await flushAll();

    const result = await swapWorkoutExercise({
      sessionId,
      programExerciseId,
      fromExerciseId,
      toExerciseId: exercise.id,
      scope,
      keepCompletedSets,
    });

    if (!result.ok) {
      setSwapError(result.error);
      setIsSwapping(false);
      return;
    }

    setExercises(result.data.exercises);
    setInitialSets(result.data.sets);
    applySets(result.data.sets);
    setPickerItem(null);
    setIsSwapping(false);

    const previousResult = await fetchPreviousPerformanceForExercises(
      result.data.exercises.flatMap((item) =>
        item.exercise
          ? [
              {
                exerciseId: String(item.exercise.id),
                exerciseName: item.exercise.name,
              },
            ]
          : [],
      ),
      sessionId,
    );

    if (previousResult.ok) {
      setPreviousPerformance(previousResult.data);
      setPreviousError(null);
    } else {
      setPreviousPerformance([]);
      setPreviousError(previousResult.error);
    }
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
            const exerciseId = item.exercise?.id ? String(item.exercise.id) : undefined;
            const notes = item.notes?.trim();
            const setCount = Number(item.targetSets) || 0;
            const progression = exerciseId ? progressions.get(exerciseId) : undefined;

            return (
              <Card key={item.id} style={styles.exerciseCard}>
                <View style={styles.exerciseHeader}>
                  <Text style={styles.exerciseName}>
                    {item.exercise?.name ?? 'Unknown exercise'}
                  </Text>
                  <View style={styles.exerciseActions}>
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
                    {!isFinished &&
                    !String(item.id).endsWith(':logged') &&
                    !String(item.programExerciseId || item.id).startsWith('session:') ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Exercise menu for ${item.exercise?.name ?? 'exercise'}`}
                        onPress={() => {
                          void openExercisePicker(item);
                        }}
                        style={({ pressed }) => [
                          styles.menuButton,
                          pressed && styles.pressed,
                        ]}>
                        <Text style={styles.menuButtonLabel}>···</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                {item.exercise?.category ? (
                  <Text style={styles.exerciseMeta}>{item.exercise.category}</Text>
                ) : null}
                <Text style={styles.exerciseMeta}>
                  {item.maxReps > 0
                    ? `${setCount} sets · ${item.minReps}–${item.maxReps} reps`
                    : `${setCount} sets`}
                </Text>
                {notes ? <Text style={styles.exerciseMeta}>{notes}</Text> : null}
                {progression ? <ExerciseProgressionBlock progression={progression} /> : null}

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
                              value={String(values.weight ?? '')}
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
                              value={String(values.reps ?? '')}
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
                              value={String(values.rir ?? '')}
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
                          <PlateLoadHint
                            equipmentType={item.exercise?.equipmentType}
                            exerciseName={item.exercise?.name}
                            weight={values.weight}
                          />
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

        {swapError ? (
          <Text style={styles.error}>Could not swap exercise. {swapError}</Text>
        ) : null}

        {previousError ? (
          <Text style={styles.error}>Could not load previous performance. {previousError}</Text>
        ) : null}

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
      <ExercisePickerSheet
        visible={pickerItem !== null}
        currentName={pickerItem?.exercise?.name ?? 'this exercise'}
        exercises={pickerExercises}
        isLoading={pickerLoading || isSwapping}
        errorMessage={pickerError}
        onClose={() => {
          if (!isSwapping) {
            setPickerItem(null);
          }
        }}
        onConfirm={(exercise, scope) => {
          void confirmExerciseSwap(exercise, scope);
        }}
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
  exerciseActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  menuButton: {
    minHeight: 32,
    minWidth: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuButtonLabel: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
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
