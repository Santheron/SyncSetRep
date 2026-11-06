import {
  DAY_NAME_MAX,
  TEXT_MAX_CHARS,
  SCHEMA_MAX_DAYS,
  MAX_EXERCISES,
  MAX_EXERCISES_PER_DAY,
  NOTE_EDIT_MAX,
  PROGRAM_NAME_MAX,
  REPS_MAX,
  REPS_MIN,
  REST_MAX,
  REST_MIN,
  SETS_MAX,
  SETS_MIN,
  SOURCE_NAME_MAX,
  TEXT_FIELD_MAX,
  WARNING_MAX_CHARS,
  WEIGHT_MAX,
  WEIGHT_MIN,
} from './limits.ts';
import {
  acceptedSavedEquipmentTargetRows,
  sanitizeEquipmentTargets,
  type SavedEquipmentTargetRow,
} from './equipment-targets.ts';
import { isLoadMode } from '../load-mode.ts';
import {
  createManualProgramReview,
  type ProgramReview,
  type ProgramReviewOrigin,
  type ReviewDay,
  type ReviewExercise,
} from './review-editor.ts';
import type { Acceptance, ImportPreviewIssue, PreviewMatchStatus, PreviewNumber } from './save-plan.ts';

// Device-local copy of a routine the person has not confirmed with Save.
// Restoring this copy never calls a save RPC and never writes a program.

export const ROUTINE_DRAFT_VERSION = 1;
export const ROUTINE_DRAFT_MAX_CHARS = 1_000_000;

export const ROUTINE_DRAFT_RESTORED_MESSAGE =
  'Recovered the routine still on this phone. It is not saved until the database confirms Save.';

export const ROUTINE_DRAFT_UNCONFIRMED_MESSAGE =
  'The last save was not confirmed. This copy is still on this phone. Saving again can add another routine. It does not change workout history.';

export const ROUTINE_DRAFT_FIRST_SAVE_UNCONFIRMED_MESSAGE =
  'The last save was not confirmed. This copy is still on this phone. Saving again uses the same save attempt. A routine the database already stored is kept and is not replaced. It does not change workout history.';

export const ROUTINE_DRAFT_PARTIAL_TARGET_MESSAGE =
  'This routine is saved, but its equipment targets are still missing. Retry writes only those targets and does not create another routine. Editing stays locked until those targets are stored. Workout history was not changed.';

export const ROUTINE_SAVE_OFFLINE_MESSAGE =
  'Could not reach the save service. This routine is still on this phone. Nothing was saved.';

export const FIRST_PROGRAM_SAVE_READY_NOTICE =
  'This routine becomes your current program only after Save is confirmed. Workout history stays unchanged.';

export const LOCAL_DAY_SAVE_READY_NOTICE =
  'Days and exercises stay on this phone until Save is confirmed. Nothing is added to a saved program before that.';

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROGRAM_ID_LIMIT = 9223372036854775807n;
const ACCEPTANCES = new Set<Acceptance>(['extracted', 'accepted_suggestion', 'user_entered', 'missing']);
const MATCHES = new Set<PreviewMatchStatus>(['matched', 'ambiguous', 'unmatched', 'manual']);
const ORIGINS = new Set<ProgramReviewOrigin>(['manual', 'import']);
const OFFLINE_MARKERS = [
  'network request failed',
  'failed to fetch',
  'fetch failed',
  'failed to send a request',
  'network error',
  'network connection',
  'offline',
  'timed out',
  'timeout',
  'econnrefused',
  'econnreset',
  'enotfound',
  'eai_again',
  'etimedout',
  'err_internet_disconnected',
  'err_network',
  'the internet connection appears to be offline',
];

export type RoutineDraftScope = 'new' | 'edit' | 'import';
export type RoutineDraftSaveState = 'editing' | 'saving' | 'confirmed';

export type LocalRoutineDraft = {
  version: 1;
  userId: string;
  scope: RoutineDraftScope;
  programId: string | null;
  review: ProgramReview;
  updatedAt: string;
  saveState: RoutineDraftSaveState;
  confirmedProgramId: string | null;
  saveRequestId: string | null;
  pendingTargetProgramId: string | null;
  pendingEquipmentTargets: SavedEquipmentTargetRow[] | null;
  pendingTargetSnapshot: ProgramReview | null;
  sourceText?: string | null;
};

