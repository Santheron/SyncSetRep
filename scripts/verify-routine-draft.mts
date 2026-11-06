import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  applyManualEdit,
  applyManualNumber,
  saveManualProgram,
  saveOwnedProgramEdit,
} from '../lib/import/manual-program.ts';
import {
  claimRoutineSave,
  completeRoutineSave,
  createMemoryRoutineDraftStore,
  createRoutineSaveGate,
  decodeRoutineDraft,
  resolveRoutineScreenDraft,
  routineDraftFileName,
  routineDraftKey,
  prepareRoutineSaveRequestId,
  ROUTINE_DRAFT_FIRST_SAVE_UNCONFIRMED_MESSAGE,
  ROUTINE_DRAFT_RESTORED_MESSAGE,
  ROUTINE_DRAFT_UNCONFIRMED_MESSAGE,
  ROUTINE_SAVE_OFFLINE_MESSAGE,
  snapshotRoutineDraftStore,
  storedRoutineSaveRequestId,
  storeRoutineReview,
  type RoutineDraftStore,
} from '../lib/import/routine-draft.ts';
import { createManualProgramReview, setExercisePlannedUnit, setExercisePlannedWeight, type ProgramReview } from '../lib/import/review-editor.ts';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER = '22222222-2222-2222-2222-222222222222';
const NOW = '2026-11-05T12:00:00.000Z';

function readyReview(): ProgramReview {
  let review = createManualProgramReview();
  review = applyManualEdit(review, { type: 'rename-program', name: 'Home Routine' }).review;
  review = applyManualEdit(review, { type: 'rename-day', dayIndex: 0, name: 'Push' }).review;
  review = applyManualEdit(review, { type: 'add-exercise', dayIndex: 0 }).review;
  review = applyManualEdit(review, {
    type: 'choose-exercise',
    dayIndex: 0,
    exerciseIndex: 0,
    exerciseId: '12',
  }).review;
  review = applyManualNumber(review, { dayIndex: 0, exerciseIndex: 0, field: 'sets', raw: '4' }).review;
  review = applyManualNumber(review, { dayIndex: 0, exerciseIndex: 0, field: 'repsMin', raw: '8' }).review;
  review = applyManualNumber(review, { dayIndex: 0, exerciseIndex: 0, field: 'repsMax', raw: '12' }).review;
  return review;
}

function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

const draftSource = source('lib/import/routine-draft.ts');
const fileSource = source('lib/import/routine-draft-file.ts');
const screenSource = source('app/(tabs)/program/build.tsx');
for (const token of [
  'save_owned_program',
  'save_imported_program',
  'update_owned_program',
  'save_manual_program',
  'record_tracked_set',
  'workout_sessions',
  'workout_sets',
  'supabase',
]) {
  assert.equal(draftSource.includes(token), false, token);
  assert.equal(fileSource.includes(token), false, token);
  assert.equal(screenSource.includes(token), false, token);
}
assert.equal(fileSource.includes('Paths.document'), true);
assert.equal(fileSource.includes('Paths.cache'), false);
assert.equal(screenSource.includes('resolveRoutineScreenDraft'), true);
assert.equal(screenSource.includes('storeRoutineReview'), true);
assert.equal(screenSource.includes('runGuardedProgramSave'), true);
assert.equal(screenSource.includes('setSavedProgramId(result.programId)'), true);
assert.equal(screenSource.includes('setSavedProgramId(requestId'), false);
assert.equal(screenSource.includes('completeRoutineSave'), false);

