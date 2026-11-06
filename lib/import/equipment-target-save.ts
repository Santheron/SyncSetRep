import { PERSIST_PLANNED_WEIGHT } from './flags.ts';
import { MAX_EXERCISES_PER_DAY, SCHEMA_MAX_DAYS } from './limits.ts';
import { isMissingColumnError } from '../postgrest.ts';
import {
  acceptedSavedEquipmentTargetRows,
  type EquipmentTarget,
  type LocatedProgramExercise,
  type SavedEquipmentTargetRow,
} from './equipment-targets.ts';
import { ONE_TAP_PARTIAL_MESSAGE, ONE_TAP_TARGET_MAPPING_MESSAGE } from './one-tap-import.ts';
import type { ProgramReview } from './review-editor.ts';

// Writes equipment targets through save_equipment_targets only.
// It does not send them inside save_owned_program.

export const EQUIPMENT_TARGETS_UNAVAILABLE_MESSAGE =
  'Equipment targets are not installed yet. The routine was saved. Workout history was not changed.';

export type EquipmentTargetWire = {
  equipment: EquipmentTarget['equipment'];
  weight: number | null;
  unit: 'lb' | 'kg' | null;
  variation_exercise_id?: number;
};

export type EquipmentTargetRow = {
  program_exercise_id?: number;
  day_order?: number;
  exercise_order?: number;
  targets: EquipmentTargetWire[] | null;
};

export type EquipmentTargetRpc = (args: {
  p_payload: { program_id?: number; rows: EquipmentTargetRow[] };
}) => Promise<{ data: unknown; error: { message?: string | null } | null }>;

export function equipmentTargetRowsFromSaved(rows: readonly SavedEquipmentTargetRow[]): EquipmentTargetRow[] | null {
  const accepted = acceptedSavedEquipmentTargetRows(rows);
  if (!accepted) {
    return null;
  }
  const useIds = accepted.every((row) => row.programExerciseId != null);
  const wire: EquipmentTargetRow[] = [];
  for (const row of accepted) {
    const targets = row.targets.map(wireTarget);
    if (useIds) {
      const programExerciseId = wireExerciseId(row.programExerciseId ?? '');
      if (programExerciseId == null) {
        return null;
      }
      wire.push({ program_exercise_id: programExerciseId, targets });
      continue;
    }
    wire.push({ day_order: row.dayOrder, exercise_order: row.exerciseOrder, targets });
  }
  return wire;
}

export function equipmentTargetRowsFromReview(review: ProgramReview): EquipmentTargetRow[] {
  const rows: EquipmentTargetRow[] = [];
  review.days.forEach((day, dayIndex) => {
    day.exercises.forEach((exercise, exerciseIndex) => {
      if (!exercise.equipmentTargets || exercise.equipmentTargets.length === 0) {
        return;
      }
      rows.push({
        day_order: dayIndex + 1,
        exercise_order: exerciseIndex + 1,
        targets: exercise.equipmentTargets.map(wireTarget),
      });
    });
  });
  return rows;
}

export async function saveEquipmentTargetRow(
  programExerciseId: string,
  targets: EquipmentTarget[],
  options?: { rpc?: EquipmentTargetRpc; enabled?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const enabled = options?.enabled ?? PERSIST_PLANNED_WEIGHT;
  if (!enabled) {
    return { ok: false, error: EQUIPMENT_TARGETS_UNAVAILABLE_MESSAGE };
  }
  const id = Number(programExerciseId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, error: ONE_TAP_PARTIAL_MESSAGE };
  }
  const rpc = options?.rpc ?? defaultRpc;
  let response: { data: unknown; error: { message?: string | null } | null };
  try {
    response = await rpc({
      p_payload: {
        rows: [
          {
            program_exercise_id: id,
            targets: targets.map(wireTarget),
          },
        ],
      },
    });
  } catch {
    return { ok: false, error: ONE_TAP_PARTIAL_MESSAGE };
  }
  if (response.error || !response.data || typeof response.data !== 'object' || (response.data as { ok?: unknown }).ok !== true) {
    return { ok: false, error: response.error ? targetError(response.error.message) : ONE_TAP_PARTIAL_MESSAGE };
  }
  return { ok: true };
}

