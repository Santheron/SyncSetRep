export const DEFAULT_BAR_WEIGHT_LB = 45;

export const DEFAULT_AVAILABLE_PLATES_LB = [45, 35, 25, 10, 5, 2.5] as const;

export type PlateCalculation = {
  requestedWeight: number;
  actualWeight: number;
  barWeight: number;
  weightPerSide: number;
  platesPerSide: number[];
  isExact: boolean;
};

const TENTHS = 10;

export function calculatePlates(
  targetWeight: number | string | null | undefined,
  barWeight: number = DEFAULT_BAR_WEIGHT_LB,
  availablePlates: readonly number[] = DEFAULT_AVAILABLE_PLATES_LB,
): PlateCalculation {
  console.log('[PlateCalculator] input', {
    targetWeight,
    targetType: typeof targetWeight,
    barWeight,
  });

  const requestedWeight = cleanWeight(targetWeight);
  const safeBarWeight = Math.max(0, cleanWeight(barWeight));
  const plates = normalizePlates(availablePlates);

  if (plates.length === 0) {
    const actualWeight = requestedWeight <= safeBarWeight ? safeBarWeight : requestedWeight;
    return {
      requestedWeight,
      actualWeight,
      barWeight: safeBarWeight,
      weightPerSide: 0,
      platesPerSide: [],
      isExact: nearlyEqual(requestedWeight, actualWeight),
    };
  }

  const smallestPlate = plates[plates.length - 1];
  const totalIncrement = smallestPlate * 2;
  const remainder = Math.max(0, requestedWeight - safeBarWeight);
  const steps = Math.round(remainder / totalIncrement);
  const actualWeight = cleanWeight(safeBarWeight + steps * totalIncrement);
  const weightPerSide = cleanWeight(Math.max(0, (actualWeight - safeBarWeight) / 2));
  const platesPerSide = greedyPlatesPerSide(weightPerSide, plates);

  return {
    requestedWeight,
    actualWeight,
    barWeight: safeBarWeight,
    weightPerSide,
    platesPerSide,
    isExact: nearlyEqual(requestedWeight, actualWeight),
  };
}

export function formatPlatesPerSide(platesPerSide: number[]): string {
  if (platesPerSide.length === 0) {
    return 'Empty bar';
  }

  return platesPerSide.map(formatPlate).join(' + ');
}

export function formatPlate(weight: number | string): string {
  const numeric = typeof weight === 'bigint' ? Number(weight) : Number(weight);

  if (!Number.isFinite(numeric)) {
    return '0';
  }

  if (Number.isInteger(numeric)) {
    return String(numeric);
  }

  return String(Number(numeric.toFixed(2)));
}

export function formatPlatesPerSideLine(platesPerSide: number[]): string {
  const plates = formatPlatesPerSide(platesPerSide);

  if (plates === 'Empty bar') {
    return plates;
  }

  return `${plates} / SIDE`;
}

export type BarbellExerciseInput = {
  name?: string | null;
  equipmentType?: string | null;
};

export function isEzBarExercise(input: BarbellExerciseInput): boolean {
  const equipment = normalizeText(input.equipmentType);
  const name = normalizeText(input.name);

  return hasEzBarToken(equipment) || hasEzBarToken(name);
}