const guardSource = source('lib/import/one-tap-import.ts');
for (const token of ['workout_sessions', 'workout_sets', 'supabase']) {
  assert.equal(guardSource.includes(token), false, token);
}
const guardBody = guardSource.slice(
  guardSource.indexOf('export async function runGuardedProgramSave'),
  guardSource.indexOf('function resolveImportedExercise'),
);
assert.ok(guardBody.indexOf('claimRoutineSave') < guardBody.indexOf('prepareRoutineSaveRequestId'));
assert.ok(guardBody.indexOf('prepareRoutineSaveRequestId') < guardBody.indexOf('remember('));
assert.ok(guardBody.indexOf('remember(') < guardBody.indexOf('await input.saveProgram'));
const afterSave = guardBody.slice(guardBody.indexOf('await input.saveProgram'));
assert.ok(afterSave.indexOf('finish(') > 0);
assert.equal(afterSave.includes("status: 'partial'"), true);
assert.equal(guardBody.includes("input.scope !== 'edit'"), true);
assert.equal(guardBody.includes('input.ownedProgramRpcEnabled && persistAttempt'), true);
assert.ok(guardBody.indexOf('routineSaveReadiness') < guardBody.indexOf('materializeCustomExercises'));
assert.equal(
  guardSource.slice(guardSource.indexOf('function remember'), guardSource.indexOf('function finish')).includes('storeRoutineReview'),
  true,
);
assert.equal(
  guardSource.slice(guardSource.indexOf('function finish'), guardSource.indexOf('function offlineText')).includes('completeRoutineSave'),
  true,
);
const retryBody = guardSource.slice(guardSource.indexOf('async function retryPendingEquipmentTargets'));
assert.equal(retryBody.includes('input.saveProgram'), false);
assert.equal(retryBody.includes('input.createCustom'), false);
assert.equal(retryBody.includes('prepareRoutineForSave'), false);
assert.equal(retryBody.includes('locateSavedRows'), false);

const saveNew = screenSource.slice(
  screenSource.indexOf('async function saveNewRoutine'),
  screenSource.indexOf('if (!localReady'),
);
assert.match(saveNew, /saveManualProgramForCurrentUser\(next, \{ clientRequestId \}\)/);
assert.equal(saveNew.includes('setSavedProgramId(result.programId)'), true);
assert.equal(saveNew.includes('setSavedProgramId(null)'), true);
assert.equal(saveNew.includes('setSavedProgramId(requestId'), false);
const saveEdit = screenSource.slice(
  screenSource.indexOf('async function saveEditedRoutine'),
  screenSource.indexOf('async function saveNewRoutine'),
);
assert.match(saveEdit, /saveOwnedProgramEditForCurrentUser\(next, \{ programId: programAtSave \}\)/);
assert.equal(saveEdit.includes('clientRequestId'), false);
assert.equal(saveEdit.includes('setSavedProgramId(result.programId)'), true);
assert.equal(saveEdit.includes('setSavedProgramId(null)'), true);

const review = readyReview();
const key = routineDraftKey(USER_ID, 'new', null);
assert.ok(key);
assert.equal(routineDraftFileName(key), `${key}.json`);
assert.equal(routineDraftKey('not-a-user', 'new', null), null);
assert.equal(routineDraftKey(USER_ID, 'edit', null), null);
assert.equal(routineDraftKey(USER_ID, 'edit', '15'), `routine-draft_${USER_ID}_edit_15`);
assert.equal(routineDraftKey(USER_ID, 'new', '15'), null);

const store = createMemoryRoutineDraftStore();
assert.equal(
  storeRoutineReview({
    store,
    userId: USER_ID,
    scope: 'new',
    programId: null,
    review: createManualProgramReview(),
    saveState: 'editing',
    now: NOW,
  }),
  'deleted',
);
assert.equal(store.read(key), null);

assert.equal(
  storeRoutineReview({
    store,
    userId: USER_ID,
    scope: 'new',
    programId: null,
    review,
    saveState: 'editing',
    now: NOW,
  }),
  'saved',
);
const restarted = createMemoryRoutineDraftStore(snapshotRoutineDraftStore(store, [key]));
const restored = resolveRoutineScreenDraft({
  userId: USER_ID,
  scope: 'new',
  programId: null,
  storedRaw: restarted.read(key),
  serverReview: null,
});
assert.equal(restored.notice, ROUTINE_DRAFT_RESTORED_MESSAGE);
assert.equal(restored.review.programName, 'Home Routine');
assert.equal(restored.review.days[0]?.exercises[0]?.exerciseId, '12');
assert.equal(restored.dropStored, false);

