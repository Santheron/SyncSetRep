export type EquipmentFamily = 'free-weight' | 'machine' | 'cable' | 'bodyweight' | 'other';

export type PickerExercise = {
  id: string;
  name: string;
  category: string;
  equipmentType: string | null;
};

export type SwapSetRow = {
  id: string;
  exerciseId: string;
  setNumber: number;
  isCompleted: boolean;
};

export type ReplacementPlan =
  | { ok: false; error: string }
  | {
      ok: true;
      deleteIds: string[];
      insertCount: number;
      weight: number | null;
    };

const SET_KEY_SEPARATOR = '\u001f';

export const PRIVATE_EXERCISE_UNAVAILABLE =
  'That exercise is not in the shared catalog. Your workout was not changed. Adding a private exercise needs an approved user-owned exercise policy before it can be saved.';

export const DUPLICATE_SLOT_MESSAGE =
  'This exercise is already in another slot of this workout. Those sets were not overwritten. Saving both copies needs a program_exercise_id column on workout_sets, which has not been added.';

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function equipmentFamily(equipmentType: string | null | undefined): EquipmentFamily {
  const equipment = normalize(equipmentType);

  if (!equipment) {
    return 'other';
  }

  if (equipment.includes('bodyweight') || equipment.includes('assisted')) {
    return 'bodyweight';
  }

  if (equipment.includes('cable')) {
    return 'cable';
  }

  if (
    equipment.includes('machine') ||
    equipment.includes('smith') ||
    equipment.includes('paramount') ||
    equipment.includes('selector')
  ) {
    return 'machine';
  }

  if (
    equipment.includes('barbell') ||
    equipment.includes('dumbbell') ||
    equipment.includes('kettlebell') ||
    equipment.includes('ez bar') ||
    equipment.includes('free weight') ||
    equipment.includes('free-weight')
  ) {
    return 'free-weight';
  }

  return 'other';
}

export function sharesEquipmentProgression(
  sourceEquipmentType: string | null | undefined,
  targetEquipmentType: string | null | undefined,
): boolean {
  const source = normalize(sourceEquipmentType);
  const target = normalize(targetEquipmentType);

  if (!source || !target) {
    return false;
  }

  return equipmentFamily(source) === equipmentFamily(target) && source === target;
}

export function weightForReplacement(input: {
  sourceEquipmentType: string | null | undefined;
  targetEquipmentType: string | null | undefined;
  sourceDraftWeight: number | null;
  targetHistoryWeight: number | null;
}): number | null {
  // The replacement keeps the target exercise's own history. A weight typed
  // on the exercise being replaced is never copied, so a barbell load cannot
  // become the working weight for a machine or a different free weight.
  void input.sourceEquipmentType;
  void input.targetEquipmentType;
  void input.sourceDraftWeight;
  return input.targetHistoryWeight;
}

export function setKey(slotId: string, exerciseId: string, setNumber: number): string {
  return [String(slotId), String(exerciseId), String(setNumber)].join(SET_KEY_SEPARATOR);
}

export function parseSetKey(
  key: string,
): { slotId: string; exerciseId: string; setNumber: number } | null {
  const parts = key.split(SET_KEY_SEPARATOR);

  if (parts.length !== 3) {
    return null;
  }

  const [slotId, exerciseId, setNumberValue] = parts;
  const setNumber = Number(setNumberValue);

  if (!slotId || !exerciseId || !Number.isInteger(setNumber) || setNumber < 1) {
    return null;
  }

  return { slotId, exerciseId, setNumber };
}

export function duplicateExerciseSlotIds(
  slots: readonly { slotId: string; exerciseId: string }[],
): string[] {
  const groups = new Map<string, string[]>();

  for (const slot of slots) {
    const list = groups.get(slot.exerciseId) ?? [];
    list.push(slot.slotId);
    groups.set(slot.exerciseId, list);
  }

  return [...groups.values()].flatMap((list) => (list.length > 1 ? list.slice(1) : []));
}

export function assignLoggedSets<T extends { id: string; exerciseId: string; setNumber: number }>(
  slots: readonly { slotId: string; exerciseId: string; targetSets: number }[],
  rows: readonly T[],
): (T & { slotId: string })[] {
  const counts = new Map<string, number>();

  for (const slot of slots) {
    counts.set(slot.exerciseId, (counts.get(slot.exerciseId) ?? 0) + 1);
  }

  const claimedExercise = new Set<string>();
  const claimedRow = new Set<string>();
  const assigned: (T & { slotId: string })[] = [];

  for (const slot of slots) {
    const shared = (counts.get(slot.exerciseId) ?? 0) > 1;

    if (shared && claimedExercise.has(slot.exerciseId)) {
      continue;
    }

    for (const row of rows) {
      if (row.exerciseId !== slot.exerciseId || claimedRow.has(row.id)) {
        continue;
      }

      if (row.setNumber < 1 || (slot.targetSets > 0 && row.setNumber > slot.targetSets)) {
        continue;
      }

      assigned.push({ ...row, slotId: slot.slotId });
      claimedRow.add(row.id);
    }

    if (shared) {
      claimedExercise.add(slot.exerciseId);
    }
  }

  return assigned;
}