export function isBarbellExercise(input: BarbellExerciseInput): boolean {
  if (isEzBarExercise(input)) {
    return false;
  }

  if (isExcludedNonBarbell(input)) {
    return false;
  }

  const equipment = normalizeText(input.equipmentType);

  if (equipmentIndicatesOlympicBarbell(equipment)) {
    return true;
  }

  if (equipmentIndicatesNonBarbell(equipment)) {
    return false;
  }

  return nameIndicatesOlympicBarbell(normalizeText(input.name));
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function hasEzBarToken(value: string): boolean {
  return (
    /\bez[\s-]?bar\b/.test(value) ||
    /\bezbar\b/.test(value) ||
    /\bez\s+curl\b/.test(value)
  );
}

function equipmentIndicatesOlympicBarbell(equipment: string): boolean {
  if (!equipment || hasEzBarToken(equipment)) {
    return false;
  }

  if (
    equipment === 'barbell' ||
    equipment.includes('barbell') ||
    equipment === 'olympic bar' ||
    equipment === 'straight bar' ||
    equipment === 'bar'
  ) {
    return true;
  }

  return /\bolympic\b/.test(equipment) && /\bbar\b/.test(equipment);
}

function equipmentIndicatesNonBarbell(equipment: string): boolean {
  if (!equipment) {
    return false;
  }

  return (
    equipment.includes('dumbbell') ||
    equipment === 'db' ||
    equipment.includes('cable') ||
    equipment.includes('machine') ||
    equipment.includes('bodyweight') ||
    equipment.includes('kettlebell') ||
    equipment.includes('band')
  );
}

function isExcludedNonBarbell(input: BarbellExerciseInput): boolean {
  const equipment = normalizeText(input.equipmentType);
  const name = normalizeText(input.name);

  if (equipmentIndicatesNonBarbell(equipment)) {
    return true;
  }

  return (
    /pull[-\s]?ups?/.test(name) ||
    /chin[-\s]?ups?/.test(name) ||
    /\bdips?\b/.test(name) ||
    name.includes('dumbbell') ||
    /\bdb\b/.test(name) ||
    name.includes('cable') ||
    name.includes('machine')
  );
}

function nameIndicatesOlympicBarbell(name: string): boolean {
  if (!name || hasEzBarToken(name)) {
    return false;
  }

  if (name.includes('barbell')) {
    return true;
  }

  if (/\bromanian deadlift\b/.test(name) || /\brdl\b/.test(name)) {
    return true;
  }

  return false;
}

export function verifyPlateCalculatorExamples(): string[] {
  const failures: string[] = [];

  const exactCases: Array<{
    requested: number;
    plates: number[];
    label: string;
  }> = [
    { requested: 45, plates: [], label: 'Empty bar' },
    { requested: 55, plates: [5], label: '5 per side' },
    { requested: 65, plates: [10], label: '10 per side' },
    { requested: 95, plates: [25], label: '25 per side' },
    { requested: 115, plates: [35], label: '35 per side' },
    { requested: 135, plates: [45], label: '45 per side' },
    { requested: 155, plates: [45, 10], label: '45 + 10 per side' },
    { requested: 185, plates: [45, 25], label: '45 + 25 per side' },
    { requested: 205, plates: [45, 35], label: '45 + 35 per side' },
    { requested: 225, plates: [45, 45], label: '45 + 45 per side' },
    { requested: 245, plates: [45, 45, 10], label: '45 + 45 + 10 per side' },
    { requested: 315, plates: [45, 45, 45], label: '45 + 45 + 45 per side' },
  ];

  for (const example of exactCases) {
    const result = calculatePlates(example.requested);

    if (!result.isExact) {
      failures.push(`${example.requested} lb should be exact`);
    }

    if (!nearlyEqual(result.actualWeight, example.requested)) {
      failures.push(
        `${example.requested} lb actualWeight was ${result.actualWeight}`,
      );
    }

    if (!samePlates(result.platesPerSide, example.plates)) {
      failures.push(
        `${example.requested} lb expected ${example.label}, got ${formatPlatesPerSide(result.platesPerSide)}`,
      );
    }
  }

  const inexact = calculatePlates(137);

  if (inexact.isExact) {
    failures.push('137 lb should not be exact');
  }

  if (!nearlyEqual(inexact.actualWeight, 135)) {
    failures.push(`137 lb nearest should be 135, got ${inexact.actualWeight}`);
  }

  if (!samePlates(inexact.platesPerSide, [45])) {
    failures.push(
      `137 lb should be 45 per side, got ${formatPlatesPerSide(inexact.platesPerSide)}`,
    );
  }

  const barbellCases: Array<{
    name: string;
    equipmentType?: string | null;
    expected: boolean;
  }> = [
    { name: 'Incline Barbell Bench Press', equipmentType: null, expected: true },
    { name: 'Incline Barbell Bench Press', equipmentType: 'Olympic Barbell', expected: true },
    { name: 'Barbell Squat', equipmentType: '', expected: true },
    { name: 'Romanian Deadlift', equipmentType: null, expected: true },
    { name: 'Overhead Press', equipmentType: 'barbell', expected: true },
    { name: 'Overhead Press', equipmentType: null, expected: false },
    { name: 'EZ-Bar Curl', equipmentType: 'barbell', expected: false },
    { name: 'Pull-Up', equipmentType: null, expected: false },
    { name: 'Cable Lateral Raise', equipmentType: 'cable', expected: false },
    { name: 'Incline Dumbbell Press', equipmentType: 'dumbbell', expected: false },
    { name: 'Dip', equipmentType: 'bodyweight', expected: false },
  ];

  for (const example of barbellCases) {
    const actual = isBarbellExercise(example);

    if (actual !== example.expected) {
      failures.push(
        `${example.name} (${example.equipmentType ?? 'no equipment'}) expected ${example.expected}, got ${actual}`,
      );
    }
  }

  return failures;
}

function greedyPlatesPerSide(weightPerSide: number, plates: number[]): number[] {
  let remaining = Math.round(weightPerSide * TENTHS);
  const loaded: number[] = [];

  for (const plate of plates) {
    const plateUnits = Math.round(plate * TENTHS);

    while (remaining >= plateUnits) {
      loaded.push(plate);
      remaining -= plateUnits;
    }
  }

  return loaded;
}

function normalizePlates(availablePlates: readonly number[]): number[] {
  return [...availablePlates]
    .filter((plate) => Number.isFinite(plate) && plate > 0)
    .sort((a, b) => b - a);
}

function samePlates(actual: number[], expected: number[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  return actual.every((plate, index) => nearlyEqual(plate, expected[index]));
}

function cleanWeight(value: number | string | null | undefined): number {
  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Number(numeric.toFixed(4));
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.001;
}