const otherUser = resolveRoutineScreenDraft({
  userId: OTHER_USER,
  scope: 'new',
  programId: null,
  storedRaw: restarted.read(key),
  serverReview: null,
});
assert.equal(otherUser.review.programName, '');
assert.equal(otherUser.notice, null);
assert.equal(otherUser.dropStored, false);

const editServer = readyReview();
const editLocal = applyManualEdit(editServer, { type: 'rename-program', name: 'Changed on phone' }).review;
const editKey = routineDraftKey(USER_ID, 'edit', '15');
assert.ok(editKey);
assert.equal(
  storeRoutineReview({
    store,
    userId: USER_ID,
    scope: 'edit',
    programId: '15',
    review: editLocal,
    saveState: 'editing',
    serverReview: editServer,
    now: NOW,
  }),
  'saved',
);
let recoveryRpcCalls = 0;
const editResolved = resolveRoutineScreenDraft({
  userId: USER_ID,
  scope: 'edit',
  programId: '15',
  storedRaw: store.read(editKey),
  serverReview: editServer,
});
assert.equal(recoveryRpcCalls, 0);
assert.equal(editResolved.review.programName, 'Changed on phone');
assert.equal(editResolved.notice, ROUTINE_DRAFT_RESTORED_MESSAGE);
const crossed = resolveRoutineScreenDraft({
  userId: USER_ID,
  scope: 'edit',
  programId: '15',
  storedRaw: store.read(key),
  serverReview: editServer,
});
assert.equal(crossed.review.programName, 'Home Routine');
assert.equal(crossed.notice, null);
assert.equal(
  storeRoutineReview({
    store,
    userId: USER_ID,
    scope: 'edit',
    programId: '15',
    review: editServer,
    saveState: 'editing',
    serverReview: editServer,
    now: NOW,
  }),
  'deleted',
);
assert.equal(store.read(editKey), null);

assert.equal(decodeRoutineDraft('{"version":2}'), null);
assert.equal(decodeRoutineDraft('{'), null);
assert.equal(decodeRoutineDraft('x'.repeat(1_000_001)), null);

const gate = createRoutineSaveGate();
let calls = 0;
let finishRpc: (value: { data: unknown; error: { message?: string | null } | null }) => void = () => {};
const rpcResult = new Promise<{ data: unknown; error: { message?: string | null } | null }>((resolve) => {
  finishRpc = resolve;
});

async function saveWithGate(target: RoutineDraftStore) {
  if (!claimRoutineSave(gate)) {
    return { started: false as const };
  }
  storeRoutineReview({
    store: target,
    userId: USER_ID,
    scope: 'new',
    programId: null,
    review,
    saveState: 'saving',
    now: NOW,
  });
  const outcome = await saveManualProgram(review, {
    userId: USER_ID,
    programs: [],
    ownedRpc: () => {
      calls += 1;
      return rpcResult;
    },
  });
  const completed = completeRoutineSave({
    gate,
    result: outcome,
    store: target,
    userId: USER_ID,
    scope: 'new',
    programId: null,
    review,
    now: NOW,
  });
  return { started: true as const, outcome, completed };
}

const firstSave = saveWithGate(store);
const secondSave = await saveWithGate(store);
assert.equal(secondSave.started, false);
assert.equal(calls, 1);
const interrupted = decodeRoutineDraft(store.read(key) ?? '');
assert.equal(interrupted?.saveState, 'saving');
assert.equal(gate.confirmedProgramId, null);
const afterRestart = resolveRoutineScreenDraft({
  userId: USER_ID,
  scope: 'new',
  programId: null,
  storedRaw: createMemoryRoutineDraftStore(snapshotRoutineDraftStore(store, [key])).read(key),
  serverReview: null,
});
assert.equal(afterRestart.notice, ROUTINE_DRAFT_UNCONFIRMED_MESSAGE);
assert.equal(afterRestart.review.programName, 'Home Routine');
assert.equal(recoveryRpcCalls, 0);