export type RoutineDraftStore = {
  read(key: string): string | null;
  write(key: string, value: string): void;
  delete(key: string): void;
};

export type RoutineSaveGate = {
  locked: boolean;
  confirmedProgramId: string | null;
};

export type RoutineDraftResolution = {
  review: ProgramReview;
  notice: string | null;
  dropStored: boolean;
  pendingTargetProgramId: string | null;
  pendingEquipmentTargets: SavedEquipmentTargetRow[] | null;
  editingLocked: boolean;
  sourceText: string | null;
};

export function createRoutineSaveGate(): RoutineSaveGate {
  return { locked: false, confirmedProgramId: null };
}

export function createMemoryRoutineDraftStore(initial?: Record<string, string>): RoutineDraftStore {
  const entries = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    read(key) {
      return entries.has(key) ? entries.get(key) ?? null : null;
    },
    write(key, value) {
      entries.set(key, value);
    },
    delete(key) {
      entries.delete(key);
    },
  };
}

export function snapshotRoutineDraftStore(store: RoutineDraftStore, keys: readonly string[]): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const key of keys) {
    const value = store.read(key);
    if (value != null) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

export function acceptedDraftUserId(userId: string): string | null {
  const normalized = userId.trim().toLowerCase();
  return USER_ID_PATTERN.test(normalized) ? normalized : null;
}

export function acceptedSaveRequestId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return USER_ID_PATTERN.test(normalized) ? normalized : null;
}

export function createRoutineSaveRequestId(randomUuid: () => string = () => globalThis.crypto.randomUUID()): string {
  const accepted = acceptedSaveRequestId(randomUuid());
  if (!accepted) {
    throw new Error('Could not prepare this save.');
  }
  return accepted;
}

export function storedRoutineSaveRequestId(storedRaw: string | null): string | null {
  const stored = storedRaw == null ? null : decodeRoutineDraft(storedRaw);
  return stored?.saveRequestId ?? null;
}

export function storedPendingTargetProgramId(storedRaw: string | null): string | null {
  const stored = storedRaw == null ? null : decodeRoutineDraft(storedRaw);
  return stored?.pendingTargetProgramId ?? null;
}

export function storedPendingEquipmentTargets(storedRaw: string | null): SavedEquipmentTargetRow[] | null {
  const stored = storedRaw == null ? null : decodeRoutineDraft(storedRaw);
  return stored?.pendingEquipmentTargets ?? null;
}

export function storedPendingRecoveryReview(storedRaw: string | null): ProgramReview | null {
  const stored = storedRaw == null ? null : decodeRoutineDraft(storedRaw);
  if (!stored?.pendingTargetProgramId) {
    return null;
  }
  return stored.pendingTargetSnapshot ?? stored.review;
}

export function prepareRoutineSaveRequestId(
  storedRaw: string | null,
  randomUuid?: () => string,
): string | null {
  const existing = storedRoutineSaveRequestId(storedRaw);
  if (existing) {
    return existing;
  }
  try {
    return createRoutineSaveRequestId(randomUuid);
  } catch {
    return null;
  }
}

export function acceptedDraftProgramId(programId: string): string | null {
  if (!/^[1-9][0-9]*$/.test(programId) || programId.length > 19) {
    return null;
  }
  try {
    const value = BigInt(programId);
    return value >= 1n && value <= PROGRAM_ID_LIMIT ? programId : null;
  } catch {
    return null;
  }
}

export function routineDraftKey(
  userId: string,
  scope: RoutineDraftScope,
  programId: string | null,
): string | null {
  const owner = acceptedDraftUserId(userId);
  if (!owner) {
    return null;
  }
  if (scope === 'new' || scope === 'import') {
    return programId == null ? `routine-draft_${owner}_${scope}_new` : null;
  }
  const storedProgramId = programId == null ? null : acceptedDraftProgramId(programId);
  return storedProgramId == null ? null : `routine-draft_${owner}_edit_${storedProgramId}`;
}

