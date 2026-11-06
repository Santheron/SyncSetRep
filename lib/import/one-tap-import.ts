import type { CreateCustomExerciseResult } from './custom-exercise.ts';
import {
  freezeEquipmentTargetRows,
  mergeEquipmentTargets,
  parseEquipmentWeightText,
  primaryPlannedWeight,
  sanitizeEquipmentTargets,
  savedRowsWithExerciseIds,
  targetsFromWeightAndNotes,
  type EquipmentTarget,
  type LocatedProgramExercise,
  type SavedEquipmentTargetRow,
} from './equipment-targets.ts';
import { OWNED_SAVE_MAX_DAYS } from './limits.ts';
import { normExerciseName } from './normalize-exercise-name.ts';
import { matchImportedExercises, type ImportCatalogExercise } from './match-exercises.ts';
import {
  CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE,
  MANUAL_REPS_SAVE_MESSAGE,
  MANUAL_SETS_SAVE_MESSAGE,
  validateManualRoutine,
} from './manual-program.ts';
import {
  createProgramReview,
  type ProgramReview,
  type ReviewExercise,
} from './review-editor.ts';
import {
  claimRoutineSave,
  completeRoutineSave,
  createRoutineSaveRequestId,
  isRoutineSaveOffline,
  prepareRoutineSaveRequestId,
  ROUTINE_SAVE_OFFLINE_MESSAGE,
  storedPendingEquipmentTargets,
  storedPendingRecoveryReview,
  storedPendingTargetProgramId,
  storeRoutineReview,
  type RoutineDraftScope,
  type RoutineDraftStore,
  type RoutineSaveGate,
} from './routine-draft.ts';

// One-tap save preparation. Catalog matches stay exact or alias only.
// Ambiguous names become the caller's own exercise. This module does not
// decide that a save reached the database; the caller checks the program id.

export const ONE_TAP_DUPLICATE_MESSAGE =
  'This day lists the same exercise twice with different details. Nothing was saved.';

export const ONE_TAP_NAME_MESSAGE = 'Enter an exercise name before saving. Nothing was saved.';

export const ONE_TAP_PARTIAL_MESSAGE =
  'The routine was saved. Equipment targets were not stored. Workout history was not changed.';

export const ONE_TAP_TARGET_MAPPING_MESSAGE =
  'Equipment targets are still missing. This phone does not have the saved exercise mapping, so they were not attached. Workout history was not changed.';

export const ONE_TAP_FAILED_MESSAGE = 'Could not save this routine. Nothing was saved.';

export function missingPrescriptionMessage(names: readonly string[]): string {
  const listed = names.filter((name) => name.trim() !== '');
  const detail = listed.length > 0 ? ` ${listed.join(', ')}.` : '';
  return `These movements have no sets or reps, so nothing was saved.${detail} The original text is still here. Workout history was not changed.`;
}

const REST_DAY_LABELS = new Set(['rest', 'rest day', 'off', 'off day']);

export function isRestDayLabel(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ');
  return REST_DAY_LABELS.has(normalized);
}

export function withParsedEquipmentTargets(exercise: ReviewExercise): ReviewExercise {
  const stored = sanitizeEquipmentTargets(exercise.equipmentTargets);
  if (stored) {
    return { ...exercise, equipmentTargets: stored };
  }
  const fromNotes = targetsFromWeightAndNotes(exercise.weight?.value, exercise.notes);
  if (!fromNotes) {
    const { equipmentTargets: _ignored, ...rest } = exercise;
    return rest;
  }
  const primary = primaryPlannedWeight(fromNotes);
  return {
    ...exercise,
    equipmentTargets: fromNotes,
    ...(primary.weight == null
      ? {}
      : {
          weight: { acceptance: 'extracted' as const, value: primary.weight, suggestion: null },
          plannedWeightUnit: primary.unit,
        }),
  };
}