finishRpc({ data: null, error: { message: 'duplicate key value violates unique constraint' } });
const failed = await firstSave;
assert.equal(failed.started, true);
if (failed.started) {
  assert.equal(failed.outcome.ok, false);
  if (!failed.outcome.ok) {
    assert.equal(failed.outcome.errors[0], 'Could not save this routine. Nothing was saved.');
  }
  assert.equal(failed.completed.confirmedProgramId, null);
  assert.equal(failed.completed.draftCleared, false);
}
assert.equal(decodeRoutineDraft(store.read(key) ?? '')?.saveState, 'editing');
assert.equal(gate.locked, false);
assert.equal(calls, 1);

const offline = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [],
  ownedRpc: async () => {
    throw new TypeError('Network request failed');
  },
});
assert.equal(offline.ok, false);
if (!offline.ok) {
  assert.deepEqual(offline.errors, [ROUTINE_SAVE_OFFLINE_MESSAGE]);
}
const offlineMessage = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [],
  ownedRpc: async () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } }),
});
assert.equal(offlineMessage.ok, false);
if (!offlineMessage.ok) {
  assert.deepEqual(offlineMessage.errors, [ROUTINE_SAVE_OFFLINE_MESSAGE]);
}
assert.equal(decodeRoutineDraft(store.read(key) ?? '')?.programName ?? decodeRoutineDraft(store.read(key) ?? '')?.review.programName, 'Home Routine');

const offlineKept = completeRoutineSave({
  gate,
  result: offline,
  store,
  userId: USER_ID,
  scope: 'new',
  programId: null,
  review,
  now: NOW,
});
assert.equal(offlineKept.draftCleared, false);
assert.equal(store.read(key) == null, false);

let successCalls = 0;
const successGate = createRoutineSaveGate();
const successStore = createMemoryRoutineDraftStore();
async function succeed() {
  if (!claimRoutineSave(successGate)) {
    return false;
  }
  const outcome = await saveManualProgram(review, {
    userId: USER_ID,
    programs: [],
    ownedRpc: async () => {
      successCalls += 1;
      return { data: 70, error: null };
    },
  });
  const completed = completeRoutineSave({
    gate: successGate,
    result: outcome,
    store: successStore,
    userId: USER_ID,
    scope: 'new',
    programId: null,
    review,
    now: NOW,
  });
  return completed.confirmedProgramId;
}
assert.equal(await succeed(), '70');
assert.equal(await succeed(), false);
assert.equal(successCalls, 1);
assert.equal(successStore.read(routineDraftKey(USER_ID, 'new', null) ?? ''), null);
const missingId = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [],
  ownedRpc: async () => ({ data: null, error: null }),
});
assert.equal(missingId.ok, false);

const memory = createMemoryRoutineDraftStore();
const flaky: RoutineDraftStore = {
  read: (draftKey) => memory.read(draftKey),
  write: (draftKey, value) => memory.write(draftKey, value),
  delete() {
    throw new Error('disk');
  },
};
storeRoutineReview({
  store: memory,
  userId: USER_ID,
  scope: 'new',
  programId: null,
  review,
  saveState: 'saving',
  now: NOW,
});
const tombstoneGate = createRoutineSaveGate();
assert.equal(claimRoutineSave(tombstoneGate), true);
const tombstone = completeRoutineSave({
  gate: tombstoneGate,
  result: { ok: true, programId: '70' },
  store: flaky,
  userId: USER_ID,
  scope: 'new',
  programId: null,
  review,
  now: NOW,
});
assert.equal(tombstone.confirmedProgramId, '70');
assert.equal(tombstone.draftCleared, false);
assert.equal(decodeRoutineDraft(memory.read(key) ?? '')?.saveState, 'confirmed');
const confirmed = resolveRoutineScreenDraft({
  userId: USER_ID,
  scope: 'new',
  programId: null,
  storedRaw: memory.read(key),
  serverReview: null,
});
assert.equal(confirmed.dropStored, true);
assert.equal(confirmed.notice, null);
assert.equal(confirmed.review.programName, '');
assert.equal(tombstoneGate.locked, true);
assert.equal(claimRoutineSave(tombstoneGate), false);

const editSave = await saveOwnedProgramEdit(editLocal, {
  userId: USER_ID,
  programId: '15',
  rpc: async () => {
    throw new TypeError('Network request failed');
  },
});
assert.equal(editSave.ok, false);
if (!editSave.ok) {
  assert.deepEqual(editSave.errors, [ROUTINE_SAVE_OFFLINE_MESSAGE]);
}

const REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

assert.equal(
  storeRoutineReview({
    store,
    userId: USER_ID,
    scope: 'new',
    programId: null,
    review,
    saveState: 'saving',
    saveRequestId: REQUEST_ID,
    now: NOW,
  }),
  'saved',
);
assert.equal(storedRoutineSaveRequestId(store.read(key)), REQUEST_ID);
assert.equal(
  storeRoutineReview({
    store,
    userId: USER_ID,
    scope: 'new',
    programId: null,
    review,
    saveState: 'editing',
    now: NOW,
  }),
  'saved',
);
assert.equal(decodeRoutineDraft(store.read(key) ?? '')?.saveRequestId, REQUEST_ID);
assert.equal(prepareRoutineSaveRequestId(store.read(key), () => OTHER_REQUEST_ID), REQUEST_ID);
const switchedAccount = resolveRoutineScreenDraft({
  userId: OTHER_USER,
  scope: 'new',
  programId: null,
  storedRaw: store.read(key),
  serverReview: null,
  firstProgramRetry: true,
});
assert.equal(switchedAccount.review.programName, '');
assert.equal(switchedAccount.notice, null);
assert.equal(storedRoutineSaveRequestId(store.read(routineDraftKey(OTHER_USER, 'new', null) ?? '')), null);
assert.equal(prepareRoutineSaveRequestId(null, () => OTHER_REQUEST_ID), OTHER_REQUEST_ID);
const firstRetry = resolveRoutineScreenDraft({
  userId: USER_ID,
  scope: 'new',
  programId: null,
  storedRaw: store.read(key),
  serverReview: null,
  firstProgramRetry: true,
});
assert.equal(firstRetry.notice, ROUTINE_DRAFT_RESTORED_MESSAGE);
storeRoutineReview({
  store,
  userId: USER_ID,
  scope: 'new',
  programId: null,
  review,
  saveState: 'saving',
  now: NOW,
});
assert.equal(
  resolveRoutineScreenDraft({
    userId: USER_ID,
    scope: 'new',
    programId: null,
    storedRaw: store.read(key),
    serverReview: null,
    firstProgramRetry: true,
  }).notice,
  ROUTINE_DRAFT_FIRST_SAVE_UNCONFIRMED_MESSAGE,
);

const serverPrograms = new Map<string, { id: string; name: string }>();
let serverInserts = 0;
function serverSave(userId: string, args: { p_program: { name?: string; client_request_id?: string } }, crashAfterCommit: boolean) {
  const requestKey = `${userId}:${args.p_program.client_request_id ?? ''}`;
  const existing = args.p_program.client_request_id ? serverPrograms.get(requestKey) : undefined;
  if (existing) {
    return { data: existing.id, error: null };
  }
  serverInserts += 1;
  const saved = { id: String(80 + serverInserts), name: args.p_program.name ?? '' };
  if (args.p_program.client_request_id) {
    serverPrograms.set(requestKey, saved);
  }
  if (crashAfterCommit) {
    throw new TypeError('Network request failed');
  }
  return { data: saved.id, error: null };
}

