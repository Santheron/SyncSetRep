import { formatTrackedLoad, type LoadMode, type WeightUnit } from '@/lib/load-mode';
import { recommendedWeightIncreaseLb } from '@/lib/weight-increase';
import { formatWeight } from '@/lib/warmup';
import { formatWorkoutDate } from '@/lib/workout-format';
import { prescribedRepsLine } from './workout-today.ts';

export { recommendedWeightIncreaseLb } from '@/lib/weight-increase';

export type ProgressionExercise = {
  targetSets: number;
  minReps: number;
  maxReps: number;
  exercise: {
    id: string;
    name: string;
    category: string;
    exerciseType: string;
    equipmentType: string | null;
    weightIncrement: number | null;
  } | null;
};

export type ProgressionSet = {
  exerciseId: string;
  setNumber: number;
  weight: number | null;
  reps: number | null;
  rir?: number | null;
  isCompleted: boolean;
  loadMode?: LoadMode | null;
  assistance?: number | null;
  weightUnit?: WeightUnit | null;
};

export type ExerciseProgression = {
  isFirstSession: boolean;
  isBodyweight: boolean;
  previousDateLabel: string | null;
  previousLine: string;
  previousLines: string[];
  targetLine: string;
  recommendedWeight: number | null;
  weightIncrease: number | null;
  badges: string[];
  message: string | null;
};

type WorkingSet = {
  setNumber: number;
  weight: number | null;
  reps: number;
  rir: number | null;
  loadMode?: LoadMode | null;
  assistance?: number | null;
  weightUnit?: WeightUnit | null;
};

const DEFAULT_INCREMENT_LB = 5;

const BODYWEIGHT_NAME = /pull[-\s]?ups?|chin[-\s]?ups?|\bdips?\b/;

export function isBodyweightExercise(input: {
  name: string;
  exerciseType?: string | null;
  equipmentType?: string | null;
  previousSets?: WorkingSet[];
}): boolean {
  const equipment = input.equipmentType?.trim().toLowerCase() ?? '';
  const exerciseType = input.exerciseType?.trim().toLowerCase() ?? '';
  const name = input.name.trim().toLowerCase();

  if (equipment === 'bodyweight' || exerciseType.includes('bodyweight')) {
    return true;
  }

  if (BODYWEIGHT_NAME.test(name)) {
    return true;
  }

  const previousSets = input.previousSets ?? [];

  return (
    previousSets.length > 0 &&
    previousSets.every((set) => set.weight === null || set.weight === 0)
  );
}

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function workingSetsFromRecords(
  records: ProgressionSet[] | null | undefined,
  targetSets: number,
): WorkingSet[] {
  const byNumber = new Map<number, WorkingSet>();

  for (const record of records ?? []) {
    const setNumber = toFiniteNumber(record.setNumber);
    const reps = toFiniteNumber(record.reps);

    if (
      !record.isCompleted ||
      setNumber === null ||
      reps === null ||
      byNumber.has(setNumber)
    ) {
      continue;
    }

    byNumber.set(setNumber, {
      setNumber,
      weight: toFiniteNumber(record.weight),
      reps,
      rir: toFiniteNumber(record.rir),
      loadMode: record.loadMode ?? null,
      assistance: record.assistance ?? null,
      weightUnit: record.weightUnit ?? null,
    });
  }

  return [...byNumber.values()]
    .sort((a, b) => a.setNumber - b.setNumber)
    .filter((set) => set.setNumber >= 1 && (targetSets < 1 || set.setNumber <= targetSets));
}

export function getExerciseProgression(input: {
  name: string;
  category?: string | null;
  exerciseType?: string | null;
  equipmentType?: string | null;
  targetSets: number;
  minReps: number;
  maxReps: number;
  weightIncrement?: number | null;
  previousDate?: string | null;
  previousSets: ProgressionSet[];
}): ExerciseProgression {
  const displayedSets = workingSetsFromRecords(input.previousSets ?? [], 0);
  const workingSets = workingSetsFromRecords(input.previousSets ?? [], input.targetSets);
  const isBodyweight = isBodyweightExercise({
    name: input.name ?? '',
    exerciseType: input.exerciseType,
    equipmentType: input.equipmentType,
    previousSets: displayedSets,
  });
  const repRange = prescribedRepsLine(input.minReps, input.maxReps);
  const previousDateLabel =
    input.previousDate && !Number.isNaN(Date.parse(input.previousDate))
      ? formatWorkoutDate(input.previousDate)
      : null;

  if (displayedSets.length === 0) {
    return {
      isFirstSession: true,
      isBodyweight,
      previousDateLabel: null,
      previousLine: 'First recorded session',
      previousLines: ['First recorded session'],
      targetLine: repRange ?? 'Reps not set',
      recommendedWeight: null,
      weightIncrease: null,
      badges: [],
      message: null,
    };
  }

  const previousReps = workingSets.map((set) => set.reps);
  const hitMaxOnAllWorkingSets =
    repRange != null &&
    input.targetSets > 0 &&
    workingSets.length >= input.targetSets &&
    workingSets
      .slice(0, input.targetSets)
      .every((set) => set.reps >= input.maxReps);

  if (isBodyweight) {
    const previousLines = displayedSets.map((set) => formatPreviousSetLine(set, true));
    const slashReps = previousReps.join(' / ');

    return {
      isFirstSession: false,
      isBodyweight: true,
      previousDateLabel,
      previousLine: previousLines.join(' · '),
      previousLines,
      targetLine: hitMaxOnAllWorkingSets && repRange != null ? repRange : `Beat ${slashReps}`,
      recommendedWeight: null,
      weightIncrease: null,
      badges: [hitMaxOnAllWorkingSets ? 'Ready to add weight' : 'Beat last time'],
      message: hitMaxOnAllWorkingSets
        ? 'Ready to add weight or increase difficulty.'
        : null,
    };
  }

  const previousWeight = sharedWorkingWeight(workingSets);
  const displayWeight = previousWeight ?? firstPositiveWeight(workingSets);
  const previousLines = displayedSets.map((set) => formatPreviousSetLine(set, false));
  const previousLine = previousLines.join(' · ');
  const canIncrease =
    hitMaxOnAllWorkingSets &&
    previousWeight !== null &&
    previousWeight > 0 &&
    weightsAreUniform(workingSets);

  const increase = canIncrease
    ? recommendedWeightIncreaseLb({
        name: input.name,
        category: input.category,
        exerciseType: input.exerciseType,
      })
    : null;
  const recommendedWeight =
    displayWeight === null
      ? null
      : canIncrease && increase !== null
        ? increaseWeight(displayWeight, increase, input.weightIncrement)
        : displayWeight;

  const badges: string[] = [];

  if (
    increase !== null &&
    recommendedWeight !== null &&
    displayWeight !== null &&
    recommendedWeight > displayWeight
  ) {
    badges.push('Recommended', `+${increase} lb`);
  } else {
    badges.push('Beat last time');
  }

  return {
    isFirstSession: false,
    isBodyweight: false,
    previousDateLabel,
    previousLine,
    previousLines,
    targetLine:
      recommendedWeight === null
        ? (repRange ?? 'Reps not set')
        : repRange == null
          ? `${formatWeight(recommendedWeight)} lb`
          : `${formatWeight(recommendedWeight)} lb · ${repRange}`,
    recommendedWeight,
    weightIncrease: increase,
    badges,
    message: null,
  };
}

