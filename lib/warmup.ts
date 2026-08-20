export type EquipmentType =
  | 'barbell'
  | 'dumbbell'
  | 'cable'
  | 'machine'
  | 'bodyweight';

export type WarmupSet = {
  label: string;
  weight: number;
  reps: string;
};

export type WarmupPlan = {
  sets: WarmupSet[];
  message: string | null;
  weightNote: string | null;
  needsWorkingWeight: boolean;
};

export type WarmupInput = {
  exerciseName: string;
  equipmentType: string | null;
  warmupEnabled: boolean;
  minWeight: number | null;
  weightIncrement: number | null;
  workingWeight: number | null;
};

const EMPTY_BAR_LB = 45;
const BARBELL_DEFAULT_INCREMENT = 5;
const DUMBBELL_MAX_LB = 100;
const DUMBBELL_INCREMENT = 5;

const DUMBBELL_WEIGHTS: number[] = Array.from(
  { length: DUMBBELL_MAX_LB / DUMBBELL_INCREMENT },
  (_, index) => (index + 1) * DUMBBELL_INCREMENT,
);

export function parsePositiveWeight(value: string): number | null {
  const parsed = Number(value.trim());

  if (!value.trim() || !Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

export function formatWeight(weight: number): string {
  if (Number.isInteger(weight)) {
    return String(weight);
  }

  return String(Number(weight.toFixed(2)));
}

export function normalizeEquipmentType(
  value: string | null | undefined,
): EquipmentType | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (
    normalized === 'barbell' ||
    normalized === 'dumbbell' ||
    normalized === 'cable' ||
    normalized === 'machine' ||
    normalized === 'bodyweight'
  ) {
    return normalized;
  }

  return null;
}

export function calculateWarmup(input: WarmupInput): WarmupPlan {
  if (!input.warmupEnabled) {
    return emptyPlan();
  }

  const equipmentType = normalizeEquipmentType(input.equipmentType);

  if (equipmentType === 'bodyweight') {
    return {
      sets: [],
      message: bodyweightMessage(input.exerciseName),
      weightNote: null,
      needsWorkingWeight: false,
    };
  }

  if (input.workingWeight === null) {
    return {
      sets: [],
      message: null,
      weightNote: equipmentType === 'dumbbell' ? 'Weight per dumbbell' : null,
      needsWorkingWeight: true,
    };
  }

  if (equipmentType === 'barbell') {
    return {
      sets: labelSets(
        barbellWarmupSets(
          input.workingWeight,
          input.weightIncrement,
          input.minWeight,
        ),
      ),
      message: barbellEmptyMessage(input.workingWeight, input.minWeight),
      weightNote: null,
      needsWorkingWeight: false,
    };
  }

  if (equipmentType === 'dumbbell') {
    return {
      sets: labelSets(dumbbellWarmupSets(input.workingWeight, input.minWeight)),
      message: dumbbellEmptyMessage(input.workingWeight),
      weightNote: 'Weight per dumbbell',
      needsWorkingWeight: false,
    };
  }

  if (equipmentType === 'machine' || equipmentType === 'cable') {
    return {
      sets: labelSets(
        stackWarmupSets(
          input.workingWeight,
          input.minWeight,
          input.weightIncrement,
        ),
      ),
      message: stackEmptyMessage(
        input.workingWeight,
        input.minWeight,
        input.weightIncrement,
      ),
      weightNote: null,
      needsWorkingWeight: false,
    };
  }

  return emptyPlan();
}

function emptyPlan(): WarmupPlan {
  return {
    sets: [],
    message: null,
    weightNote: null,
    needsWorkingWeight: false,
  };
}

function labelSets(sets: { weight: number; reps: string }[]): WarmupSet[] {
  return sets.map((set, index) => ({
    label: `W${index + 1}`,
    weight: set.weight,
    reps: set.reps,
  }));
}

function barbellWarmupSets(
  workingWeight: number,
  weightIncrement: number | null,
  minWeight: number | null,
): { weight: number; reps: string }[] {
  const increment =
    weightIncrement && weightIncrement > 0
      ? weightIncrement
      : BARBELL_DEFAULT_INCREMENT;
  const bar = Math.max(EMPTY_BAR_LB, minWeight ?? EMPTY_BAR_LB);

  if (workingWeight <= bar) {
    return [];
  }

  const emptyBar = { weight: bar, reps: workingWeight >= 135 ? '10' : '8' };
  const fifty = snapWarmupWeight(workingWeight * 0.5, workingWeight, increment, bar);

  if (fifty === null || fifty <= bar) {
    const ramp = snapWarmupWeight(
      workingWeight * 0.8,
      workingWeight,
      increment,
      bar,
    );

    return dedupeRamp(
      ramp !== null && ramp > bar ? [emptyBar, { weight: ramp, reps: '3' }] : [emptyBar],
      increment * 2,
      workingWeight,
    );
  }

  return dedupeRamp(
    [
      emptyBar,
      { weight: fifty, reps: '5' },
      maybeSet(workingWeight * 0.7, workingWeight, increment, bar, '3'),
      maybeSet(workingWeight * 0.85, workingWeight, increment, bar, '1–2'),
    ].filter((set): set is { weight: number; reps: string } => set !== null),
    increment * 2,
    workingWeight,
  );
}

function dumbbellWarmupSets(
  workingWeight: number,
  minWeight: number | null,
): { weight: number; reps: string }[] {
  const minimum = minWeight && minWeight > 0 ? minWeight : DUMBBELL_INCREMENT;

  return dedupeRamp(
    [
      maybeDumbbell(workingWeight * 0.5, workingWeight, minimum, '8'),
      maybeDumbbell(workingWeight * 0.7, workingWeight, minimum, '5'),
      maybeDumbbell(workingWeight * 0.85, workingWeight, minimum, '2'),
    ].filter((set): set is { weight: number; reps: string } => set !== null),
    DUMBBELL_INCREMENT,
    workingWeight,
  );
}

function stackWarmupSets(
  workingWeight: number,
  minWeight: number | null,
  weightIncrement: number | null,
): { weight: number; reps: string }[] {
  const increment =
    weightIncrement && weightIncrement > 0 ? weightIncrement : BARBELL_DEFAULT_INCREMENT;
  const minimum = Math.max(minWeight ?? increment, increment);

  if (workingWeight <= minimum) {
    return [];
  }

  return dedupeRamp(
    [
      maybeSet(workingWeight * 0.5, workingWeight, increment, minimum, '8'),
      maybeSet(workingWeight * 0.7, workingWeight, increment, minimum, '5'),
      maybeSet(workingWeight * 0.85, workingWeight, increment, minimum, '2'),
    ].filter((set): set is { weight: number; reps: string } => set !== null),
    increment,
    workingWeight,
  );
}

function maybeSet(
  rawWeight: number,
  workingWeight: number,
  increment: number,
  minWeight: number,
  reps: string,
): { weight: number; reps: string } | null {
  const weight = snapWarmupWeight(rawWeight, workingWeight, increment, minWeight);

  if (weight === null) {
    return null;
  }

  return { weight, reps };
}

function maybeDumbbell(
  rawWeight: number,
  workingWeight: number,
  minWeight: number,
  reps: string,
): { weight: number; reps: string } | null {
  const weight = closestDumbbell(rawWeight, workingWeight, minWeight);

  if (weight === null) {
    return null;
  }

  return { weight, reps };
}

export function roundToIncrement(value: number, increment: number): number {
  if (increment <= 0) {
    return value;
  }

  return Math.round(value / increment) * increment;
}

function snapWarmupWeight(
  rawWeight: number,
  workingWeight: number,
  increment: number,
  minWeight: number,
): number | null {
  let weight = roundToIncrement(rawWeight, increment);

  if (weight < minWeight) {
    weight = roundToIncrement(minWeight, increment);
    if (weight < minWeight) {
      weight += increment;
    }
  }

  if (weight >= workingWeight || weight < minWeight || weight <= 0) {
    return null;
  }

  return cleanNumber(weight);
}

function closestDumbbell(
  rawWeight: number,
  workingWeight: number,
  minWeight: number,
): number | null {
  const available = DUMBBELL_WEIGHTS.filter(
    (weight) => weight >= minWeight && weight < workingWeight,
  );

  if (available.length === 0) {
    return null;
  }

  let best = available[0];
  let bestDistance = Math.abs(rawWeight - best);

  for (const weight of available) {
    const distance = Math.abs(rawWeight - weight);

    if (distance < bestDistance || (distance === bestDistance && weight < best)) {
      best = weight;
      bestDistance = distance;
    }
  }

  return best;
}

function dedupeRamp(
  sets: { weight: number; reps: string }[],
  minGap: number,
  workingWeight: number,
): { weight: number; reps: string }[] {
  const result: { weight: number; reps: string }[] = [];

  for (const set of sets) {
    const previous = result[result.length - 1];

    if (previous && set.weight - previous.weight < minGap) {
      continue;
    }

    if (result.length > 0 && workingWeight - set.weight < minGap) {
      continue;
    }

    result.push(set);
  }

  return result;
}

function cleanNumber(value: number): number {
  return Number(value.toFixed(4));
}

function barbellEmptyMessage(
  workingWeight: number,
  minWeight: number | null,
): string | null {
  const bar = Math.max(EMPTY_BAR_LB, minWeight ?? EMPTY_BAR_LB);

  if (workingWeight <= bar) {
    return 'Working weight is too close to the empty bar for ramp-up sets.';
  }

  return null;
}

function dumbbellEmptyMessage(workingWeight: number): string | null {
  if (workingWeight <= DUMBBELL_INCREMENT) {
    return 'Working weight is too light for additional warm-up dumbbells.';
  }

  return null;
}

function stackEmptyMessage(
  workingWeight: number,
  minWeight: number | null,
  weightIncrement: number | null,
): string | null {
  const increment =
    weightIncrement && weightIncrement > 0 ? weightIncrement : BARBELL_DEFAULT_INCREMENT;
  const minimum = Math.max(minWeight ?? increment, increment);

  if (workingWeight <= minimum) {
    return 'Working weight is too close to the stack minimum for ramp-up sets.';
  }

  return null;
}

function bodyweightMessage(exerciseName: string): string {
  const name = exerciseName.toLowerCase();
  const intro = 'Use an easier assisted variation for 1–2 warm-up sets.';

  if (/pull[-\s]?ups?|chin[-\s]?ups?/.test(name)) {
    return `${intro} For pull-ups, use a band-assisted pull-up or an assisted pull-up machine.`;
  }

  if (/\bdips?\b/.test(name)) {
    return `${intro} For dips, use an assisted dip or a feet-assisted dip.`;
  }

  return intro;
}