export function routineDraftFileName(key: string): string | null {
  if (!/^routine-draft_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_(new_new|import_new|edit_[1-9][0-9]*)$/.test(key)) {
    return null;
  }
  const programId = key.slice(key.lastIndexOf('_') + 1);
  if (programId !== 'new' && acceptedDraftProgramId(programId) == null) {
    return null;
  }
  return `${key}.json`;
}

export function isRoutineSaveOffline(error: unknown): boolean {
  const text = offlineText(error);
  return text !== '' && OFFLINE_MARKERS.some((marker) => text.includes(marker));
}

export function routineDraftHasContent(review: ProgramReview): boolean {
  return !reviewsEqual(review, createManualProgramReview());
}

export function reviewsEqual(left: ProgramReview, right: ProgramReview): boolean {
  return canonicalReview(left) === canonicalReview(right);
}

export function encodeRoutineDraft(draft: LocalRoutineDraft): string | null {
  const key = routineDraftKey(draft.userId, draft.scope, draft.programId);
  const review = sanitizeReview(draft.review);
  if (!key || !review || !validTimestamp(draft.updatedAt)) {
    return null;
  }
  if (draft.version !== ROUTINE_DRAFT_VERSION) {
    return null;
  }
  if (draft.saveState !== 'editing' && draft.saveState !== 'saving' && draft.saveState !== 'confirmed') {
    return null;
  }
  const confirmedProgramId =
    draft.saveState === 'confirmed' ? acceptedDraftProgramId(draft.confirmedProgramId ?? '') : null;
  if (draft.saveState === 'confirmed' && confirmedProgramId == null) {
    return null;
  }
  const saveRequestId = draft.saveRequestId == null ? null : acceptedSaveRequestId(draft.saveRequestId);
  if (draft.saveRequestId != null && saveRequestId == null) {
    return null;
  }
  const pendingTargetProgramId =
    draft.pendingTargetProgramId == null ? null : acceptedDraftProgramId(draft.pendingTargetProgramId);
  if (draft.pendingTargetProgramId != null && pendingTargetProgramId == null) {
    return null;
  }
  if (draft.saveState === 'confirmed' && pendingTargetProgramId != null) {
    return null;
  }
  const pendingEquipmentTargets =
    draft.pendingEquipmentTargets == null ? null : acceptedSavedEquipmentTargetRows(draft.pendingEquipmentTargets);
  if (draft.pendingEquipmentTargets != null && pendingEquipmentTargets == null) {
    return null;
  }
  const pendingTargetSnapshot = draft.pendingTargetSnapshot == null ? null : sanitizeReview(draft.pendingTargetSnapshot);
  if (draft.pendingTargetSnapshot != null && pendingTargetSnapshot == null) {
    return null;
  }
  if (pendingTargetProgramId == null && (pendingEquipmentTargets != null || pendingTargetSnapshot != null)) {
    return null;
  }
  const sourceText = acceptedSourceText(draft.sourceText);
  const payload = {
    version: ROUTINE_DRAFT_VERSION,
    userId: acceptedDraftUserId(draft.userId),
    scope: draft.scope,
    programId: draft.scope === 'new' || draft.scope === 'import' ? null : acceptedDraftProgramId(draft.programId ?? ''),
    review,
    updatedAt: draft.updatedAt,
    saveState: draft.saveState,
    confirmedProgramId,
    saveRequestId,
    pendingTargetProgramId,
    pendingEquipmentTargets,
    pendingTargetSnapshot,
    ...(sourceText == null ? {} : { sourceText }),
  };
  const encoded = JSON.stringify(payload);
  return encoded.length <= ROUTINE_DRAFT_MAX_CHARS ? encoded : null;
}

