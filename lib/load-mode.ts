import { formatWeight } from './warmup.ts';

// Explicit tracking for new sets. A null mode is a legacy external weight.
// Legacy numbers stay on the weight column and keep their existing label.

export type LoadMode = 'bodyweight' | 'added' | 'assisted';
export type WeightUnit = 'lb' | 'kg';

export const PERSIST_LOAD_MODE = false;

export const LOAD_MODE_SAVE_BLOCKED_MESSAGE =
  'Saving added weight and assistance stays off in this build. Nothing was saved.';

export const BODYWEIGHT_ZERO_MESSAGE =
  'Bodyweight-only sets use zero additional weight. Nothing was saved.';

export const ADDED_WEIGHT_MESSAGE = 'Enter added weight above zero. Nothing was saved.';

export const ASSISTANCE_SEPARATE_MESSAGE =
  'Enter assistance above zero. Assistance is not stored as negative weight. Nothing was saved.';

export const LOAD_MODE_INVALID_MESSAGE =
  'Choose bodyweight, added weight, or assisted tracking. Nothing was saved.';

export const TRACKING_MODE_LABELS = {
  external: 'External',
  bodyweight: 'Bodyweight',
  added: 'Added weight',
  assisted: 'Assisted',
} as const;

const MODES = new Set<LoadMode>(['bodyweight', 'added', 'assisted']);

export function isLoadMode(value: unknown): value is LoadMode {
  return typeof value === 'string' && MODES.has(value as LoadMode);
}

export function trackingModeLabel(mode: LoadMode | null | undefined): string {
  if (mode === 'bodyweight') {
    return TRACKING_MODE_LABELS.bodyweight;
  }
  if (mode === 'added') {
    return TRACKING_MODE_LABELS.added;
  }
  if (mode === 'assisted') {
    return TRACKING_MODE_LABELS.assisted;
  }
  return TRACKING_MODE_LABELS.external;
}

export function formatLegacyLoad(weight: number | string | null): string {
  if (weight === null || weight === '') {
    return 'BW';
  }

  const numericWeight = Number(weight);

  if (!Number.isFinite(numericWeight) || numericWeight === 0) {
    return 'BW';
  }

  return `${formatWeight(numericWeight)} lb`;
}

function unitLabel(unit: WeightUnit | null | undefined): WeightUnit {
  return unit === 'kg' ? 'kg' : 'lb';
}

function amountLabel(value: number, unit: WeightUnit): string {
  return `${formatWeight(value)} ${unit}`;
}

export function formatTrackedLoad(input: {
  loadMode?: LoadMode | null;
  weight?: number | string | null;
  assistance?: number | string | null;
  weightUnit?: WeightUnit | null;
}): string {
  if (input.loadMode == null) {
    return formatLegacyLoad(input.weight ?? null);
  }

  const unit = unitLabel(input.weightUnit);
  if (input.loadMode === 'bodyweight') {
    return 'BW';
  }
  if (input.loadMode === 'added') {
    const weight = typeof input.weight === 'number' ? input.weight : Number(input.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      return 'BW +';
    }
    return `BW + ${amountLabel(weight, unit)}`;
  }
  const assistance =
    typeof input.assistance === 'number' ? input.assistance : Number(input.assistance);
  if (!Number.isFinite(assistance) || assistance <= 0) {
    return 'Assisted';
  }
  return `Assisted ${amountLabel(assistance, unit)}`;
}

export function formatHistorySetLine(input: {
  weight: number | string | null;
  reps: number | null;
  loadMode?: LoadMode | null;
  assistance?: number | null;
  weightUnit?: WeightUnit | null;
}): string {
  if (input.loadMode == null) {
    const numeric = Number(input.weight);
    if (input.weight !== null && input.weight !== '' && Number.isFinite(numeric) && numeric > 0) {
      return `${formatLegacyLoad(input.weight)} × ${input.reps ?? 0}`;
    }
    return `${input.reps ?? 0} reps`;
  }
  return `${formatTrackedLoad(input)} × ${input.reps ?? 0}`;
}

export type TrackedSetWrite =
  | {
      ok: true;
      weight: number | null;
      extra: {
        load_mode?: LoadMode;
        assistance?: number | null;
        weight_unit?: WeightUnit;
      };
    }
  | { ok: false; error: string };

function nonNegative(value: number | null | undefined): boolean {
  return value == null || (Number.isFinite(value) && value >= 0);
}

export function prepareTrackedWrite(input: {
  loadMode?: LoadMode | null;
  weight: number | null;
  assistance?: number | null;
  weightUnit?: WeightUnit | null;
  persistLoadMode?: boolean;
}): TrackedSetWrite {
  const persist = input.persistLoadMode ?? PERSIST_LOAD_MODE;
  const mode = input.loadMode ?? null;
  if (input.loadMode != null && !isLoadMode(input.loadMode)) {
    return { ok: false, error: LOAD_MODE_INVALID_MESSAGE };
  }
  if (!nonNegative(input.weight) || !nonNegative(input.assistance)) {
    return { ok: false, error: ASSISTANCE_SEPARATE_MESSAGE };
  }

  if (mode == null) {
    return { ok: true, weight: input.weight, extra: {} };
  }

  const unit = unitLabel(input.weightUnit);
  if (mode === 'bodyweight') {
    if ((input.weight ?? 0) !== 0 || (input.assistance ?? 0) !== 0) {
      return { ok: false, error: BODYWEIGHT_ZERO_MESSAGE };
    }
    if (!persist) {
      return { ok: true, weight: null, extra: {} };
    }
    return {
      ok: true,
      weight: null,
      extra: { load_mode: 'bodyweight', assistance: null, weight_unit: unit },
    };
  }

  if (mode === 'added') {
    if (input.weight == null || input.weight <= 0 || (input.assistance ?? 0) !== 0) {
      return { ok: false, error: ADDED_WEIGHT_MESSAGE };
    }
  } else if (input.assistance == null || input.assistance <= 0 || (input.weight ?? 0) !== 0) {
    return { ok: false, error: ASSISTANCE_SEPARATE_MESSAGE };
  }

  if (!persist) {
    return { ok: false, error: LOAD_MODE_SAVE_BLOCKED_MESSAGE };
  }

  if (mode === 'added') {
    return {
      ok: true,
      weight: input.weight,
      extra: { load_mode: 'added', assistance: null, weight_unit: unit },
    };
  }
  return {
    ok: true,
    weight: null,
    extra: { load_mode: 'assisted', assistance: input.assistance ?? null, weight_unit: unit },
  };
}

export function isActiveProgramDay(archivedAt: string | null | undefined): boolean {
  return archivedAt == null || archivedAt === '';
}

export function visibleProgramDays<T extends { archivedAt?: string | null }>(days: readonly T[]): T[] {
  return days.filter((day) => isActiveProgramDay(day.archivedAt));
}