export function prepareRoutineForSave(
  review: ProgramReview,
  catalog: readonly ImportCatalogExercise[],
  mode: 'import' | 'manual',
): { review: ProgramReview; errors: string[] } {
  const errors: string[] = [];
  const days = review.days.map((day) => {
    if (isRestDayLabel(day.name)) {
      return { ...day, exercises: [] };
    }
    const resolved = day.exercises.map((exercise) =>
      mode === 'import' ? resolveImportedExercise(exercise, catalog, errors) : withParsedEquipmentTargets(exercise),
    );
    return { ...day, exercises: mergeDayExercises(resolved, errors) };
  });
  return {
    review: createProgramReview({
      origin: review.origin,
      programName: review.programName,
      days,
      issues: review.issues,
      warnings: review.warnings,
    }),
    errors: [...new Set(errors)],
  };
}

export async function materializeCustomExercises(
  review: ProgramReview,
  options: {
    enabled: boolean;
    create: (name: string) => Promise<CreateCustomExerciseResult>;
  },
): Promise<{ ok: true; review: ProgramReview } | { ok: false; error: string; review: ProgramReview }> {
  const pending = review.days.flatMap((day) =>
    day.exercises.filter((exercise) => exercise.exerciseId == null && (exercise.sourceName?.trim() ?? '') !== ''),
  );
  if (pending.length === 0) {
    return { ok: true, review };
  }
  if (!options.enabled) {
    return { ok: false, error: CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE, review };
  }
  const ids = new Map<string, string>();
  const days = [];
  for (const day of review.days) {
    const exercises: ReviewExercise[] = [];
    for (const exercise of day.exercises) {
      if (exercise.exerciseId != null || (exercise.sourceName?.trim() ?? '') === '') {
        exercises.push(exercise);
        continue;
      }
      const name = exercise.sourceName?.trim() ?? '';
      const key = normExerciseName(name);
      let exerciseId = ids.get(key);
      if (!exerciseId) {
        let created: CreateCustomExerciseResult;
        try {
          created = await options.create(name);
        } catch {
          return { ok: false, error: ONE_TAP_FAILED_MESSAGE, review };
        }
        if (!created.ok) {
          return { ok: false, error: created.error, review };
        }
        exerciseId = created.exerciseId;
        ids.set(key, exerciseId);
      }
      exercises.push({
        ...exercise,
        exerciseId,
        matchStatus: 'manual',
        sourceName: name,
      });
    }
    days.push({ ...day, exercises });
  }
  return {
    ok: true,
    review: createProgramReview({
      origin: review.origin,
      programName: review.programName,
      days,
      issues: review.issues,
      warnings: review.warnings,
    }),
  };
}

export type GuardedSaveStatus = 'skipped' | 'failed' | 'saved' | 'partial';

export type GuardedSaveResult = {
  status: GuardedSaveStatus;
  programId: string | null;
  errors: string[];
  review: ProgramReview;
  editingLocked: boolean;
};

type ProgramSaveResult = { ok: true; programId: string } | { ok: false; errors: string[] };