export function decodeRoutineDraft(raw: string): LocalRoutineDraft | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > ROUTINE_DRAFT_MAX_CHARS) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== ROUTINE_DRAFT_VERSION) {
    return null;
  }
  const userId = typeof record.userId === 'string' ? acceptedDraftUserId(record.userId) : null;
  const scope = record.scope === 'new' || record.scope === 'edit' || record.scope === 'import' ? record.scope : null;
  const programId =
    record.programId == null
      ? null
      : typeof record.programId === 'string'
        ? acceptedDraftProgramId(record.programId)
        : null;
  const saveState =
    record.saveState === 'editing' || record.saveState === 'saving' || record.saveState === 'confirmed'
      ? record.saveState
      : null;
  const review = sanitizeReview(record.review);
  const updatedAt = typeof record.updatedAt === 'string' && validTimestamp(record.updatedAt) ? record.updatedAt : null;
  const confirmedProgramId =
    record.confirmedProgramId == null
      ? null
      : typeof record.confirmedProgramId === 'string'
        ? acceptedDraftProgramId(record.confirmedProgramId)
        : null;
  if (!userId || !scope || !saveState || !review || !updatedAt) {
    return null;
  }
  if ((scope === 'new' || scope === 'import') && programId != null) {
    return null;
  }
  if (scope === 'edit' && programId == null) {
    return null;
  }
  if ((record.programId != null && programId == null) || (record.confirmedProgramId != null && confirmedProgramId == null)) {
    return null;
  }
  if (saveState === 'confirmed' && confirmedProgramId == null) {
    return null;
  }
  if (saveState !== 'confirmed' && confirmedProgramId != null) {
    return null;
  }
  let saveRequestId: string | null = null;
  if (record.saveRequestId != null) {
    if (typeof record.saveRequestId !== 'string') {
      return null;
    }
    saveRequestId = acceptedSaveRequestId(record.saveRequestId);
    if (saveRequestId == null) {
      return null;
    }
  }
  let pendingTargetProgramId: string | null = null;
  if (record.pendingTargetProgramId != null) {
    if (typeof record.pendingTargetProgramId !== 'string') {
      return null;
    }
    pendingTargetProgramId = acceptedDraftProgramId(record.pendingTargetProgramId);
    if (pendingTargetProgramId == null) {
      return null;
    }
  }
  if (saveState === 'confirmed' && pendingTargetProgramId != null) {
    return null;
  }
  let pendingEquipmentTargets: SavedEquipmentTargetRow[] | null = null;
  if (record.pendingEquipmentTargets != null) {
    pendingEquipmentTargets = acceptedSavedEquipmentTargetRows(record.pendingEquipmentTargets);
  }
  let pendingTargetSnapshot: ProgramReview | null = null;
  if (record.pendingTargetSnapshot != null) {
    pendingTargetSnapshot = sanitizeReview(record.pendingTargetSnapshot);
  }
  if (pendingTargetProgramId == null) {
    pendingEquipmentTargets = null;
    pendingTargetSnapshot = null;
  }
  return {
    version: 1,
    userId,
    scope,
    programId,
    review,
    updatedAt,
    saveState,
    confirmedProgramId,
    saveRequestId,
    pendingTargetProgramId,
    pendingEquipmentTargets,
    pendingTargetSnapshot,
    sourceText: acceptedSourceText(record.sourceText),
  };
}

