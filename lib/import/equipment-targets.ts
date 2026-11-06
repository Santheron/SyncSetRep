import {
  calculatePlates,
  DEFAULT_AVAILABLE_PLATES_LB,
  DEFAULT_BAR_WEIGHT_LB,
  formatPlate,
  formatPlatesPerSide,
} from '../plate-calculator.ts';
import { MAX_EXERCISES, MAX_EXERCISES_PER_DAY, SCHEMA_MAX_DAYS, WEIGHT_MAX, WEIGHT_MIN } from './limits.ts';

// Equipment-specific planned weights. This module does not call a database.

export const EQUIPMENT_TARGET_KINDS = ['barbell', 'machine', 'dumbbell', 'cable', 'bodyweight'] as const;

export type EquipmentKind = (typeof EQUIPMENT_TARGET_KINDS)[number];

export type EquipmentTarget = {
  equipment: EquipmentKind;
  weight: number | null;
  unit: 'lb' | 'kg' | null;
  variationExerciseId?: string | null;
};

export type PlateSetup = {
  barWeightLb: number;
  platesLb: number[];
};

export const STANDARD_PLATE_SETUP: PlateSetup = {
  barWeightLb: DEFAULT_BAR_WEIGHT_LB,
  platesLb: [...DEFAULT_AVAILABLE_PLATES_LB],
};

export const MIXED_UNIT_MESSAGE =
  'Use one unit for this exercise. Pounds and kilograms were both present. Nothing was guessed.';

export const EQUIPMENT_WEIGHT_MESSAGE =
  'Name the equipment for each weight, such as 155 (80 machine). Nothing was guessed.';

export const EQUIPMENT_RANGE_MESSAGE = 'Enter a weight from 0 through 2000, or leave it blank.';

export const PLATE_SETUP_MESSAGE =
  'Enter a bar weight from 0 through 2000 and up to 12 plate sizes greater than 0.';

export type ParsedEquipmentText = {
  ok: true;
  plannedWeight: number | null;
  unit: 'lb' | 'kg' | null;
  targets: EquipmentTarget[] | null;
} | {
  ok: false;
  error: string;
};

const KIND_WORD =
  /\b(barbells?|dumbbells?|machines?|cables?|bodyweight|body\s*weight|bb|db|bw)\b/i;

const VARIATION_SUFFIX = /\s*\((barbell|machine|dumbbell|cable|bodyweight)\)\s*$/i;

type Segment = {
  weight: number | null;
  unit: 'lb' | 'kg' | null;
  equipment: EquipmentKind | null;
};

export function exerciseBaseName(name: string): string {
  return name.replace(VARIATION_SUFFIX, '').trim();
}

export function variationExerciseName(original: string, equipment: EquipmentKind): string {
  const base = exerciseBaseName(original).trim();
  return `${base} (${equipment})`;
}

export function equipmentKindFromName(name: string): EquipmentKind | null {
  const match = VARIATION_SUFFIX.exec(name.trim());
  if (!match) {
    return null;
  }
  return kindFromToken(match[1]);
}

export function equipmentKindFromType(value: string | null | undefined): EquipmentKind | null {
  return kindFromToken(value ?? '');
}

export function formatEquipmentTarget(target: EquipmentTarget): string {
  if (target.weight == null) {
    return target.equipment === 'bodyweight' ? 'Bodyweight' : labelFor(target.equipment);
  }
  const amount = formatAmount(target.weight, target.unit);
  if (target.equipment === 'dumbbell') {
    return `${amount} per dumbbell`;
  }
  if (target.equipment === 'bodyweight') {
    return `${amount} bodyweight`;
  }
  return `${amount} ${target.equipment}`;
}

export function formatEquipmentTargetList(targets: readonly EquipmentTarget[] | null | undefined): string {
  if (!targets || targets.length === 0) {
    return '';
  }
  return `${targets.map((target) => formatEquipmentTarget(target)).join('. ')}.`;
}

