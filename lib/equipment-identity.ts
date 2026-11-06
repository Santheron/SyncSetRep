import { normExerciseName } from './import/normalize-exercise-name.ts';
import {
  equipmentKindFromName,
  equipmentKindFromType,
  exerciseBaseName,
  variationExerciseName,
  type EquipmentKind,
  type EquipmentTarget,
} from './import/equipment-targets.ts';

// Chooses the exercise id for one equipment switch.
// It does not read or write workout history.

export type EquipmentExerciseRef = {
  id: string;
  name: string;
  equipmentType?: string | null;
};

export type EquipmentIdentityChoice = {
  action: 'stay' | 'reuse' | 'create';
  exerciseId: string | null;
  createName: string | null;
};

export function establishedEquipmentKind(name: string, equipmentType?: string | null): EquipmentKind {
  return equipmentKindFromName(name) ?? equipmentKindFromType(equipmentType) ?? 'barbell';
}

export function resolveEquipmentExercise(input: {
  selected: EquipmentKind;
  currentId: string;
  currentName: string;
  currentEquipmentType?: string | null;
  originId?: string | null;
  originName?: string | null;
  originEquipmentType?: string | null;
  targets?: readonly EquipmentTarget[] | null;
  rememberedId?: string | null;
  known?: readonly EquipmentExerciseRef[] | null;
}): EquipmentIdentityChoice {
  const currentKind = establishedEquipmentKind(input.currentName, input.currentEquipmentType);
  if (currentKind === input.selected) {
    return { action: 'stay', exerciseId: input.currentId, createName: null };
  }

  if (input.originId && input.originName) {
    const originKind = establishedEquipmentKind(input.originName, input.originEquipmentType);
    if (originKind === input.selected) {
      return { action: 'reuse', exerciseId: input.originId, createName: null };
    }
  }

  const targetId = input.targets?.find((target) => target.equipment === input.selected)?.variationExerciseId;
  if (targetId) {
    return { action: 'reuse', exerciseId: targetId, createName: null };
  }

  if (input.rememberedId) {
    return { action: 'reuse', exerciseId: input.rememberedId, createName: null };
  }

  const baseSource = input.originName?.trim() ? input.originName : input.currentName;
  const base = exerciseBaseName(baseSource);
  const expectedName = variationExerciseName(base, input.selected);
  const matches = (input.known ?? []).filter((exercise) => {
    if (!exercise.id || exercise.id === input.currentId) {
      return false;
    }
    if (normExerciseName(exercise.name) === normExerciseName(expectedName)) {
      return true;
    }
    const kind = establishedEquipmentKind(exercise.name, exercise.equipmentType);
    return kind === input.selected && normExerciseName(exerciseBaseName(exercise.name)) === normExerciseName(base);
  });
  if (matches.length > 0) {
    const originMatch = input.originId ? matches.find((exercise) => exercise.id === input.originId) : undefined;
    const chosen = originMatch ?? [...matches].sort((left, right) => compareExerciseIds(left.id, right.id))[0];
    return { action: 'reuse', exerciseId: chosen?.id ?? null, createName: null };
  }

  return { action: 'create', exerciseId: null, createName: expectedName };
}

function compareExerciseIds(left: string, right: string): number {
  if (/^[1-9][0-9]{0,18}$/.test(left) && /^[1-9][0-9]{0,18}$/.test(right)) {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    if (leftId < rightId) {
      return -1;
    }
    if (leftId > rightId) {
      return 1;
    }
    return 0;
  }
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