export function storeRoutineReview(input: {
  store: RoutineDraftStore;
  userId: string;
  scope: RoutineDraftScope;
  programId: string | null;
  review: ProgramReview;
  saveState: 'editing' | 'saving';
  serverReview?: ProgramReview | null;
  now?: string;
  saveRequestId?: string | null;
  pendingTargetProgramId?: string | null;
  pendingEquipmentTargets?: readonly SavedEquipmentTargetRow[] | null;
  pendingTargetSnapshot?: ProgramReview | null;
  sourceText?: string | null;
}): 'saved' | 'deleted' | 'rejected' {
  const key = routineDraftKey(input.userId, input.scope, input.programId);
  if (!key || (input.saveState !== 'editing' && input.saveState !== 'saving')) {
    return 'rejected';
  }
  const owner = acceptedDraftUserId(input.userId);
  const expectedProgramId = input.scope === 'new' || input.scope === 'import' ? null : acceptedDraftProgramId(input.programId ?? '');
  const existingRaw = input.store.read(key);
  const existing = existingRaw == null ? null : decodeRoutineDraft(existingRaw);
  let saveRequestId: string | null = null;
  if (input.saveRequestId !== undefined) {
    if (input.saveRequestId == null) {
      saveRequestId = null;
    } else {
      saveRequestId = acceptedSaveRequestId(input.saveRequestId);
      if (saveRequestId == null) {
        return 'rejected';
      }
    }
  } else if (
    existing &&
    owner &&
    existing.userId === owner &&
    existing.scope === input.scope &&
    existing.programId === expectedProgramId
  ) {
    saveRequestId = existing.saveRequestId;
  }
  let pendingTargetProgramId: string | null = null;
  if (input.pendingTargetProgramId !== undefined) {
    if (input.pendingTargetProgramId == null) {
      pendingTargetProgramId = null;
    } else {
      pendingTargetProgramId = acceptedDraftProgramId(input.pendingTargetProgramId);
      if (pendingTargetProgramId == null) {
        return 'rejected';
      }
    }
  } else if (
    existing &&
    owner &&
    existing.userId === owner &&
    existing.scope === input.scope &&
    existing.programId === expectedProgramId
  ) {
    pendingTargetProgramId = existing.pendingTargetProgramId;
  }
  const sameDraft =
    !!existing &&
    !!owner &&
    existing.userId === owner &&
    existing.scope === input.scope &&
    existing.programId === expectedProgramId;
  const pendingEquipmentTargets = keptEquipmentTargets(
    input.pendingEquipmentTargets,
    sameDraft ? existing?.pendingEquipmentTargets : null,
    pendingTargetProgramId == null,
  );
  const pendingTargetSnapshot = keptTargetSnapshot(
    input.pendingTargetSnapshot,
    sameDraft ? existing?.pendingTargetSnapshot : null,
    pendingTargetProgramId == null,
  );
  const sourceText =
    input.sourceText !== undefined
      ? acceptedSourceText(input.sourceText)
      : sameDraft
        ? existing?.sourceText ?? null
        : null;
  const blankNew = (input.scope === 'new' || input.scope === 'import') && !routineDraftHasContent(input.review);
  const unchangedEdit =
    input.scope === 'edit' && input.serverReview != null && reviewsEqual(input.review, input.serverReview);
  if ((blankNew || unchangedEdit) && pendingTargetProgramId == null) {
    try {
      input.store.delete(key);
    } catch {
      return 'rejected';
    }
    return 'deleted';
  }
  const encoded = encodeRoutineDraft({
    version: 1,
    userId: input.userId,
    scope: input.scope,
    programId: input.programId,
    review: input.review,
    updatedAt: input.now ?? new Date().toISOString(),
    saveState: input.saveState,
    confirmedProgramId: null,
    saveRequestId,
    pendingTargetProgramId,
    pendingEquipmentTargets,
    pendingTargetSnapshot,
    sourceText,
  });
  if (!encoded) {
    return 'rejected';
  }
  try {
    input.store.write(key, encoded);
  } catch {
    return 'rejected';
  }
  return 'saved';
}