const crashStore = createMemoryRoutineDraftStore();
const crashGate = createRoutineSaveGate();
const crashKey = routineDraftKey(USER_ID, 'new', null);
assert.ok(crashKey);
assert.equal(claimRoutineSave(crashGate), true);
storeRoutineReview({
  store: crashStore,
  userId: USER_ID,
  scope: 'new',
  programId: null,
  review,
  saveState: 'saving',
  saveRequestId: REQUEST_ID,
  now: NOW,
});
const crashed = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [],
  clientRequestId: REQUEST_ID,
  ownedRpc: async (args) => serverSave(USER_ID, args, true),
});
assert.equal(crashed.ok, false);
if (!crashed.ok) {
  assert.deepEqual(crashed.errors, [ROUTINE_SAVE_OFFLINE_MESSAGE]);
}
const crashCompleted = completeRoutineSave({
  gate: crashGate,
  result: crashed,
  store: crashStore,
  userId: USER_ID,
  scope: 'new',
  programId: null,
  review,
  now: NOW,
});
assert.equal(crashCompleted.confirmedProgramId, null);
assert.equal(decodeRoutineDraft(crashStore.read(crashKey) ?? '')?.saveRequestId, REQUEST_ID);
assert.equal(serverInserts, 1);
const retryGate = createRoutineSaveGate();
assert.equal(claimRoutineSave(retryGate), true);
const retried = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [{ id: '81', name: 'Home Routine', isActive: true }],
  clientRequestId: REQUEST_ID,
  ownedRpc: async (args) => serverSave(USER_ID, args, false),
});
assert.deepEqual(retried, { ok: true, programId: '81' });
assert.equal(serverInserts, 1);
const retryCompleted = completeRoutineSave({
  gate: retryGate,
  result: retried,
  store: crashStore,
  userId: USER_ID,
  scope: 'new',
  programId: null,
  review,
  now: NOW,
});
assert.equal(retryCompleted.confirmedProgramId, '81');
const otherAccount = await saveManualProgram(review, {
  userId: OTHER_USER,
  programs: [],
  clientRequestId: REQUEST_ID,
  ownedRpc: async (args) => serverSave(OTHER_USER, args, false),
});
assert.deepEqual(otherAccount, { ok: true, programId: '82' });
assert.equal(serverPrograms.get(`${USER_ID}:${REQUEST_ID}`)?.name, 'Home Routine');

const interruptedStore = createMemoryRoutineDraftStore();
const interruptedGate = createRoutineSaveGate();
assert.equal(claimRoutineSave(interruptedGate), true);
storeRoutineReview({
  store: interruptedStore,
  userId: USER_ID,
  scope: 'new',
  programId: null,
  review,
  saveState: 'saving',
  saveRequestId: OTHER_REQUEST_ID,
  now: NOW,
});
const interruptedSave = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [],
  clientRequestId: OTHER_REQUEST_ID,
  ownedRpc: async () => {
    throw new TypeError('Network request failed');
  },
});
assert.equal(interruptedSave.ok, false);
completeRoutineSave({
  gate: interruptedGate,
  result: interruptedSave,
  store: interruptedStore,
  userId: USER_ID,
  scope: 'new',
  programId: null,
  review,
  now: NOW,
});
assert.equal(decodeRoutineDraft(interruptedStore.read(crashKey) ?? '')?.saveRequestId, OTHER_REQUEST_ID);
assert.equal(serverPrograms.has(`${USER_ID}:${OTHER_REQUEST_ID}`), false);
let interruptedInserts = 0;
const interruptedRetry = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [],
  clientRequestId: OTHER_REQUEST_ID,
  ownedRpc: async (args) => {
    interruptedInserts += 1;
    assert.equal(args.p_program.client_request_id, OTHER_REQUEST_ID);
    return { data: 90, error: null };
  },
});
assert.deepEqual(interruptedRetry, { ok: true, programId: '90' });
assert.equal(interruptedInserts, 1);

const weighted = setExercisePlannedUnit(
  setExercisePlannedWeight(review, 0, 0, 135.5),
  0,
  0,
  'lb',
);
let weightedPayload: { client_request_id?: string; days: Array<{ exercises: Array<Record<string, unknown>> }> } | null = null;
const weightedSave = await saveManualProgram(weighted, {
  userId: USER_ID,
  programs: [],
  clientRequestId: REQUEST_ID,
  persistPlannedWeight: true,
  ownedRpc: async (args) => {
    weightedPayload = args.p_program;
    return { data: 91, error: null };
  },
});
assert.equal(weightedSave.ok, true);
assert.equal(weightedPayload?.client_request_id, REQUEST_ID);
assert.equal(weightedPayload?.days[0]?.exercises[0]?.planned_weight, 135.5);
assert.equal(weightedPayload?.days[0]?.exercises[0]?.planned_weight_unit, 'lb');

let plainPayload = '';
const plainSave = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [],
  ownedRpc: async (args) => {
    plainPayload = JSON.stringify(args.p_program);
    return { data: 92, error: null };
  },
});
assert.equal(plainSave.ok, true);
assert.equal(plainPayload.includes('planned_weight'), false);
assert.equal(plainPayload.includes('client_request_id'), false);