export function buildWorkoutProgressions(
  exercises: ProgressionExercise[],
  previousByExerciseId: Map<string, { date: string | null; sets: ProgressionSet[] }>,
): Map<string, ExerciseProgression> {
  const progressions = new Map<string, ExerciseProgression>();

  for (const item of exercises ?? []) {
    const exerciseId = item.exercise?.id ? String(item.exercise.id) : null;

    if (!exerciseId || !item.exercise) {
      continue;
    }

    const previous = previousByExerciseId.get(exerciseId);

    try {
      console.log('[Progression] input', {
        exerciseId,
        name: item.exercise.name,
        targetSets: item.targetSets,
        targetSetsType: typeof item.targetSets,
        previousDate: previous?.date ?? null,
        previousSetCount: previous?.sets?.length ?? 0,
        weightIncrement: item.exercise.weightIncrement,
        weightIncrementType: typeof item.exercise.weightIncrement,
      });

      progressions.set(
        exerciseId,
        getExerciseProgression({
          name: item.exercise.name ?? '',
          category: item.exercise.category,
          exerciseType: item.exercise.exerciseType,
          equipmentType: item.exercise.equipmentType,
          targetSets: item.targetSets,
          minReps: item.minReps,
          maxReps: item.maxReps,
          weightIncrement: item.exercise.weightIncrement,
          previousDate: previous?.date ?? null,
          previousSets: previous?.sets ?? [],
        }),
      );
    } catch (error) {
      console.error('[START WORKOUT ERROR]', error);
      console.error('[Progression] failed', { exerciseId, error });
      progressions.set(exerciseId, {
        isFirstSession: true,
        isBodyweight: false,
        previousDateLabel: null,
        previousLine: 'First recorded session',
        previousLines: ['First recorded session'],
        targetLine: prescribedRepsLine(item.minReps, item.maxReps) ?? 'Reps not set',
        recommendedWeight: null,
        weightIncrease: null,
        badges: [],
        message: null,
      });
    }
  }

  return progressions;
}

function formatPreviousSetLine(set: WorkingSet, isBodyweight: boolean): string {
  const weight = toFiniteNumber(set.weight);
  let line: string;

  if (set.loadMode != null) {
    line = `${formatTrackedLoad(set)} × ${set.reps}`;
  } else if (isBodyweight) {
    line =
      weight !== null && weight > 0
        ? `+${formatWeight(weight)} lb × ${set.reps}`
        : `BW × ${set.reps}`;
  } else if (weight !== null && weight > 0) {
    line = `${formatWeight(weight)} lb × ${set.reps}`;
  } else {
    line = `BW × ${set.reps}`;
  }

  if (set.rir !== null) {
    line += ` · RIR ${set.rir}`;
  }

  return line;
}

function sharedWorkingWeight(sets: WorkingSet[]): number | null {
  if (sets.length === 0 || !weightsAreUniform(sets)) {
    return firstPositiveWeight(sets);
  }

  return firstPositiveWeight(sets);
}

function weightsAreUniform(sets: WorkingSet[]): boolean {
  if (sets.length === 0) {
    return false;
  }

  const normalized = sets.map((set) => set.weight ?? 0);
  return normalized.every((weight) => weight === normalized[0]);
}

function firstPositiveWeight(sets: WorkingSet[]): number | null {
  for (const set of sets) {
    if (set.weight !== null && set.weight > 0) {
      return set.weight;
    }
  }

  return null;
}

function increaseWeight(
  previousWeight: number,
  amount: number,
  weightIncrement: number | null | undefined,
): number {
  const previous = Number(previousWeight);
  const add = Number(amount);
  const stepCandidate = Number(weightIncrement);
  const step =
    Number.isFinite(stepCandidate) && stepCandidate > 0 ? stepCandidate : DEFAULT_INCREMENT_LB;
  const target = previous + add;
  const snapped = Math.round(target / step) * step;

  if (snapped > previous) {
    return snapped;
  }

  return previous + step;
}