export function resolveRoutineScreenDraft(input: {
  userId: string;
  scope: RoutineDraftScope;
  programId: string | null;
  storedRaw: string | null;
  serverReview: ProgramReview | null;
  firstProgramRetry?: boolean;
}): RoutineDraftResolution {
  const fallback = input.scope === 'edit' && input.serverReview ? input.serverReview : createManualProgramReview();
  const stored = input.storedRaw == null ? null : decodeRoutineDraft(input.storedRaw);
  const owner = acceptedDraftUserId(input.userId);
  if (!stored || !owner || stored.userId !== owner || stored.scope !== input.scope) {
    return openResolution(fallback, null, false);
  }
  const expectedProgramId =
    input.scope === 'new' || input.scope === 'import'
      ? null
      : input.programId == null
        ? null
        : acceptedDraftProgramId(input.programId);
  if (stored.programId !== expectedProgramId) {
    return openResolution(fallback, null, false);
  }
  if (stored.saveState === 'confirmed') {
    return openResolution(fallback, null, true);
  }
  if (stored.pendingTargetProgramId) {
    return {
      review: stored.pendingTargetSnapshot ?? stored.review,
      notice: ROUTINE_DRAFT_PARTIAL_TARGET_MESSAGE,
      dropStored: false,
      pendingTargetProgramId: stored.pendingTargetProgramId,
      pendingEquipmentTargets: stored.pendingEquipmentTargets,
      editingLocked: true,
      sourceText: stored.sourceText ?? null,
    };
  }
  if (input.scope === 'edit' && input.serverReview == null) {
    return openResolution(fallback, null, false);
  }
  if (input.scope === 'edit' && input.serverReview && reviewsEqual(stored.review, input.serverReview)) {
    return openResolution(input.serverReview, null, true);
  }
  if ((input.scope === 'new' || input.scope === 'import') && !routineDraftHasContent(stored.review)) {
    return openResolution(fallback, null, true);
  }
  return openResolution(
    stored.review,
    stored.saveState === 'saving'
      ? (stored.scope === 'new' || stored.scope === 'import') && stored.saveRequestId && input.firstProgramRetry
        ? ROUTINE_DRAFT_FIRST_SAVE_UNCONFIRMED_MESSAGE
        : ROUTINE_DRAFT_UNCONFIRMED_MESSAGE
      : ROUTINE_DRAFT_RESTORED_MESSAGE,
    false,
    stored.sourceText ?? null,
  );
}

export function claimRoutineSave(gate: RoutineSaveGate): boolean {
  if (gate.locked || gate.confirmedProgramId != null) {
    return false;
  }
  gate.locked = true;
  return true;
}

export function completeRoutineSave(input: {
  gate: RoutineSaveGate;
  result: { ok: true; programId: string } | { ok: false };
  store: RoutineDraftStore;
  userId: string | null;
  scope: RoutineDraftScope;
  programId: string | null;
  review: ProgramReview;
  serverReview?: ProgramReview | null;
  now?: string;
  pendingTargetProgramId?: string | null;
  pendingEquipmentTargets?: readonly SavedEquipmentTargetRow[] | null;
  pendingTargetSnapshot?: ProgramReview | null;
  sourceText?: string | null;
}): { confirmedProgramId: string | null; draftCleared: boolean } {
  if (!input.result.ok) {
    input.gate.locked = false;
    if (input.userId) {
      storeRoutineReview({
        store: input.store,
        userId: input.userId,
        scope: input.scope,
        programId: input.programId,
        review: input.review,
        saveState: 'editing',
        serverReview: input.serverReview,
        now: input.now,
        pendingTargetProgramId: input.pendingTargetProgramId,
        pendingEquipmentTargets: input.pendingEquipmentTargets,
        pendingTargetSnapshot: input.pendingTargetSnapshot,
        sourceText: input.sourceText,
      });
    }
    return { confirmedProgramId: null, draftCleared: false };
  }
  input.gate.confirmedProgramId = input.result.programId;
  const key = input.userId ? routineDraftKey(input.userId, input.scope, input.programId) : null;
  if (!key) {
    return { confirmedProgramId: input.result.programId, draftCleared: false };
  }
  try {
    input.store.delete(key);
    return { confirmedProgramId: input.result.programId, draftCleared: true };
  } catch {
    const tombstone = encodeRoutineDraft({
      version: 1,
      userId: input.userId ?? '',
      scope: input.scope,
      programId: input.programId,
      review: input.review,
      updatedAt: input.now ?? new Date().toISOString(),
      saveState: 'confirmed',
      confirmedProgramId: input.result.programId,
      saveRequestId: null,
      pendingTargetProgramId: null,
      pendingEquipmentTargets: null,
      pendingTargetSnapshot: null,
    });
    if (tombstone) {
      try {
        input.store.write(key, tombstone);
      } catch {
        return { confirmedProgramId: input.result.programId, draftCleared: false };
      }
    }
    return { confirmedProgramId: input.result.programId, draftCleared: false };
  }
}

function acceptedSourceText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > TEXT_MAX_CHARS) {
    return null;
  }
  return value;
}

