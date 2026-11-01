import {
  formatHistorySetLine,
  isLoadMode,
  type LoadMode,
  type WeightUnit,
} from './load-mode.ts';
import { isMissingColumnError } from './postgrest.ts';

// History reads tracking columns when they exist. A database that predates
// those columns is loaded again without them. Null tracking stays on the
// legacy weight and reps line.

export const HISTORY_SET_SELECT_TRACKED = `
  id,
  exercise_id,
  set_number,
  weight,
  reps,
  rir,
  is_completed,
  load_mode,
  assistance,
  weight_unit,
  exercise:exercises (
    id,
    name,
    equipment_type
  )
`;

export const HISTORY_SET_SELECT_LEGACY = `
  id,
  exercise_id,
  set_number,
  weight,
  reps,
  rir,
  is_completed,
  exercise:exercises (
    id,
    name,
    equipment_type
  )
`;

export function historyTrackingColumnMissing(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  return (
    isMissingColumnError(error, 'load_mode') ||
    isMissingColumnError(error, 'assistance') ||
    isMissingColumnError(error, 'weight_unit')
  );
}

export type HistorySetTracking = {
  loadMode: LoadMode | null;
  assistance: number | null;
  weightUnit: WeightUnit | null;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function historySetTracking(row: {
  load_mode?: unknown;
  assistance?: unknown;
  weight_unit?: unknown;
}): HistorySetTracking {
  const unit = row.weight_unit === 'kg' || row.weight_unit === 'lb' ? row.weight_unit : null;
  return {
    loadMode: isLoadMode(row.load_mode) ? row.load_mode : null,
    assistance: finiteNumber(row.assistance),
    weightUnit: unit,
  };
}

export function historySetDisplayLine(set: {
  weight: number | string | null;
  reps: number | null;
  loadMode?: LoadMode | null;
  assistance?: number | null;
  weightUnit?: WeightUnit | null;
}): string {
  return formatHistorySetLine({
    weight: set.weight,
    reps: set.reps,
    loadMode: set.loadMode ?? null,
    assistance: set.assistance ?? null,
    weightUnit: set.weightUnit ?? null,
  });
}
