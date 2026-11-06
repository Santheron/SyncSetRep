import { useEffect, useMemo, useRef, useState } from 'react';
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
import { EquipmentToday } from '@/components/equipment-today';
import { WorkoutTargetSetup } from '@/components/workout-target-setup';
import { PlateLoadHint } from '@/components/plate-load';
import { WarmupModal } from '@/components/warmup-modal';
import { Colors } from '@/constants/theme';
import { usePersistedWorkoutSets } from '@/hooks/use-persisted-workout-sets';
import { formatTrackedLoad, TRACKING_MODE_LABELS } from '@/lib/load-mode';
import { useRestTimer } from '@/hooks/use-rest-timer';
import { duplicateExerciseSlotIds } from '@/lib/exercise-swap';
import { buildWorkoutProgressions } from '@/lib/progression';
import { loadEquipmentSuggestions } from '@/lib/equipment-suggestion-load';
import type { LinkedSuggestion } from '@/lib/equipment-progression';
import { establishedEquipmentKind, resolveEquipmentExercise } from '@/lib/equipment-identity';
import { createCustomExercise } from '@/lib/import/custom-exercise';
import { saveEquipmentTargetRow } from '@/lib/import/equipment-target-save';
import {
  parsePlateSetup,
  replaceEquipmentWeight,
  type EquipmentKind,
} from '@/lib/import/equipment-targets';
import { CUSTOM_EXERCISE_WRITES_ENABLED } from '@/lib/import/planned-exercises';
import { formatPlannedWeightSentence } from '@/lib/import/planned-weight';
import { parsePositiveWeight } from '@/lib/warmup';
import {
  acceptedTodayTarget,
  missingTargetFields,
  plannedRepsLabel,
  readTodayTargets,
  removableSetNumber,
  routineRepsToStore,
  routineSetsToStore,
  visibleSetCount,
  writeTodayTarget,
  type TodayTarget,
} from '@/lib/workout-today';
import { documentWorkoutTodayStore } from '@/lib/workout-today-file';
import {
  fetchPreviousPerformanceForExercises,
  finishWorkoutSession,
  listExercisesForPicker,
  addUnfinishedWorkoutSet,
  loadActiveWorkout,
  removeUnfinishedWorkoutSet,
  saveProgramExerciseTargets,
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
  const [equipmentSuggestions, setEquipmentSuggestions] = useState<Record<string, LinkedSuggestion>>({});
  const [dismissedEquipment, setDismissedEquipment] = useState<Record<string, boolean>>({});
  const [selectedEquipment, setSelectedEquipment] = useState<Record<string, EquipmentKind>>({});
  const [plannedDrafts, setPlannedDrafts] = useState<Record<string, string>>({});
  const [saveOffers, setSaveOffers] = useState<Record<string, string>>({});
  const [pendingTry, setPendingTry] = useState<Record<string, number>>({});
  const [todayTargets, setTodayTargets] = useState<Record<string, TodayTarget>>({});
  const [targetMessage, setTargetMessage] = useState<string | null>(null);
  const todayStore = useRef(documentWorkoutTodayStore());
  const [plateBar, setPlateBar] = useState('45');
  const [plateList, setPlateList] = useState('45, 35, 25, 10, 5, 2.5');
  const equipmentOrigins = useRef<Record<string, { id: string; name: string; equipmentType: string | null }>>({});
  const rememberedEquipmentIds = useRef<Record<string, string>>({});

  const restTimer = useRestTimer();
  const startRestTimer = restTimer.start;
  const isReady = Boolean(sessionId) && loadedSessionId === sessionId && !errorMessage;
  const persisted = usePersistedWorkoutSets(sessionId, initialSets, isFinished, isReady);
  const {
    inputs,
    completedSets,
    setErrors,
    updateInput,
    completeSet,
    tracking,
    setExerciseTracking,
    flushAll,
    applySets,
    setBlockedSlotIds,
  } = persisted;
  const blockedSlotIds = useMemo(
    () =>
      duplicateExerciseSlotIds(
        exercises.flatMap((item) => {
          const exerciseId = item.exercise?.id ? String(item.exercise.id) : '';

          if (!exerciseId || String(item.id).endsWith(':logged')) {
            return [];
          }

          return [{ slotId: String(item.programExerciseId || item.id), exerciseId }];
        }),
      ),
    [exercises],
  );
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
    setBlockedSlotIds(blockedSlotIds);
  }, [blockedSlotIds, setBlockedSlotIds]);

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
        setTodayTargets(readTodayTargets(todayStore.current, id));
        setLoadedSessionId(id);
        setIsLoading(false);
        console.log('[WorkoutScreen] exercises', result.data.exercises.length);
        console.log('[WorkoutScreen] persisted sets', result.data.sets.length);

        void loadPreviousPerformance(result.data.exercises);
        void loadEquipmentSuggestions(
          result.data.exercises.flatMap((item) => {
            if (!item.exercise) {
              return [];
            }
            return [
              {
                slotId: String(item.programExerciseId || item.id),
                name: item.exercise.name,
                equipmentType: item.exercise.equipmentType,
                targetSets: item.targetSets,
                category: item.exercise.category,
                exerciseType: item.exercise.exerciseType,
                weightIncrement: item.exercise.weightIncrement,
              },
            ];
          }),
          id,
        )
          .then((suggestions) => {
            if (isMounted) {
              setEquipmentSuggestions(suggestions);
            }
          })
          .catch(() => {
            if (isMounted) {
              setEquipmentSuggestions({});
            }
          });
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

  function getEnteredWorkingWeight(
    slotId: string,
    exerciseId: string,
    setCount: number,
  ): number | null {
    for (let setNumber = 1; setNumber <= setCount; setNumber += 1) {
      const weight = parsePositiveWeight(
        inputs[setKey(slotId, exerciseId, setNumber)]?.weight ?? '',
      );

      if (weight !== null) {
        return weight;
      }
    }

    return null;
  }

  async function handleCompleteSet(slotId: string, exerciseId: string, setNumber: number) {
    const result = await completeSet(slotId, exerciseId, setNumber);

    if (result.ok) {
      startRestTimer();
      const tried = pendingTry[slotId];
      const logged = Number(inputs[setKey(slotId, exerciseId, setNumber)]?.weight);
      if (tried != null && logged === tried) {
        setSaveOffers((current) => ({
          ...current,
          [slotId]: `Logged ${tried} lb. Save to routine keeps this for future workouts. Today's set stays as logged.`,
        }));
      }
    }
  }

  function originForSlot(item: ProgramExercise, slotId: string) {
    const existing = equipmentOrigins.current[slotId];
    if (existing) {
      return existing;
    }
    const source = item.templateExercise?.id ? item.templateExercise : item.exercise;
    if (!source?.id) {
      return null;
    }
    const origin = {
      id: String(source.id),
      name: source.name,
      equipmentType: source.equipmentType,
    };
    equipmentOrigins.current[slotId] = origin;
    return origin;
  }

  async function selectTodayEquipment(item: ProgramExercise, equipment: EquipmentKind) {
    const slotId = String(item.programExerciseId || item.id);
    if (!item.exercise) {
      setSelectedEquipment((current) => ({ ...current, [slotId]: equipment }));
      return;
    }
    const origin = originForSlot(item, slotId);
    const rememberedKey = `${slotId}:${equipment}`;
    const identityInput = {
      selected: equipment,
      currentId: String(item.exercise.id),
      currentName: item.exercise.name,
      currentEquipmentType: item.exercise.equipmentType,
      originId: origin?.id ?? null,
      originName: origin?.name ?? null,
      originEquipmentType: origin?.equipmentType ?? null,
      targets: item.equipmentTargets,
      rememberedId: rememberedEquipmentIds.current[rememberedKey] ?? null,
    };
    let choice = resolveEquipmentExercise(identityInput);
    if (choice.action === 'create') {
      const listed = await listExercisesForPicker();
      if (listed.ok) {
        choice = resolveEquipmentExercise({
          ...identityInput,
          known: listed.data.map((exercise) => ({
            id: exercise.id,
            name: exercise.name,
            equipmentType: exercise.equipmentType,
          })),
        });
      }
    }
    if (choice.action === 'stay') {
      rememberedEquipmentIds.current[rememberedKey] = choice.exerciseId ?? String(item.exercise.id);
      setSelectedEquipment((current) => ({ ...current, [slotId]: equipment }));
      return;
    }
    let nextId = choice.exerciseId;
    if (choice.action === 'create') {
      if (!CUSTOM_EXERCISE_WRITES_ENABLED || !choice.createName) {
        setSaveOffers((current) => ({
          ...current,
          [slotId]: 'Today uses this equipment on the current exercise. A separate history row was not created, and the routine was not changed.',
        }));
        return;
      }
      const created = await createCustomExercise(choice.createName);
      if (!created.ok) {
        setSaveOffers((current) => ({ ...current, [slotId]: created.error }));
        return;
      }
      nextId = created.exerciseId;
    }
    if (!nextId || !sessionId) {
      setSaveOffers((current) => ({
        ...current,
        [slotId]: 'Today uses this equipment on the current exercise. A separate history row was not created, and the routine was not changed.',
      }));
      return;
    }
    if (nextId === String(item.exercise.id)) {
      rememberedEquipmentIds.current[rememberedKey] = nextId;
      setSelectedEquipment((current) => ({ ...current, [slotId]: equipment }));
      return;
    }
    const keepCompletedSets = hasCompletedSets(slotId, String(item.exercise.id), Number(item.targetSets) || 0);
    const swapped = await swapWorkoutExercise({
      sessionId,
      programExerciseId: slotId,
      fromExerciseId: String(item.exercise.id),
      toExerciseId: nextId,
      scope: 'session',
      keepCompletedSets,
    });
    if (!swapped.ok) {
      setSwapError(swapped.error);
      return;
    }
    rememberedEquipmentIds.current[rememberedKey] = nextId;
    setSelectedEquipment((current) => ({ ...current, [slotId]: equipment }));
    setExercises(swapped.data.exercises);
    setInitialSets(swapped.data.sets);
    applySets(swapped.data.sets);
  }

  function trySuggestedWeight(item: ProgramExercise, slotId: string, exerciseId: string) {
    const suggestion = equipmentSuggestions[slotId];
    if (suggestion?.suggestedWeight == null) {
      return;
    }
    const setCount = Number(item.targetSets) || 0;
    for (let setNumber = 1; setNumber <= setCount; setNumber += 1) {
      const key = setKey(slotId, exerciseId, setNumber);
      if (!completedSets[key]) {
        updateInput(key, 'weight', String(suggestion.suggestedWeight));
      }
    }
    setPendingTry((current) => ({ ...current, [slotId]: suggestion.suggestedWeight ?? 0 }));
    setDismissedEquipment((current) => ({ ...current, [slotId]: false }));
  }

  async function saveFutureWeight(item: ProgramExercise, slotId: string, equipment: EquipmentKind) {
    const raw = (plannedDrafts[slotId] ?? '').trim();
    const weight = Number(raw);
    if (!Number.isFinite(weight) || weight < 0 || weight > 2000) {
      setSaveOffers((current) => ({
        ...current,
        [slotId]: 'Enter a future planned weight from 0 through 2000. Today\'s logged sets were not changed.',
      }));
      return;
    }
    const saved = await saveEquipmentTargetRow(
      slotId,
      replaceEquipmentWeight(item.equipmentTargets, equipment, weight, 'lb'),
    );
    setSaveOffers((current) => ({
      ...current,
      [slotId]: saved.ok
        ? 'Future planned weight was saved. Today\'s logged sets were not changed.'
        : saved.error,
    }));
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

  function hasCompletedSets(slotId: string, exerciseId: string, setCount: number): boolean {
    for (let setNumber = 1; setNumber <= setCount; setNumber += 1) {
      if (completedSets[setKey(slotId, exerciseId, setNumber)]) {
        return true;
      }
    }

    return false;
  }

  async function openExercisePicker(item: ProgramExercise) {
    const exerciseId = item.exercise?.id ? String(item.exercise.id) : null;
    const programExerciseId = String(item.programExerciseId || item.id);

    if (!exerciseId || String(item.id).endsWith(':logged') || isFinished || isSwapping) {
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

      setPickerExercises(result.data);
      setPickerLoading(false);
    };

    if (hasCompletedSets(programExerciseId, exerciseId, Number(item.targetSets) || 0)) {
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
      programExerciseId,
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
      setPickerError(result.error);
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

  function rememberToday(slotId: string, target: TodayTarget) {
    if (!sessionId) {
      return;
    }
    setTodayTargets(writeTodayTarget(todayStore.current, sessionId, slotId, target));
  }

  async function refreshWorkoutSets() {
    if (!sessionId) {
      return;
    }
    const loaded = await loadActiveWorkout(sessionId);
    if (!loaded.ok) {
      setTargetMessage(loaded.error);
      return;
    }
    setExercises(loaded.data.exercises);
    setInitialSets(loaded.data.sets);
    applySets(loaded.data.sets);
  }

  async function useTargetsForToday(
    slotId: string,
    exerciseId: string,
    askSets: boolean,
    askReps: boolean,
    setsText: string,
    repsText: string,
    existingSets: number | null,
    existingReps: number | null,
  ) {
    const accepted = acceptedTodayTarget({
      askSets,
      askReps,
      setsText,
      repsText,
      existingSets,
      existingReps,
    });
    if (!accepted.ok) {
      setTargetMessage(accepted.error);
      return;
    }
    const sets = accepted.sets ?? existingSets;
    if (sets == null) {
      setTargetMessage('Enter sets before continuing.');
      return;
    }
    const current = todayTargets[slotId] ?? { sets: null, reps: null };
    rememberToday(slotId, { sets, reps: askReps ? accepted.reps : current.reps });
    if (!sessionId) {
      return;
    }
    await flushAll();
    const present = initialSets.filter((set) => set.exerciseId === exerciseId).map((set) => set.setNumber);
    for (let setNumber = 1; setNumber <= sets; setNumber += 1) {
      if (present.includes(setNumber)) {
        continue;
      }
      const added = await addUnfinishedWorkoutSet(sessionId, exerciseId, setNumber);
      if (!added.ok) {
        setTargetMessage(added.error);
        await refreshWorkoutSets();
        return;
      }
    }
    setTargetMessage(null);
    await refreshWorkoutSets();
  }

  async function addSetForToday(slotId: string, exerciseId: string, nextNumber: number, reps: number | null) {
    if (!sessionId || isFinished) {
      return;
    }
    if (nextNumber > 12) {
      setTargetMessage('Enter sets from 1 through 12.');
      return;
    }
    await flushAll();
    const added = await addUnfinishedWorkoutSet(sessionId, exerciseId, nextNumber);
    if (!added.ok) {
      setTargetMessage(added.error);
      return;
    }
    rememberToday(slotId, { sets: nextNumber, reps });
    setTargetMessage(null);
    await refreshWorkoutSets();
  }

  async function removeSetForToday(slotId: string, exerciseId: string, setNumber: number, reps: number | null) {
    if (!sessionId || isFinished) {
      return;
    }
    const row = initialSets.find((set) => set.exerciseId === exerciseId && set.setNumber === setNumber);
    if (!row || row.isCompleted) {
      setTargetMessage('Completed sets stay in this workout.');
      return;
    }
    await flushAll();
    const removed = await removeUnfinishedWorkoutSet(sessionId, row.id);
    if (!removed.ok) {
      setTargetMessage(removed.error);
      return;
    }
    const remaining = setNumber - 1;
    rememberToday(slotId, { sets: remaining > 0 ? remaining : null, reps });
    setTargetMessage(null);
    await refreshWorkoutSets();
  }

  async function saveTargetsToRoutine(
    programExerciseId: string,
    sets: number,
    repsMin: number,
    repsMax: number,
  ) {
    const saved = await saveProgramExerciseTargets(programExerciseId, { sets, repsMin, repsMax });
    setTargetMessage(
      saved.ok
        ? 'Planned sets and reps were saved to the routine. Logged reps were not changed.'
        : saved.error,
    );
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
        <TextInput
          accessibilityLabel="Bar weight"
          keyboardType="decimal-pad"
          onChangeText={setPlateBar}
          placeholder="Bar weight"
          placeholderTextColor={palette.muted}
          style={styles.subtitle}
          value={plateBar}
        />
        <TextInput
          accessibilityLabel="Available plates"
          onChangeText={setPlateList}
          placeholder="45, 35, 25, 10, 5, 2.5"
          placeholderTextColor={palette.muted}
          style={styles.subtitle}
          value={plateList}
        />

        {isLoading ? (
          <Text style={styles.status}>Loading exercises...</Text>
        ) : errorMessage ? (
          <Text style={styles.error}>Could not load this workout. {errorMessage}</Text>
        ) : (
          exercises.map((item) => {
            const exerciseId = item.exercise?.id ? String(item.exercise.id) : undefined;
            const slotId = String(item.programExerciseId || item.id);
            const notes = item.notes?.trim();
            const today = todayTargets[slotId] ?? { sets: null, reps: null };
            const recorded = initialSets.filter((set) => exerciseId != null && set.exerciseId === exerciseId);
            const recordedMax = recorded.reduce((highest, set) => Math.max(highest, set.setNumber), 0);
            const prescribedSets = item.prescribedSets === undefined ? (item.targetSets > 0 ? item.targetSets : null) : item.prescribedSets;
            const prescribedRepsMin = item.prescribedRepsMin === undefined ? (item.minReps > 0 ? item.minReps : null) : item.prescribedRepsMin;
            const prescribedRepsMax = item.prescribedRepsMax === undefined ? (item.maxReps > 0 ? item.maxReps : null) : item.prescribedRepsMax;
            const setCount = visibleSetCount({
              todaySets: today.sets,
              prescribedSets,
              recordedMax,
            });
            const missing = missingTargetFields({
              todaySets: today.sets,
              todayReps: today.reps,
              prescribedSets,
              prescribedRepsMin,
              prescribedRepsMax,
              recordedMax,
            });
            const plannedLabel = plannedRepsLabel({
              todayReps: today.reps,
              prescribedRepsMin,
              prescribedRepsMax,
            });
            const plannedRepsValue =
              today.reps != null
                ? String(today.reps)
                : prescribedRepsMin != null && prescribedRepsMin === prescribedRepsMax
                  ? String(prescribedRepsMin)
                  : '';
            const storedSets = routineSetsToStore({
              todaySets: today.sets,
              prescribedSets,
              recordedMax,
            });
            const storedReps = routineRepsToStore({
              todayReps: today.reps,
              prescribedRepsMin,
              prescribedRepsMax,
            });
            const removeNumber = removableSetNumber(recorded, isFinished);
            const canSaveTargets = /^\d+$/.test(slotId) && storedSets != null && storedReps != null && !isFinished;
            const progression = exerciseId ? progressions.get(exerciseId) : undefined;
            const canSwap =
              Boolean(exerciseId) && !isFinished && !String(item.id).endsWith(':logged');
            const slotBlocked = blockedSlotIds.includes(slotId);

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
                    {canSwap ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Swap exercise ${item.exercise?.name ?? 'exercise'}`}
                        disabled={isSwapping}
                        onPress={() => {
                          void openExercisePicker(item);
                        }}
                        style={({ pressed }) => [
                          styles.warmupButton,
                          (pressed || isSwapping) && styles.pressed,
                        ]}>
                        <Text style={styles.warmupButtonLabel}>
                          {isSwapping && pickerItem?.id === item.id ? 'Swapping...' : 'Swap Exercise'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
                {item.exercise?.category ? (
                  <Text style={styles.exerciseMeta}>{item.exercise.category}</Text>
                ) : null}
                <Text style={styles.exerciseMeta}>
                  {setCount > 0 ? `${setCount} sets` : 'Sets not set'}
                  {plannedLabel !== '' ? ` · ${plannedLabel} planned reps` : ' · Reps not set'}
                </Text>
                {exerciseId && (missing.sets || missing.reps) ? (
                  <WorkoutTargetSetup
                    askSets={missing.sets}
                    askReps={missing.reps}
                    disabled={isFinished}
                    onAccept={(setsText, repsText) => {
                      void useTargetsForToday(
                        slotId,
                        exerciseId,
                        missing.sets,
                        missing.reps,
                        setsText,
                        repsText,
                        missing.sets ? null : setCount,
                        missing.reps ? null : today.reps,
                      );
                    }}
                  />
                ) : null}
                {exerciseId && !isFinished && !missing.reps ? (
                  <TextInput
                    accessibilityLabel={`Planned reps for ${item.exercise?.name ?? 'exercise'}`}
                    keyboardType="number-pad"
                    onChangeText={(value) => {
                      const parsed = Number(value);
                      rememberToday(slotId, {
                        sets: today.sets ?? (setCount > 0 ? setCount : null),
                        reps: Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : today.reps,
                      });
                    }}
                    placeholder="Planned reps"
                    placeholderTextColor={palette.muted}
                    style={styles.subtitle}
                    value={plannedRepsValue}
                  />
                ) : null}
                {exerciseId && !isFinished ? (
                  <View style={styles.trackingRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Add set for ${item.exercise?.name ?? 'exercise'}`}
                      onPress={() => {
                        void addSetForToday(slotId, exerciseId, setCount + 1, today.reps);
                      }}
                      style={styles.warmupButton}>
                      <Text style={styles.warmupButtonLabel}>Add set</Text>
                    </Pressable>
                    {removeNumber != null ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove set ${removeNumber}`}
                        onPress={() => {
                          void removeSetForToday(slotId, exerciseId, removeNumber, today.reps);
                        }}
                        style={styles.warmupButton}>
                        <Text style={styles.warmupButtonLabel}>Remove set</Text>
                      </Pressable>
                    ) : null}
                    {canSaveTargets && storedSets != null && storedReps != null ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Save sets and reps to routine for ${item.exercise?.name ?? 'exercise'}`}
                        onPress={() => {
                          void saveTargetsToRoutine(slotId, storedSets, storedReps.min, storedReps.max);
                        }}
                        style={styles.warmupButton}>
                        <Text style={styles.warmupButtonLabel}>Save sets and reps to routine</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
                {item.plannedWeight != null ? (
                  <Text style={styles.exerciseMeta}>
                    {formatPlannedWeightSentence(item.plannedWeight, item.plannedWeightUnit)}
                  </Text>
                ) : null}
                {exerciseId ? (
                  <EquipmentToday
                    dismissed={Boolean(dismissedEquipment[slotId])}
                    onChangePlanned={(value) =>
                      setPlannedDrafts((current) => ({ ...current, [slotId]: value }))
                    }
                    onDismiss={() => setDismissedEquipment((current) => ({ ...current, [slotId]: true }))}
                    onKeep={() => setDismissedEquipment((current) => ({ ...current, [slotId]: true }))}
                    onSavePlanned={() => {
                      void saveFutureWeight(
                        item,
                        slotId,
                        selectedEquipment[slotId] ??
                          establishedEquipmentKind(item.exercise?.name ?? '', item.exercise?.equipmentType),
                      );
                    }}
                    onSelect={(equipment) => {
                      void selectTodayEquipment(item, equipment);
                    }}
                    onTry={() => trySuggestedWeight(item, slotId, exerciseId)}
                    plannedText={plannedDrafts[slotId] ?? ''}
                    saveOffer={saveOffers[slotId] ?? null}
                    selected={
                      selectedEquipment[slotId] ??
                      establishedEquipmentKind(item.exercise?.name ?? '', item.exercise?.equipmentType)
                    }
                    suggestion={equipmentSuggestions[slotId] ?? null}
                    targets={item.equipmentTargets}
                  />
                ) : null}
                {notes ? <Text style={styles.exerciseMeta}>{notes}</Text> : null}
                {slotBlocked ? (
                  <Text style={styles.exerciseMeta}>
                    This exercise also appears in another slot. Sets here stay separate and are not saved over the other slot.
                  </Text>
                ) : null}
                {progression ? <ExerciseProgressionBlock progression={progression} /> : null}
                {exerciseId ? (
                  <View style={styles.trackingRow}>
                    {([
                      ['external', null],
                      ['bodyweight', 'bodyweight'],
                      ['added', 'added'],
                      ['assisted', 'assisted'],
                    ] as const).map(([key, mode]) => {
                      const selected = (tracking[exerciseId]?.loadMode ?? null) === mode;
                      return (
                        <Pressable
                          key={key}
                          accessibilityRole="button"
                          accessibilityLabel={`${TRACKING_MODE_LABELS[key]} tracking`}
                          accessibilityState={{ selected }}
                          onPress={() => setExerciseTracking(exerciseId, mode, tracking[exerciseId]?.weightUnit ?? 'lb')}
                          style={[styles.trackingChip, selected && styles.trackingChipSelected]}>
                          <Text style={[styles.trackingChipLabel, selected && styles.trackingChipLabelSelected]}>
                            {TRACKING_MODE_LABELS[key]}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {(tracking[exerciseId]?.loadMode === 'added' ||
                      tracking[exerciseId]?.loadMode === 'assisted') &&
                    (['lb', 'kg'] as const).map((unit) => {
                      const selected = (tracking[exerciseId]?.weightUnit ?? 'lb') === unit;
                      return (
                        <Pressable
                          key={unit}
                          accessibilityRole="button"
                          accessibilityLabel={`${unit} units`}
                          accessibilityState={{ selected }}
                          onPress={() =>
                            setExerciseTracking(exerciseId, tracking[exerciseId]?.loadMode ?? null, unit)
                          }
                          style={[styles.trackingChip, selected && styles.trackingChipSelected]}>
                          <Text style={[styles.trackingChipLabel, selected && styles.trackingChipLabelSelected]}>
                            {unit}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}

                {exerciseId
                  ? Array.from({ length: setCount }, (_, index) => {
                      const setNumber = index + 1;
                      const key = setKey(slotId, exerciseId, setNumber);
                      const isCompleted = Boolean(completedSets[key]);
                      const values = inputs[key] ?? { weight: '', reps: '', rir: '' };
                      const inputsDisabled = isFinished;

                      return (
                        <View key={key} style={styles.setBlock}>
                          <Text style={styles.setLabel}>{isCompleted ? `Set ${setNumber} logged` : `Set ${setNumber}`}</Text>
                          <View style={styles.setRow}>
                            <TextInput
                              accessibilityLabel={`Set ${setNumber} weight`}
                              editable={!inputsDisabled}
                              keyboardType="decimal-pad"
                              onChangeText={(value) => updateInput(key, 'weight', value)}
                              placeholder={
                                (tracking[exerciseId]?.loadMode ?? null) === 'assisted'
                                  ? 'Assistance'
                                  : (tracking[exerciseId]?.loadMode ?? null) === 'bodyweight'
                                    ? '0'
                                    : 'Weight'
                              }
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
                                void handleCompleteSet(slotId, exerciseId, setNumber);
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
                          <Text style={styles.exerciseMeta}>
                            {formatTrackedLoad({
                              loadMode: tracking[exerciseId]?.loadMode ?? null,
                              weight:
                                (tracking[exerciseId]?.loadMode ?? null) === 'assisted'
                                  ? null
                                  : values.weight,
                              assistance:
                                (tracking[exerciseId]?.loadMode ?? null) === 'assisted'
                                  ? values.weight
                                  : null,
                              weightUnit: tracking[exerciseId]?.weightUnit ?? 'lb',
                            })}
                          </Text>
                          <PlateLoadHint
                            equipmentType={
                              selectedEquipment[slotId] ?? item.exercise?.equipmentType
                            }
                            exerciseName={item.exercise?.name}
                            plateSetup={(() => {
                              const parsed = parsePlateSetup(plateBar, plateList);
                              return parsed.ok ? parsed.setup : null;
                            })()}
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

        {targetMessage ? <Text style={styles.exerciseMeta}>{targetMessage}</Text> : null}
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
            ? getEnteredWorkingWeight(
                String(warmupItem?.programExerciseId || warmupItem?.id || warmupExercise.id),
                warmupExercise.id,
                warmupItem?.targetSets ?? 0,
              )
            : null
        }
        onClose={() => setWarmupExerciseId(null)}
      />
      <ExercisePickerSheet
        visible={pickerItem !== null}
        currentExerciseId={pickerItem?.exercise?.id ? String(pickerItem.exercise.id) : ''}
        currentName={pickerItem?.exercise?.name ?? 'this exercise'}
        currentCategory={pickerItem?.exercise?.category ?? ''}
        currentEquipmentType={pickerItem?.exercise?.equipmentType ?? null}
        canReplaceInProgram={/^\d+$/.test(String(pickerItem?.programExerciseId ?? ''))}
        exercises={pickerExercises}
        isLoading={pickerLoading}
        isSubmitting={isSwapping}
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
  exerciseMeta: {
    color: palette.muted,
    fontSize: 16,
  },
  trackingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  trackingChip: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackingChipSelected: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  trackingChipLabel: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  trackingChipLabelSelected: {
    color: palette.accentText,
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