export async function saveEquipmentTargetsForReview(
  programId: string,
  review: ProgramReview,
  options?: { rpc?: EquipmentTargetRpc; enabled?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const enabled = options?.enabled ?? PERSIST_PLANNED_WEIGHT;
  const rows = equipmentTargetRowsFromReview(review);
  if (!enabled || rows.length === 0) {
    return { ok: true };
  }
  return writeEquipmentTargetRows(programId, rows, options);
}

export async function saveEquipmentTargetsForSavedRows(
  programId: string,
  rows: readonly SavedEquipmentTargetRow[],
  options?: { rpc?: EquipmentTargetRpc; enabled?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const wire = equipmentTargetRowsFromSaved(rows);
  if (!wire) {
    return { ok: false, error: ONE_TAP_TARGET_MAPPING_MESSAGE };
  }
  const enabled = options?.enabled ?? PERSIST_PLANNED_WEIGHT;
  if (!enabled) {
    return { ok: false, error: ONE_TAP_PARTIAL_MESSAGE };
  }
  return writeEquipmentTargetRows(programId, wire, options);
}

export function saveGuardedEquipmentTargets(
  programId: string,
  review: ProgramReview,
  savedRows?: readonly SavedEquipmentTargetRow[] | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (savedRows != null) {
    return saveEquipmentTargetsForSavedRows(programId, savedRows);
  }
  return saveEquipmentTargetsForReview(programId, review);
}

export async function locateOwnedProgramExerciseIds(programId: string): Promise<LocatedProgramExercise[] | null> {
  if (!/^[1-9][0-9]{0,18}$/.test(programId)) {
    return null;
  }
  const program = Number(programId);
  if (!Number.isSafeInteger(program) || program <= 0) {
    return null;
  }
  try {
    const { supabase } = await import('../supabase.ts');
    const withArchive = await supabase
      .from('program_days')
      .select('id, day_order, archived_at')
      .eq('program_id', programId)
      .is('archived_at', null)
      .order('day_order', { ascending: true });
    const days =
      withArchive.error && isMissingColumnError(withArchive.error, 'archived_at')
        ? await supabase
            .from('program_days')
            .select('id, day_order')
            .eq('program_id', programId)
            .order('day_order', { ascending: true })
        : withArchive;
    if (days.error || !Array.isArray(days.data)) {
      return null;
    }
    const dayOrderById = new Map<string, number>();
    for (const day of days.data as { id?: number | string; day_order?: number | string }[]) {
      const dayId = day.id == null ? null : locatedId(day.id);
      const dayOrder = day.day_order == null ? null : locatedOrder(day.day_order, SCHEMA_MAX_DAYS);
      if (!dayId || dayOrder == null || [...dayOrderById.values()].includes(dayOrder)) {
        return null;
      }
      dayOrderById.set(dayId, dayOrder);
    }
    if (dayOrderById.size === 0) {
      return [];
    }
    const exercises = await supabase
      .from('program_exercises')
      .select('id, program_day_id, exercise_order')
      .in('program_day_id', [...dayOrderById.keys()]);
    if (exercises.error || !Array.isArray(exercises.data)) {
      return null;
    }
    const located: LocatedProgramExercise[] = [];
    const slots = new Set<string>();
    const ids = new Set<string>();
    for (const row of exercises.data as {
      id?: number | string;
      program_day_id?: number | string;
      exercise_order?: number | string;
    }[]) {
      const programExerciseId = row.id == null ? null : locatedId(row.id);
      const dayId = row.program_day_id == null ? null : locatedId(row.program_day_id);
      const exerciseOrder = row.exercise_order == null ? null : locatedOrder(row.exercise_order, MAX_EXERCISES_PER_DAY);
      const dayOrder = dayId ? dayOrderById.get(dayId) : undefined;
      if (!programExerciseId || dayOrder == null || exerciseOrder == null) {
        return null;
      }
      const slot = `${dayOrder}:${exerciseOrder}`;
      if (slots.has(slot) || ids.has(programExerciseId)) {
        return null;
      }
      slots.add(slot);
      ids.add(programExerciseId);
      located.push({ dayOrder, exerciseOrder, programExerciseId });
    }
    return located;
  } catch {
    return null;
  }
}

async function writeEquipmentTargetRows(
  programId: string,
  rows: EquipmentTargetRow[],
  options?: { rpc?: EquipmentTargetRpc },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const program = Number(programId);
  if (!Number.isSafeInteger(program) || program <= 0) {
    return { ok: false, error: ONE_TAP_PARTIAL_MESSAGE };
  }
  const rpc = options?.rpc ?? defaultRpc;
  let response: { data: unknown; error: { message?: string | null } | null };
  try {
    response = await rpc({ p_payload: { program_id: program, rows } });
  } catch {
    return { ok: false, error: ONE_TAP_PARTIAL_MESSAGE };
  }
  if (response.error) {
    return { ok: false, error: targetError(response.error.message) };
  }
  const data = response.data;
  const ok = !!data && typeof data === 'object' && (data as { ok?: unknown }).ok === true;
  if (!ok) {
    return { ok: false, error: ONE_TAP_PARTIAL_MESSAGE };
  }
  return { ok: true };
}

async function defaultRpc(args: { p_payload: { program_id?: number; rows: EquipmentTargetRow[] } }) {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase.rpc('save_equipment_targets', args);
  return { data: result.data, error: result.error };
}

function wireExerciseId(value: string): number | null {
  if (!/^[1-9][0-9]{0,18}$/.test(value)) {
    return null;
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || String(id) !== value) {
    return null;
  }
  return id;
}

function locatedId(value: number | string): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      return null;
    }
    return String(value);
  }
  return /^[1-9][0-9]{0,18}$/.test(value) ? value : null;
}

function locatedOrder(value: number | string, max: number): number | null {
  const order = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(order) || order < 1 || order > max) {
    return null;
  }
  return order;
}

function wireTarget(target: EquipmentTarget): EquipmentTargetWire {
  const variation = target.variationExerciseId;
  const id = variation && /^[1-9][0-9]{0,18}$/.test(variation) ? Number(variation) : null;
  return {
    equipment: target.equipment,
    weight: target.weight,
    unit: target.unit,
    ...(id != null && Number.isSafeInteger(id) ? { variation_exercise_id: id } : {}),
  };
}

function targetError(message: string | null | undefined): string {
  const text = message ?? '';
  if (
    text.includes('equipment_targets') &&
    (text.includes('does not exist') || text.includes('Could not find') || text.includes('schema cache'))
  ) {
    return EQUIPMENT_TARGETS_UNAVAILABLE_MESSAGE;
  }
  return ONE_TAP_PARTIAL_MESSAGE;
}
