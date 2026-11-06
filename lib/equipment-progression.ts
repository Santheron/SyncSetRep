import { recommendedWeightIncreaseLb } from './weight-increase.ts';
import {
  exerciseBaseName,
  type EquipmentKind,
} from './import/equipment-targets.ts';

// Linked equipment suggestions. This module does not write a routine or a workout.

export type LinkedHistorySet = {
  setNumber: number;
  weight: number | null;
  reps: number | null;
  isCompleted: boolean;
};

export type LinkedHistorySession = {
  equipment: EquipmentKind;
  finishedAt: string;
  sets: readonly LinkedHistorySet[];
};

export type LinkedSuggestion = {
  suggestedWeight: number | null;
  unit: 'lb' | null;
  incrementLb: number | null;
  reason: string;
};

type UniformWork = {
  equipment: EquipmentKind;
  finishedAt: string;
  sets: number;
  reps: number;
  weight: number;
};

export function suggestLinkedEquipmentProgress(input: {
  exerciseName: string;
  selectedEquipment: EquipmentKind;
  targetSets: number;
  category?: string | null;
  exerciseType?: string | null;
  incrementLb?: number | null;
  history: readonly LinkedHistorySession[];
}): LinkedSuggestion {
  const base = exerciseBaseName(input.exerciseName).trim() || input.exerciseName.trim() || 'exercise';
  const selectedLabel = `${title(input.selectedEquipment)} ${base}`;
  if (input.selectedEquipment === 'bodyweight') {
    return {
      suggestedWeight: null,
      unit: null,
      incrementLb: null,
      reason: `${selectedLabel} stays on its own history. No load was copied from another equipment.`,
    };
  }

  const uniform = input.history
    .map((session) => uniformWork(session, input.targetSets))
    .filter((session): session is UniformWork => session != null)
    .sort((left, right) => left.finishedAt.localeCompare(right.finishedAt));

  const improvement = latestImprovement(
    uniform.filter((session) => session.equipment !== input.selectedEquipment),
  );
  if (!improvement) {
    return {
      suggestedWeight: null,
      unit: null,
      incrementLb: null,
      reason: `No linked equipment improved at the same sets and reps. ${selectedLabel} was left unchanged.`,
    };
  }

  const selected = [...uniform]
    .reverse()
    .find(
      (session) =>
        session.equipment === input.selectedEquipment &&
        session.sets === improvement.newer.sets &&
        session.reps === improvement.newer.reps,
    );
  const otherLabel = `${title(improvement.newer.equipment)} ${base}`;
  const improved = `${otherLabel} improved from ${formatLb(improvement.older.weight)} lb to ${formatLb(improvement.newer.weight)} lb at ${improvement.newer.sets} sets of ${improvement.newer.reps} reps.`;
  if (!selected) {
    return {
      suggestedWeight: null,
      unit: null,
      incrementLb: null,
      reason: `${improved} ${selectedLabel} has no completed weight at that same work, so no ${input.selectedEquipment} number was taken from the ${improvement.newer.equipment}.`,
    };
  }

  const increment =
    input.incrementLb != null && input.incrementLb > 0
      ? input.incrementLb
      : recommendedWeightIncreaseLb({
          name: input.exerciseName,
          category: input.category,
          exerciseType: input.exerciseType,
        });
  const suggested = roundWeight(selected.weight + increment);
  if (suggested > 2000) {
    return {
      suggestedWeight: null,
      unit: null,
      incrementLb: increment,
      reason: `${improved} The next ${input.selectedEquipment} step would pass 2000 lb, so no weight was suggested.`,
    };
  }
  const perDumbbell = input.selectedEquipment === 'dumbbell' ? ' per dumbbell' : '';
  const delta = roundWeight(improvement.newer.weight - improvement.older.weight);
  return {
    suggestedWeight: suggested,
    unit: 'lb',
    incrementLb: increment,
    reason: `${improved} ${selectedLabel} stays on its own history. The next ${input.selectedEquipment} step is ${formatLb(increment)} lb${perDumbbell}, from ${formatLb(selected.weight)} lb to ${formatLb(suggested)} lb${perDumbbell}. This is not a ${formatLb(delta)} lb copy of the ${improvement.newer.equipment} change.`,
  };
}

function latestImprovement(sessions: readonly UniformWork[]): { older: UniformWork; newer: UniformWork } | null {
  const byEquipment = new Map<EquipmentKind, UniformWork[]>();
  for (const session of sessions) {
    const list = byEquipment.get(session.equipment) ?? [];
    list.push(session);
    byEquipment.set(session.equipment, list);
  }
  let chosen: { older: UniformWork; newer: UniformWork } | null = null;
  for (const list of byEquipment.values()) {
    const ordered = [...list].sort((left, right) => left.finishedAt.localeCompare(right.finishedAt));
    for (let index = 1; index < ordered.length; index += 1) {
      const older = ordered[index - 1];
      const newer = ordered[index];
      if (!older || !newer) {
        continue;
      }
      if (older.sets !== newer.sets || older.reps !== newer.reps || newer.weight <= older.weight) {
        continue;
      }
      if (!chosen || newer.finishedAt > chosen.newer.finishedAt) {
        chosen = { older, newer };
      }
    }
  }
  return chosen;
}

function uniformWork(session: LinkedHistorySession, targetSets: number): UniformWork | null {
  const completed = session.sets.filter(
    (set) => set.isCompleted && typeof set.reps === 'number' && set.reps > 0,
  );
  const used =
    targetSets > 0
      ? completed.filter((set) => set.setNumber >= 1 && set.setNumber <= targetSets)
      : completed;
  if (targetSets > 0 && used.length !== targetSets) {
    return null;
  }
  if (used.length === 0) {
    return null;
  }
  const reps = used[0]?.reps;
  const weight = used[0]?.weight;
  if (typeof reps !== 'number' || typeof weight !== 'number' || weight <= 0) {
    return null;
  }
  if (!used.every((set) => set.reps === reps && set.weight === weight)) {
    return null;
  }
  return {
    equipment: session.equipment,
    finishedAt: session.finishedAt,
    sets: used.length,
    reps,
    weight,
  };
}

function title(equipment: EquipmentKind): string {
  return equipment.charAt(0).toUpperCase() + equipment.slice(1);
}

function formatLb(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(2)));
}

function roundWeight(value: number): number {
  return Number(value.toFixed(2));
}