export function primaryPlannedWeight(targets: readonly EquipmentTarget[] | null | undefined): {
  weight: number | null;
  unit: 'lb' | 'kg' | null;
} {
  if (!targets || targets.length === 0) {
    return { weight: null, unit: null };
  }
  const barbell = targets.find((target) => target.equipment === 'barbell' && target.weight != null);
  const chosen = barbell ?? targets.find((target) => target.weight != null);
  return chosen ? { weight: chosen.weight, unit: chosen.unit } : { weight: null, unit: null };
}

export function parseEquipmentWeightText(value: string): ParsedEquipmentText {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (trimmed === '') {
    return { ok: true, plannedWeight: null, unit: null, targets: null };
  }
  const unitError = mixedUnit(trimmed);
  if (unitError) {
    return { ok: false, error: unitError };
  }
  if (/^\d+(?:\.\d+)?(?:\s*(?:lb|lbs|kg|kgs))?$/i.test(trimmed)) {
    const bare = readSegment(trimmed);
    if (bare.weight == null || !weightInRange(bare.weight)) {
      return { ok: false, error: EQUIPMENT_RANGE_MESSAGE };
    }
    return { ok: true, plannedWeight: bare.weight, unit: bare.unit, targets: null };
  }

  const pieces = trimmed
    .split(/[()]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '');
  const segments = pieces.map(readSegment);
  if (segments.some((segment) => segment.weight != null && !weightInRange(segment.weight))) {
    return { ok: false, error: EQUIPMENT_RANGE_MESSAGE };
  }
  const bare = segments.filter((segment) => segment.equipment == null && segment.weight != null);
  const named = segments.filter((segment) => segment.equipment != null);
  if (named.length === 0) {
    return { ok: false, error: EQUIPMENT_WEIGHT_MESSAGE };
  }
  if (bare.length > 1) {
    return { ok: false, error: EQUIPMENT_WEIGHT_MESSAGE };
  }

  const targets: EquipmentTarget[] = [];
  const globalUnit = soleUnit(trimmed);
  if (bare.length === 1 && named.some((segment) => segment.equipment !== 'barbell')) {
    const added = pushTarget(targets, {
      equipment: 'barbell',
      weight: bare[0]?.weight ?? null,
      unit: bare[0]?.unit ?? globalUnit,
    });
    if (!added.ok) {
      return added;
    }
  } else if (bare.length === 1) {
    return { ok: false, error: EQUIPMENT_WEIGHT_MESSAGE };
  }

  for (const segment of named) {
    if (segment.equipment == null) {
      continue;
    }
    const added = pushTarget(targets, {
      equipment: segment.equipment,
      weight: segment.weight,
      unit: segment.unit ?? (segment.weight == null ? null : globalUnit),
    });
    if (!added.ok) {
      return added;
    }
  }

  if (targets.length === 0) {
    return { ok: true, plannedWeight: null, unit: null, targets: null };
  }
  const primary = primaryPlannedWeight(targets);
  return { ok: true, plannedWeight: primary.weight, unit: primary.unit, targets };
}

export function targetsFromWeightAndNotes(
  weight: number | null | undefined,
  notes: string | null | undefined,
): EquipmentTarget[] | null {
  const clause = notes?.match(/\(([^)]{1,40})\)/)?.[1]?.trim() ?? '';
  if (clause !== '' && KIND_WORD.test(clause)) {
    KIND_WORD.lastIndex = 0;
    const text = weight == null ? clause : `${weight} (${clause})`;
    const parsed = parseEquipmentWeightText(text);
    return parsed.ok ? parsed.targets : null;
  }
  KIND_WORD.lastIndex = 0;
  if (weight == null && notes && KIND_WORD.test(notes) && notes.trim().length <= 40) {
    KIND_WORD.lastIndex = 0;
    const parsed = parseEquipmentWeightText(notes);
    return parsed.ok ? parsed.targets : null;
  }
  KIND_WORD.lastIndex = 0;
  return null;
}

const SAVED_PROGRAM_ID_LIMIT = 9223372036854775807n;