export async function runGuardedProgramSave(input: {
  mode: 'import' | 'manual';
  review: ProgramReview;
  catalog: readonly ImportCatalogExercise[];
  gate: RoutineSaveGate;
  store: RoutineDraftStore;
  userId: string | null;
  scope: RoutineDraftScope;
  programId: string | null;
  programsLoaded: boolean;
  hasCurrentProgram: boolean;
  storedRaw: string | null;
  ownedProgramRpcEnabled: boolean;
  customWritesEnabled: boolean;
  persistTargets: boolean;
  sourceText?: string | null;
  createCustom: (name: string) => Promise<CreateCustomExerciseResult>;
  saveProgram: (review: ProgramReview, clientRequestId: string | undefined) => Promise<ProgramSaveResult>;
  locateSavedRows?: (programId: string) => Promise<readonly LocatedProgramExercise[] | null>;
  saveTargets: (
    programId: string,
    review: ProgramReview,
    savedRows?: readonly SavedEquipmentTargetRow[] | null,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}): Promise<GuardedSaveResult> {
  if (!input.programsLoaded || !claimRoutineSave(input.gate)) {
    return { status: 'skipped', programId: null, errors: [], review: input.review, editingLocked: false };
  }
  const pendingProgramId = storedPendingTargetProgramId(input.storedRaw);
  if (pendingProgramId) {
    return retryPendingEquipmentTargets(input, pendingProgramId);
  }
  const prepared = prepareRoutineForSave(input.review, input.catalog, input.mode);
  if (prepared.errors.length > 0) {
    finish(input, prepared.review, { ok: false });
    return { status: 'failed', programId: null, errors: prepared.errors, review: prepared.review, editingLocked: false };
  }
  const readiness = routineSaveReadiness(prepared.review, input.mode);
  if (readiness.length > 0) {
    finish(input, prepared.review, { ok: false });
    return { status: 'failed', programId: null, errors: readiness, review: prepared.review, editingLocked: false };
  }
  const persistAttempt =
    input.scope === 'import' || (input.scope !== 'edit' && !input.hasCurrentProgram);
  const requestId = persistAttempt ? prepareRoutineSaveRequestId(input.storedRaw, createRoutineSaveRequestId) : null;
  if (input.ownedProgramRpcEnabled && persistAttempt && requestId == null) {
    finish(input, prepared.review, { ok: false });
    return { status: 'failed', programId: null, errors: [ONE_TAP_FAILED_MESSAGE], review: prepared.review, editingLocked: false };
  }
  remember(input, prepared.review, 'saving', persistAttempt ? requestId : undefined);
  const materialized = await materializeCustomExercises(prepared.review, {
    enabled: input.customWritesEnabled,
    create: input.createCustom,
  });
  if (!materialized.ok) {
    finish(input, materialized.review, { ok: false });
    return { status: 'failed', programId: null, errors: [materialized.error], review: materialized.review, editingLocked: false };
  }
  let saved: ProgramSaveResult;
  try {
    saved = await input.saveProgram(
      materialized.review,
      input.ownedProgramRpcEnabled && persistAttempt ? requestId ?? undefined : undefined,
    );
  } catch (error) {
    finish(input, materialized.review, { ok: false });
    const message = isRoutineSaveOffline(error) ? ROUTINE_SAVE_OFFLINE_MESSAGE : ONE_TAP_FAILED_MESSAGE;
    return { status: 'failed', programId: null, errors: [message], review: materialized.review, editingLocked: false };
  }
  if (!saved.ok) {
    finish(input, materialized.review, { ok: false });
    return { status: 'failed', programId: null, errors: saved.errors, review: materialized.review, editingLocked: false };
  }
  const needsTargets =
    input.persistTargets &&
    materialized.review.days.some((day) => day.exercises.some((exercise) => (exercise.equipmentTargets?.length ?? 0) > 0));
  if (!needsTargets) {
    finish(input, materialized.review, saved);
    return { status: 'saved', programId: saved.programId, errors: [], review: materialized.review, editingLocked: false };
  }
  const savedRows = await frozenRowsForSavedProgram(input, saved.programId, materialized.review);
  if (!savedRows) {
    finish(input, materialized.review, { ok: false }, saved.programId, null, materialized.review);
    return {
      status: 'partial',
      programId: saved.programId,
      errors: [ONE_TAP_TARGET_MAPPING_MESSAGE],
      review: materialized.review,
      editingLocked: true,
    };
  }
  let targets: { ok: true } | { ok: false; error: string };
  try {
    targets = await input.saveTargets(saved.programId, materialized.review, savedRows);
  } catch {
    targets = { ok: false, error: ONE_TAP_PARTIAL_MESSAGE };
  }
  if (!targets.ok) {
    finish(input, materialized.review, { ok: false }, saved.programId, savedRows, materialized.review);
    return {
      status: 'partial',
      programId: saved.programId,
      errors: [targets.error || ONE_TAP_PARTIAL_MESSAGE],
      review: materialized.review,
      editingLocked: true,
    };
  }
  finish(input, materialized.review, saved);
  return { status: 'saved', programId: saved.programId, errors: [], review: materialized.review, editingLocked: false };
}

function resolveImportedExercise(
  exercise: ReviewExercise,
  catalog: readonly ImportCatalogExercise[],
  errors: string[],
): ReviewExercise {
  const next = withParsedEquipmentTargets(exercise);
  if (next.matchStatus === 'manual' && next.exerciseId != null && String(next.exerciseId) !== '') {
    return next;
  }
  const sourceName = next.sourceName?.trim() ?? '';
  if (sourceName === '') {
    errors.push(ONE_TAP_NAME_MESSAGE);
    return { ...next, exerciseId: null, matchStatus: 'unmatched' };
  }
  const match = matchImportedExercises(catalog, sourceName);
  const catalogId =
    match.status === 'matched' &&
    (match.method === 'exact' || match.method === 'alias') &&
    match.candidateIds.length === 1 &&
    match.selectedId != null &&
    match.candidateIds[0] === match.selectedId
      ? match.selectedId
      : null;
  if (catalogId) {
    return { ...next, exerciseId: catalogId, matchStatus: 'matched', sourceName };
  }
  return { ...next, exerciseId: null, matchStatus: 'unmatched', sourceName };
}

function mergeDayExercises(exercises: readonly ReviewExercise[], errors: string[]): ReviewExercise[] {
  const merged: ReviewExercise[] = [];
  const indexById = new Map<string, number>();
  const customNames = new Set<string>();
  for (const exercise of exercises) {
    const id = exercise.exerciseId == null || exercise.exerciseId === '' ? null : String(exercise.exerciseId);
    if (id == null) {
      const name = normExerciseName(exercise.sourceName ?? '');
      if (name !== '' && customNames.has(name)) {
        errors.push(ONE_TAP_DUPLICATE_MESSAGE);
        continue;
      }
      if (name !== '') {
        customNames.add(name);
      }
      merged.push(exercise);
      continue;
    }
    const existingIndex = indexById.get(id);
    if (existingIndex == null) {
      indexById.set(id, merged.length);
      merged.push(exercise);
      continue;
    }
    const existing = merged[existingIndex];
    if (!existing || !samePrescription(existing, exercise)) {
      errors.push(ONE_TAP_DUPLICATE_MESSAGE);
      continue;
    }
    const targets = mergeEquipmentTargets(existing.equipmentTargets, exercise.equipmentTargets);
    if (!targets.ok) {
      errors.push(ONE_TAP_DUPLICATE_MESSAGE);
      continue;
    }
    merged[existingIndex] = applyMergedTargets(existing, targets.targets);
  }
  return merged;
}

function samePrescription(left: ReviewExercise, right: ReviewExercise): boolean {
  return (
    left.sets.value === right.sets.value &&
    left.repsMin.value === right.repsMin.value &&
    left.repsMax.value === right.repsMax.value
  );
}

function applyMergedTargets(exercise: ReviewExercise, targets: EquipmentTarget[] | null): ReviewExercise {
  const primary = primaryPlannedWeight(targets);
  return {
    ...exercise,
    ...(targets ? { equipmentTargets: targets } : {}),
    ...(primary.weight == null
      ? {}
      : {
          weight: { acceptance: 'extracted' as const, value: primary.weight, suggestion: null },
          plannedWeightUnit: primary.unit,
        }),
  };
}

function routineSaveReadiness(review: ProgramReview, mode: 'import' | 'manual'): string[] {
  const valid = validateManualRoutine(
    review,
    mode === 'import'
      ? { subtitleRequired: false, allowUnspecifiedPrescription: true, maxDays: OWNED_SAVE_MAX_DAYS }
      : undefined,
  );
  if (valid.ok) {
    return [];
  }
  if (mode === 'import') {
    return valid.errors;
  }
  const names: string[] = [];
  for (const day of review.days) {
    if (isRestDayLabel(day.name)) {
      continue;
    }
    for (const exercise of day.exercises) {
      const sets = acceptedPrescription(exercise.sets);
      const repsMin = acceptedPrescription(exercise.repsMin);
      const repsMax = acceptedPrescription(exercise.repsMax);
      if (sets == null || repsMin == null || repsMax == null) {
        const name = exercise.sourceName?.trim() || 'Unnamed movement';
        names.push(name);
      }
    }
  }
  const errors = valid.errors.filter(
    (error) => error !== MANUAL_SETS_SAVE_MESSAGE && error !== MANUAL_REPS_SAVE_MESSAGE,
  );
  if (names.length > 0) {
    errors.unshift(missingPrescriptionMessage(names));
  }
  return errors;
}

function acceptedPrescription(field: { acceptance: string; value: number | null } | undefined): number | null {
  if (!field) {
    return null;
  }
  const accepted =
    field.acceptance === 'extracted' ||
    field.acceptance === 'accepted_suggestion' ||
    field.acceptance === 'user_entered';
  if (!accepted || typeof field.value !== 'number' || !Number.isInteger(field.value)) {
    return null;
  }
  return field.value;
}

function remember(
  input: {
    store: RoutineDraftStore;
    userId: string | null;
    scope: RoutineDraftScope;
    programId: string | null;
    sourceText?: string | null;
  },
  review: ProgramReview,
  saveState: 'editing' | 'saving',
  saveRequestId?: string | null,
) {
  if (!input.userId) {
    return;
  }
  storeRoutineReview({
    store: input.store,
    userId: input.userId,
    scope: input.scope,
    programId: input.programId,
    review,
    saveState,
    saveRequestId,
    sourceText: input.sourceText,
  });
}

function finish(
  input: {
    gate: RoutineSaveGate;
    store: RoutineDraftStore;
    userId: string | null;
    scope: RoutineDraftScope;
    programId: string | null;
    sourceText?: string | null;
  },
  review: ProgramReview,
  result: { ok: true; programId: string } | { ok: false },
  pendingTargetProgramId?: string | null,
  pendingEquipmentTargets?: readonly SavedEquipmentTargetRow[] | null,
  pendingTargetSnapshot?: ProgramReview | null,
) {
  completeRoutineSave({
    gate: input.gate,
    result,
    store: input.store,
    userId: input.userId,
    scope: input.scope,
    programId: input.programId,
    review,
    sourceText: input.sourceText,
    pendingTargetProgramId,
    pendingEquipmentTargets,
    pendingTargetSnapshot,
  });
}

async function frozenRowsForSavedProgram(
  input: Parameters<typeof runGuardedProgramSave>[0],
  programId: string,
  review: ProgramReview,
): Promise<SavedEquipmentTargetRow[] | null> {
  const frozen = freezeEquipmentTargetRows(review.days);
  if (frozen.length === 0) {
    return null;
  }
  if (!input.locateSavedRows) {
    return frozen;
  }
  try {
    const located = await input.locateSavedRows(programId);
    const identified = savedRowsWithExerciseIds(frozen, located);
    return identified.length > 0 ? identified : null;
  } catch {
    return frozen;
  }
}

async function retryPendingEquipmentTargets(
  input: Parameters<typeof runGuardedProgramSave>[0],
  pendingProgramId: string,
): Promise<GuardedSaveResult> {
  const savedRows = storedPendingEquipmentTargets(input.storedRaw);
  const review = storedPendingRecoveryReview(input.storedRaw) ?? input.review;
  remember(input, review, 'saving');
  if (!savedRows) {
    finish(input, review, { ok: false }, pendingProgramId);
    return {
      status: 'partial',
      programId: pendingProgramId,
      errors: [ONE_TAP_TARGET_MAPPING_MESSAGE],
      review,
      editingLocked: true,
    };
  }
  if (!input.persistTargets) {
    finish(input, review, { ok: false }, pendingProgramId);
    return {
      status: 'partial',
      programId: pendingProgramId,
      errors: [ONE_TAP_PARTIAL_MESSAGE],
      review,
      editingLocked: true,
    };
  }
  let targets: { ok: true } | { ok: false; error: string };
  try {
    targets = await input.saveTargets(pendingProgramId, review, savedRows);
  } catch {
    targets = { ok: false, error: ONE_TAP_PARTIAL_MESSAGE };
  }
  if (!targets.ok) {
    finish(input, review, { ok: false }, pendingProgramId);
    return {
      status: 'partial',
      programId: pendingProgramId,
      errors: [targets.error || ONE_TAP_PARTIAL_MESSAGE],
      review,
      editingLocked: true,
    };
  }
  finish(input, review, { ok: true, programId: pendingProgramId });
  return { status: 'saved', programId: pendingProgramId, errors: [], review, editingLocked: false };
}