let importedCalls = 0;
let ownedCalls = 0;
const additional = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [{ id: '1', name: 'Current', isActive: true }],
  rpc: async () => {
    importedCalls += 1;
    return { data: '15', error: null };
  },
  ownedRpc: async () => {
    ownedCalls += 1;
    return { data: 15, error: null };
  },
});
assert.deepEqual(additional, { ok: true, programId: '15' });
assert.equal(importedCalls, 1);
assert.equal(ownedCalls, 0);

const ownedWithoutServer = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [],
  clientRequestId: REQUEST_ID,
});
assert.equal(ownedWithoutServer.ok, false);
const badKey = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [],
  clientRequestId: 'not-a-uuid',
  ownedRpc: async () => {
    throw new Error('rpc should not run');
  },
});
assert.equal(badKey.ok, false);

const preserved = createMemoryRoutineDraftStore();
const preservedKey = routineDraftKey(USER_ID, 'new', null) ?? '';
const frozenTargets = [
  {
    dayOrder: 1,
    exerciseOrder: 1,
    programExerciseId: null,
    targets: [{ equipment: 'machine' as const, weight: 80, unit: 'lb' as const }],
  },
];
assert.equal(
  storeRoutineReview({
    store: preserved,
    userId: USER_ID,
    scope: 'new',
    programId: null,
    review,
    saveState: 'editing',
    now: NOW,
    pendingTargetProgramId: '9',
    pendingEquipmentTargets: frozenTargets,
    pendingTargetSnapshot: review,
  }),
  'saved',
);
const renamed = applyManualEdit(review, { type: 'rename-program', name: 'Moved Routine' }).review;
assert.equal(
  storeRoutineReview({
    store: preserved,
    userId: USER_ID,
    scope: 'new',
    programId: null,
    review: renamed,
    saveState: 'editing',
    now: NOW,
  }),
  'saved',
);
const keptMapping = decodeRoutineDraft(preserved.read(preservedKey) ?? '');
assert.equal(keptMapping?.pendingTargetProgramId, '9');
assert.equal(keptMapping?.review.programName, 'Moved Routine');
assert.equal(keptMapping?.pendingTargetSnapshot?.programName, 'Home Routine');
assert.equal(keptMapping?.pendingEquipmentTargets?.[0]?.dayOrder, 1);
assert.equal(keptMapping?.pendingEquipmentTargets?.[0]?.exerciseOrder, 1);
assert.equal(keptMapping?.pendingEquipmentTargets?.[0]?.targets[0]?.weight, 80);
const lockedRecovery = resolveRoutineScreenDraft({
  userId: USER_ID,
  scope: 'new',
  programId: null,
  storedRaw: preserved.read(preservedKey),
  serverReview: null,
});
assert.equal(lockedRecovery.editingLocked, true);
assert.equal(lockedRecovery.review.programName, 'Home Routine');
assert.equal(lockedRecovery.pendingEquipmentTargets?.[0]?.targets[0]?.equipment, 'machine');
const damagedRows = JSON.parse(preserved.read(preservedKey) ?? '{}') as Record<string, unknown>;
damagedRows.pendingEquipmentTargets = [
  { dayOrder: 1, exerciseOrder: 1, programExerciseId: '9', targets: frozenTargets[0]?.targets },
  { dayOrder: 1, exerciseOrder: 1, programExerciseId: null, targets: frozenTargets[0]?.targets },
];
const damagedMapping = decodeRoutineDraft(JSON.stringify(damagedRows));
assert.notEqual(damagedMapping, null);
assert.equal(damagedMapping?.pendingTargetProgramId, '9');
assert.equal(damagedMapping?.pendingEquipmentTargets, null);
const restartedMapping = createMemoryRoutineDraftStore(snapshotRoutineDraftStore(preserved, [preservedKey]));
assert.equal(
  decodeRoutineDraft(restartedMapping.read(preservedKey) ?? '')?.pendingEquipmentTargets?.[0]?.targets[0]?.weight,
  80,
);

console.log('routine draft checks passed');