export type SavedEquipmentTargetRow = {
  dayOrder: number;
  exerciseOrder: number;
  programExerciseId: string | null;
  targets: EquipmentTarget[];
};

export type LocatedProgramExercise = {
  dayOrder: number;
  exerciseOrder: number;
  programExerciseId: string;
};

export function acceptedSavedEquipmentTargetRows(value: unknown): SavedEquipmentTargetRow[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EXERCISES) {
    return null;
  }
  const rows: SavedEquipmentTargetRow[] = [];
  const slots = new Set<string>();
  const ids = new Set<string>();
  let sawId = false;
  let sawOrderOnly = false;
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const record = item as Record<string, unknown>;
    const dayOrder = readOrder(record.dayOrder, SCHEMA_MAX_DAYS);
    const exerciseOrder = readOrder(record.exerciseOrder, MAX_EXERCISES_PER_DAY);
    if (dayOrder == null || exerciseOrder == null) {
      return null;
    }
    const slot = `${dayOrder}:${exerciseOrder}`;
    if (slots.has(slot)) {
      return null;
    }
    slots.add(slot);
    const programExerciseId = readSavedExerciseId(record.programExerciseId);
    if (programExerciseId === null) {
      return null;
    }
    if (programExerciseId) {
      if (ids.has(programExerciseId)) {
        return null;
      }
      ids.add(programExerciseId);
      sawId = true;
    } else {
      sawOrderOnly = true;
    }
    if (sawId && sawOrderOnly) {
      return null;
    }
    const targets = sanitizeEquipmentTargets(record.targets);
    if (!targets) {
      return null;
    }
    rows.push({ dayOrder, exerciseOrder, programExerciseId: programExerciseId ?? null, targets });
  }
  return rows;
}

export function freezeEquipmentTargetRows(
  days: readonly { exercises: readonly { equipmentTargets?: unknown }[] }[],
): SavedEquipmentTargetRow[] {
  if (days.length > SCHEMA_MAX_DAYS) {
    return [];
  }
  const rows: SavedEquipmentTargetRow[] = [];
  for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
    const exercises = days[dayIndex]?.exercises ?? [];
    if (exercises.length > MAX_EXERCISES_PER_DAY) {
      return [];
    }
    for (let exerciseIndex = 0; exerciseIndex < exercises.length; exerciseIndex += 1) {
      const targets = sanitizeEquipmentTargets(exercises[exerciseIndex]?.equipmentTargets);
      if (!targets) {
        continue;
      }
      rows.push({
        dayOrder: dayIndex + 1,
        exerciseOrder: exerciseIndex + 1,
        programExerciseId: null,
        targets,
      });
    }
  }
  return acceptedSavedEquipmentTargetRows(rows) ?? [];
}

export function savedRowsWithExerciseIds(
  rows: readonly SavedEquipmentTargetRow[],
  located: readonly LocatedProgramExercise[] | null,
): SavedEquipmentTargetRow[] {
  const orderOnly = acceptedSavedEquipmentTargetRows(
    rows.map((row) => ({
      dayOrder: row.dayOrder,
      exerciseOrder: row.exerciseOrder,
      programExerciseId: null,
      targets: row.targets,
    })),
  );
  if (!orderOnly) {
    return [];
  }
  if (!located || located.length === 0) {
    return orderOnly;
  }
  const bySlot = new Map<string, string>();
  for (const item of located) {
    const dayOrder = readOrder(item.dayOrder, SCHEMA_MAX_DAYS);
    const exerciseOrder = readOrder(item.exerciseOrder, MAX_EXERCISES_PER_DAY);
    const programExerciseId = readSavedExerciseId(item.programExerciseId);
    if (dayOrder == null || exerciseOrder == null || !programExerciseId) {
      return orderOnly;
    }
    const slot = `${dayOrder}:${exerciseOrder}`;
    if (bySlot.has(slot)) {
      return orderOnly;
    }
    bySlot.set(slot, programExerciseId);
  }
  const used = new Set<string>();
  const identified: SavedEquipmentTargetRow[] = [];
  for (const row of orderOnly) {
    const programExerciseId = bySlot.get(`${row.dayOrder}:${row.exerciseOrder}`);
    if (!programExerciseId || used.has(programExerciseId)) {
      return orderOnly;
    }
    used.add(programExerciseId);
    identified.push({
      ...row,
      programExerciseId,
      targets: row.targets.map((target) => ({ ...target })),
    });
  }
  return acceptedSavedEquipmentTargetRows(identified) ?? orderOnly;
}