function openResolution(
  review: ProgramReview,
  notice: string | null,
  dropStored: boolean,
  sourceText: string | null = null,
): RoutineDraftResolution {
  return {
    review,
    notice,
    dropStored,
    sourceText,
    pendingTargetProgramId: null,
    pendingEquipmentTargets: null,
    editingLocked: false,
  };
}

function keptEquipmentTargets(
  incoming: readonly SavedEquipmentTargetRow[] | null | undefined,
  existing: SavedEquipmentTargetRow[] | null | undefined,
  clear: boolean,
): SavedEquipmentTargetRow[] | null {
  if (clear) {
    return null;
  }
  if (incoming !== undefined) {
    if (incoming == null) {
      return null;
    }
    return acceptedSavedEquipmentTargetRows(incoming);
  }
  return existing ?? null;
}

function keptTargetSnapshot(
  incoming: ProgramReview | null | undefined,
  existing: ProgramReview | null | undefined,
  clear: boolean,
): ProgramReview | null {
  if (clear) {
    return null;
  }
  if (incoming !== undefined) {
    if (incoming == null) {
      return null;
    }
    return sanitizeReview(incoming);
  }
  return existing ?? null;
}

function offlineText(error: unknown): string {
  if (typeof error === 'string') {
    return error.toLowerCase();
  }
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.toLowerCase();
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message.toLowerCase() : '';
  }
  return '';
}

function validTimestamp(value: string): boolean {
  return value.length >= 20 && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function canonicalReview(review: ProgramReview): string {
  const sanitized = sanitizeReview(review);
  return JSON.stringify(sanitized ?? review);
}

function sanitizeReview(value: unknown): ProgramReview | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.origin !== 'string' || !ORIGINS.has(record.origin as ProgramReviewOrigin)) {
    return null;
  }
  if (typeof record.programName !== 'string' || record.programName.length > PROGRAM_NAME_MAX) {
    return null;
  }
  if (!Array.isArray(record.days) || record.days.length > SCHEMA_MAX_DAYS) {
    return null;
  }
  const days: ReviewDay[] = [];
  let exerciseCount = 0;
  for (const dayValue of record.days) {
    const day = sanitizeDay(dayValue);
    if (!day) {
      return null;
    }
    exerciseCount += day.exercises.length;
    if (exerciseCount > MAX_EXERCISES) {
      return null;
    }
    days.push(day);
  }
  const issues = sanitizeIssues(record.issues);
  if (!issues) {
    return null;
  }
  const warnings = sanitizeWarnings(record.warnings);
  if (warnings === null) {
    return null;
  }
  return {
    origin: record.origin as ProgramReviewOrigin,
    programName: record.programName,
    days,
    issues,
    ...(warnings ? { warnings } : {}),
  };
}

function sanitizeDay(value: unknown): ReviewDay | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.name !== 'string' || record.name.length > DAY_NAME_MAX) {
    return null;
  }
  if (record.subtitle != null && (typeof record.subtitle !== 'string' || record.subtitle.length > TEXT_FIELD_MAX)) {
    return null;
  }
  if (!Array.isArray(record.exercises) || record.exercises.length > MAX_EXERCISES_PER_DAY) {
    return null;
  }
  const exercises: ReviewExercise[] = [];
  for (const exerciseValue of record.exercises) {
    const exercise = sanitizeExercise(exerciseValue);
    if (!exercise) {
      return null;
    }
    exercises.push(exercise);
  }
  const storedDayId = optionalStoredId(record.storedDayId);
  if (storedDayId === undefined) {
    return null;
  }
  return {
    name: record.name,
    subtitle: record.subtitle ?? null,
    exercises,
    ...(storedDayId != null ? { storedDayId } : {}),
  };
}