export function planReplacementSets(input: {
  fromExerciseId: string;
  toExerciseId: string;
  targetSets: number;
  sets: readonly SwapSetRow[];
  keepCompleted: boolean;
  weight: number | null;
}): ReplacementPlan {
  if (!input.fromExerciseId || !input.toExerciseId || input.fromExerciseId === input.toExerciseId) {
    return { ok: false, error: 'Choose a different exercise to swap in.' };
  }

  const fromSets = input.sets.filter((row) => row.exerciseId === input.fromExerciseId);
  const completed = fromSets.filter((row) => row.isCompleted);
  const incomplete = fromSets.filter((row) => !row.isCompleted);

  if (completed.length > 0 && !input.keepCompleted) {
    return {
      ok: false,
      error: 'You already logged sets for this exercise. Nothing was changed.',
    };
  }

  const remainingCount =
    completed.length > 0
      ? Math.max(input.targetSets - completed.length, incomplete.length, 0)
      : Math.max(input.targetSets, incomplete.length, 1);
  const targetNumbers = new Set(
    input.sets
      .filter((row) => row.exerciseId === input.toExerciseId)
      .map((row) => row.setNumber),
  );
  const desiredNumbers = Array.from({ length: remainingCount }, (_, index) => index + 1);

  if (desiredNumbers.some((setNumber) => targetNumbers.has(setNumber))) {
    return {
      ok: false,
      error:
        'That exercise already has sets in this workout. Completed and incomplete sets were left unchanged.',
    };
  }

  return {
    ok: true,
    deleteIds: incomplete.map((row) => row.id),
    insertCount: remainingCount,
    weight: input.weight,
  };
}

function suggestionScore(exercise: PickerExercise, current: PickerExercise): number {
  let score = 0;
  const category = normalize(exercise.category);
  const currentCategory = normalize(current.category);

  if (category && currentCategory && category === currentCategory) {
    score += 100;
  }

  const family = equipmentFamily(exercise.equipmentType);
  const currentFamily = equipmentFamily(current.equipmentType);

  if (family !== 'other' && family === currentFamily) {
    score += 10;
  }

  return score;
}

export function exercisesForPicker<T extends PickerExercise>(input: {
  exercises: readonly T[];
  current: PickerExercise;
  query: string;
  equipmentFilter: string;
}): { exercises: T[]; showingSuggestions: boolean } {
  const needle = input.query.trim().toLowerCase();
  const equipmentFilter = input.equipmentFilter.trim().toLowerCase();
  const catalog = input.exercises.filter((exercise) => exercise.id !== input.current.id);

  const matchesEquipment = (exercise: T) => {
    if (!equipmentFilter || equipmentFilter === 'all') {
      return true;
    }

    const equipment = normalize(exercise.equipmentType);
    return equipment === equipmentFilter || equipment.includes(equipmentFilter);
  };

  const matchesQuery = (exercise: T) => {
    if (!needle) {
      return true;
    }

    return (
      exercise.name.toLowerCase().includes(needle) ||
      exercise.category.toLowerCase().includes(needle) ||
      normalize(exercise.equipmentType).includes(needle)
    );
  };

  const ranked = catalog
    .filter((exercise) => matchesEquipment(exercise) && matchesQuery(exercise))
    .sort((left, right) => {
      const scoreDelta = suggestionScore(right, input.current) - suggestionScore(left, input.current);

      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return left.name.localeCompare(right.name);
    });

  if (needle) {
    return { exercises: ranked, showingSuggestions: false };
  }

  const suggestions = ranked.filter((exercise) => suggestionScore(exercise, input.current) >= 100);

  if (suggestions.length > 0) {
    return { exercises: suggestions, showingSuggestions: true };
  }

  return { exercises: ranked, showingSuggestions: false };
}

export function matchCatalogExercise<T extends { id: string; name: string }>(
  exercises: readonly T[],
  name: string,
): T | null {
  const needle = name.trim().toLowerCase();

  if (!needle) {
    return null;
  }

  return exercises.find((exercise) => exercise.name.trim().toLowerCase() === needle) ?? null;
}