export function sanitizeEquipmentTargets(value: unknown): EquipmentTarget[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > EQUIPMENT_TARGET_KINDS.length) {
    return null;
  }
  const targets: EquipmentTarget[] = [];
  const seen = new Set<EquipmentKind>();
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const record = item as Record<string, unknown>;
    const equipment = kindFromToken(typeof record.equipment === 'string' ? record.equipment : '');
    if (!equipment || seen.has(equipment)) {
      return null;
    }
    const weight = record.weight == null ? null : record.weight;
    if (weight != null && (typeof weight !== 'number' || !weightInRange(weight))) {
      return null;
    }
    const unit = record.unit == null ? null : record.unit;
    if (unit != null && unit !== 'lb' && unit !== 'kg') {
      return null;
    }
    if (unit != null && weight == null) {
      return null;
    }
    const variation = readVariationId(record);
    if (variation === null) {
      return null;
    }
    seen.add(equipment);
    targets.push({
      equipment,
      weight,
      unit,
      ...(variation ? { variationExerciseId: variation } : {}),
    });
  }
  return targets;
}

export function mergeEquipmentTargets(
  current: readonly EquipmentTarget[] | null | undefined,
  incoming: readonly EquipmentTarget[] | null | undefined,
): { ok: true; targets: EquipmentTarget[] | null } | { ok: false } {
  const left = current ?? [];
  const right = incoming ?? [];
  if (left.length === 0 && right.length === 0) {
    return { ok: true, targets: null };
  }
  const merged = left.map((target) => ({ ...target }));
  for (const target of right) {
    const existing = merged.find((item) => item.equipment === target.equipment);
    if (!existing) {
      merged.push({ ...target });
      continue;
    }
    if (existing.weight !== target.weight || existing.unit !== target.unit) {
      return { ok: false };
    }
  }
  return { ok: true, targets: merged.length > 0 ? merged : null };
}

export function replaceEquipmentWeight(
  targets: readonly EquipmentTarget[] | null | undefined,
  equipment: EquipmentKind,
  weight: number,
  unit: 'lb' | 'kg' | null,
): EquipmentTarget[] {
  const next = (targets ?? [])
    .filter((target) => target.equipment !== equipment)
    .map((target) => ({ ...target }));
  next.push({ equipment, weight, unit });
  return EQUIPMENT_TARGET_KINDS.flatMap((kind) => next.filter((target) => target.equipment === kind));
}

export function parsePlateSetup(barText: string, platesText: string): { ok: true; setup: PlateSetup } | { ok: false; error: string } {
  const barSource = barText.trim() === '' ? String(STANDARD_PLATE_SETUP.barWeightLb) : barText.trim();
  const bar = Number(barSource);
  if (!Number.isFinite(bar) || bar < 0 || bar > WEIGHT_MAX) {
    return { ok: false, error: PLATE_SETUP_MESSAGE };
  }
  const plateSource = platesText.trim() === '' ? STANDARD_PLATE_SETUP.platesLb.join(', ') : platesText;
  const plates = plateSource
    .split(/[, ]+/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
    .map((item) => Number(item));
  if (plates.length === 0 || plates.length > 12 || plates.some((plate) => !Number.isFinite(plate) || plate <= 0 || plate > 100)) {
    return { ok: false, error: PLATE_SETUP_MESSAGE };
  }
  const unique = [...new Set(plates)].sort((left, right) => right - left);
  return { ok: true, setup: { barWeightLb: bar, platesLb: unique } };
}

export function describePlateLoad(weight: number, setup: PlateSetup = STANDARD_PLATE_SETUP): string {
  const result = calculatePlates(weight, setup.barWeightLb, setup.platesLb);
  if (weight < setup.barWeightLb) {
    return `Total ${formatPlate(weight)} lb is below the ${formatPlate(setup.barWeightLb)} lb bar.`;
  }
  const plates = formatPlatesPerSide(result.platesPerSide);
  return plates === 'Empty bar'
    ? `Empty bar. Bar weight ${formatPlate(result.barWeight)} lb.`
    : `${plates} per side on a ${formatPlate(result.barWeight)} lb bar.`;
}

function readOrder(value: unknown, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    return null;
  }
  return value;
}