function sanitizeExercise(value: unknown): ReviewExercise | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.source !== 'manual' && record.source !== 'imported') {
    return null;
  }
  if (record.sourceName != null && (typeof record.sourceName !== 'string' || record.sourceName.length > SOURCE_NAME_MAX)) {
    return null;
  }
  if (typeof record.matchStatus !== 'string' || !MATCHES.has(record.matchStatus as PreviewMatchStatus)) {
    return null;
  }
  const exerciseId = optionalExerciseId(record.exerciseId);
  const sets = sanitizeNumber(record.sets, SETS_MIN, SETS_MAX);
  const repsMin = sanitizeNumber(record.repsMin, REPS_MIN, REPS_MAX);
  const repsMax = sanitizeNumber(record.repsMax, REPS_MIN, REPS_MAX);
  const restSeconds = sanitizeNumber(record.restSeconds, REST_MIN, REST_MAX);
  if (exerciseId === undefined || !sets || !repsMin || !repsMax || !restSeconds) {
    return null;
  }
  if (record.notes != null && (typeof record.notes !== 'string' || record.notes.length > NOTE_EDIT_MAX)) {
    return null;
  }
  if (record.loadMode != null && !isLoadMode(record.loadMode)) {
    return null;
  }
  const weight = record.weight == null ? null : sanitizeNumber(record.weight, WEIGHT_MIN, WEIGHT_MAX, true);
  if (record.weight != null && !weight) {
    return null;
  }
  const plannedWeightUnit = optionalUnit(record.plannedWeightUnit);
  if (plannedWeightUnit === undefined) {
    return null;
  }
  const equipmentTargets =
    record.equipmentTargets == null ? null : sanitizeEquipmentTargets(record.equipmentTargets);
  return {
    source: record.source,
    sourceName: typeof record.sourceName === 'string' ? record.sourceName : null,
    exerciseId,
    matchStatus: record.matchStatus as PreviewMatchStatus,
    sets,
    repsMin,
    repsMax,
    restSeconds,
    notes: typeof record.notes === 'string' ? record.notes : null,
    loadMode: isLoadMode(record.loadMode) ? record.loadMode : null,
    ...(weight ? { weight } : {}),
    ...(plannedWeightUnit !== null ? { plannedWeightUnit } : {}),
    ...(equipmentTargets ? { equipmentTargets } : {}),
  };
}

function sanitizeNumber(value: unknown, min: number, max: number, allowDecimal = false): PreviewNumber | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.acceptance !== 'string' || !ACCEPTANCES.has(record.acceptance as Acceptance)) {
    return null;
  }
  if (record.value != null && !numberInRange(record.value, min, max, allowDecimal)) {
    return null;
  }
  if (record.suggestion != null && !numberInRange(record.suggestion, min, max, allowDecimal)) {
    return null;
  }
  const number: PreviewNumber = {
    acceptance: record.acceptance as Acceptance,
    value: typeof record.value === 'number' ? record.value : null,
  };
  if (record.suggestion != null || record.suggestion === null) {
    number.suggestion = typeof record.suggestion === 'number' ? record.suggestion : null;
  }
  return number;
}

function numberInRange(value: unknown, min: number, max: number, allowDecimal: boolean): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (allowDecimal || Number.isInteger(value)) &&
    value >= min &&
    value <= max
  );
}

function sanitizeIssues(value: unknown): ImportPreviewIssue[] | null {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 50) {
    return null;
  }
  const issues: ImportPreviewIssue[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      return null;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.path !== 'string' || record.path.length > 200 || typeof record.code !== 'string' || record.code.length > 80) {
      return null;
    }
    if (record.message != null && (typeof record.message !== 'string' || record.message.length > 400)) {
      return null;
    }
    issues.push({
      path: record.path,
      code: record.code,
      ...(typeof record.message === 'string' ? { message: record.message } : {}),
    });
  }
  return issues;
}

function sanitizeWarnings(value: unknown): string[] | null | undefined {
  if (value == null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > 20) {
    return null;
  }
  const warnings: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length > WARNING_MAX_CHARS) {
      return null;
    }
    warnings.push(item);
  }
  return warnings;
}

function optionalStoredId(value: unknown): string | null | undefined {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  return acceptedDraftProgramId(value);
}

function optionalExerciseId(value: unknown): string | number | null | undefined {
  if (value == null) {
    return null;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && acceptedDraftProgramId(value)) {
    return value;
  }
  return undefined;
}

function optionalUnit(value: unknown): 'lb' | 'kg' | null | undefined {
  if (value == null) {
    return null;
  }
  if (value === 'lb' || value === 'kg') {
    return value;
  }
  return undefined;
}
