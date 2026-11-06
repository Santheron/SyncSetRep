// Shared load step for progression. This module does not read or write a workout.

const UPPER_INCREASE_LB = 5;
const LOWER_COMPOUND_INCREASE_LB = 10;

const LOWER_BODY = /quad|hamstring|glute|calf|\bleg\b|lower|hip|adductor|abductor/;
const LOWER_COMPOUND_NAME =
  /squat|deadlift|lunge|rdl|romanian|hip thrust|leg press|split squat|step[- ]?up|good morning/;
const ISOLATION_NAME = /curl|extension|calf|fly|raise|kickback|pushdown|lateral/;

export function recommendedWeightIncreaseLb(input: {
  name: string;
  category?: string | null;
  exerciseType?: string | null;
}): number {
  if (isLowerBodyCompound(input)) {
    return LOWER_COMPOUND_INCREASE_LB;
  }
  return UPPER_INCREASE_LB;
}

function isLowerBodyCompound(input: {
  name: string;
  category?: string | null;
  exerciseType?: string | null;
}): boolean {
  const name = input.name.trim().toLowerCase();
  const category = input.category?.trim().toLowerCase() ?? '';
  const exerciseType = input.exerciseType?.trim().toLowerCase() ?? '';
  if (ISOLATION_NAME.test(name)) {
    return false;
  }
  const looksLower = LOWER_BODY.test(category) || LOWER_BODY.test(name) || LOWER_COMPOUND_NAME.test(name);
  const looksCompound =
    exerciseType.includes('compound') || LOWER_COMPOUND_NAME.test(name) || exerciseType.length === 0;
  return looksLower && looksCompound;
}