function readSavedExerciseId(value: unknown): string | null | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value)) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed >= 1n && parsed <= SAVED_PROGRAM_ID_LIMIT ? value : null;
  } catch {
    return null;
  }
}

function readVariationId(record: Record<string, unknown>): string | null | undefined {
  const raw = record.variationExerciseId ?? record.variation_exercise_id;
  if (raw == null) {
    return undefined;
  }
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) {
    return String(raw);
  }
  if (typeof raw === 'string' && /^[1-9][0-9]{0,18}$/.test(raw)) {
    return raw;
  }
  return null;
}

function pushTarget(
  targets: EquipmentTarget[],
  target: EquipmentTarget,
): { ok: true } | { ok: false; error: string } {
  const existing = targets.find((item) => item.equipment === target.equipment);
  if (!existing) {
    targets.push(target);
    return { ok: true };
  }
  if (existing.weight !== target.weight || existing.unit !== target.unit) {
    return { ok: false, error: EQUIPMENT_WEIGHT_MESSAGE };
  }
  return { ok: true };
}

function readSegment(value: string): Segment {
  const kindMatch = KIND_WORD.exec(value);
  KIND_WORD.lastIndex = 0;
  const numberMatch = /(\d+(?:\.\d+)?)/.exec(value);
  const unit = unitIn(value);
  const weight = numberMatch ? Number(numberMatch[1]) : null;
  return {
    weight: weight != null && Number.isFinite(weight) ? weight : null,
    unit,
    equipment: kindMatch ? kindFromToken(kindMatch[1]) : null,
  };
}

function kindFromToken(token: string): EquipmentKind | null {
  const text = token.toLowerCase().replace(/\s+/g, '');
  if (text === 'bb' || text.startsWith('barbell')) {
    return 'barbell';
  }
  if (text === 'db' || text.startsWith('dumbbell')) {
    return 'dumbbell';
  }
  if (text.startsWith('machine')) {
    return 'machine';
  }
  if (text.startsWith('cable')) {
    return 'cable';
  }
  if (text === 'bw' || text.startsWith('bodyweight')) {
    return 'bodyweight';
  }
  return null;
}

function unitIn(value: string): 'lb' | 'kg' | null {
  if (/\b(kg|kgs)\b/i.test(value)) {
    return 'kg';
  }
  if (/\b(lb|lbs)\b/i.test(value)) {
    return 'lb';
  }
  return null;
}

function mixedUnit(value: string): string | null {
  const pounds = /\b(lb|lbs)\b/i.test(value);
  const kilos = /\b(kg|kgs)\b/i.test(value);
  return pounds && kilos ? MIXED_UNIT_MESSAGE : null;
}

function soleUnit(value: string): 'lb' | 'kg' | null {
  return unitIn(value);
}

function weightInRange(value: number): boolean {
  return Number.isFinite(value) && value >= WEIGHT_MIN && value <= WEIGHT_MAX;
}

function formatAmount(weight: number, unit: 'lb' | 'kg' | null): string {
  const shown = formatPlate(weight);
  if (unit === 'lb' || unit === 'kg') {
    return `${shown} ${unit}`;
  }
  return shown;
}

function labelFor(equipment: EquipmentKind): string {
  return equipment.charAt(0).toUpperCase() + equipment.slice(1);
}
