import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { IMPORT_ENABLED } from '../lib/import/flags.ts';
import {
  DAY_NAME_MAX,
  MAX_DAYS,
  MAX_EXERCISES,
  MAX_EXERCISES_PER_DAY,
  NOTE_EDIT_MAX,
  PROGRAM_NAME_MAX,
  TEXT_FIELD_MAX,
} from '../lib/import/limits.ts';
import {
  applyManualEdit,
  applyManualNumber,
  exerciseChoiceText,
  filterCatalog,
  ALREADY_CURRENT_PROGRAM_MESSAGE,
  EDIT_SAVE_BLOCKED_MESSAGE,
  FIRST_PROGRAM_UNAVAILABLE_MESSAGE,
  hasCurrentProgram,
  MANUAL_CHOOSE_EXERCISE_MESSAGE,
  MANUAL_SAVE_UNAVAILABLE_MESSAGE,
  MANUAL_SETS_SAVE_MESSAGE,
  mergeExerciseChoices,
  previewProgramEdit,
  validateManualRoutine,
  MANUAL_REPS_MESSAGE,
  MANUAL_SAVE_ONCE_MESSAGE,
  MANUAL_SETS_MESSAGE,
  MANUAL_SIGN_IN_LIST_MESSAGE,
  MANUAL_SIGN_IN_SAVE_MESSAGE,
  MANUAL_SIGN_IN_SWITCH_MESSAGE,
  requestProgramSwitch,
  saveManualProgram,
  savedProgramListItems,
  toSavedPrograms,
  UNFINISHED_WORKOUT_SWITCH_MESSAGE,
  VIEW_SAVED_PROGRAMS_LABEL,
  type ManualEdit,
  type SavedProgramSummary,
} from '../lib/import/manual-program.ts';
import {
  ACTIVATION_RPC_ENABLED,
  MANUAL_SAVE_RPC_ENABLED,
  OWNED_PROGRAM_RPC_ENABLED,
  PROGRAM_SWITCH_UNAVAILABLE_MESSAGE,
  activateOwnedProgramForCurrentUser,
  loadExerciseCatalog,
  loadOwnedPrograms,
  loadProgramDraftForCurrentUser,
  saveManualProgramForCurrentUser,
} from '../lib/import/manual-program-client.ts';
import {
  CATALOG_TARGET_MAX,
  CATALOG_TARGET_MIN,
  CUSTOM_EXERCISE_WRITES_ENABLED,
  EQUIPMENT_TYPES,
  MUSCLE_GROUPS,
  PLANNED_EXERCISES,
  normalizeExerciseName,
} from '../lib/import/planned-exercises.ts';
import {
  assembleProgramDraft,
  draftIdentity,
  reviewFromProgramDraft,
} from '../lib/import/program-draft.ts';
import { createManualProgramReview, toImportPreview, type ProgramReview } from '../lib/import/review-editor.ts';
import {
  IMPORT_CAPACITY_MESSAGE,
  IMPORT_SIGN_IN_MESSAGE,
  IMPORT_UNRESOLVED_EXERCISE_MESSAGE,
} from '../lib/import/save-plan.ts';
import { buttonPaletteForSurface, contrastRatio } from '../lib/ui/button-contrast.ts';
import type { ImportSaveRpc } from '../lib/import/save-imported-program.ts';

const USER_ID = '11111111-1111-1111-1111-111111111111';

const originalFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error('fetch must not be called');
}) as typeof fetch;

type LoggedSession = { id: number; program_id: number; finished_at: string };
type LoggedSet = { id: number; session_id: number; reps: number };
type ActiveProgram = { id: number; user_id: string; name: string; is_active: true };
type History = {
  sessions: LoggedSession[];
  sets: LoggedSet[];
  active: ActiveProgram;
};

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function historySnapshot(): History {
  return {
    sessions: Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      program_id: 1,
      finished_at: '2026-10-01T00:00:00.000Z',
    })),
    sets: [
      { id: 1, session_id: 1, reps: 8 },
      { id: 2, session_id: 1, reps: 8 },
      { id: 3, session_id: 30, reps: 5 },
    ],
    active: {
      id: 1,
      user_id: USER_ID,
      name: 'Current split',
      is_active: true,
    },
  };
}

function edit(review: ProgramReview, change: ManualEdit): ProgramReview {
  const result = applyManualEdit(review, change);
  assert.equal(result.error, null, change.type);
  return result.review;
}

function number(
  review: ProgramReview,
  dayIndex: number,
  exerciseIndex: number,
  field: 'sets' | 'repsMin' | 'repsMax',
  raw: string,
): ProgramReview {
  const result = applyManualNumber(review, { dayIndex, exerciseIndex, field, raw });
  assert.equal(result.error, null, `${field} ${raw}`);
  return result.review;
}

function readyReview(): ProgramReview {
  let review = createManualProgramReview();
  review = edit(review, { type: 'rename-program', name: '  Home Routine  ' });
  review = edit(review, { type: 'rename-day', dayIndex: 0, name: 'Pull' });
  review = edit(review, { type: 'add-day' });
  review = edit(review, { type: 'rename-day', dayIndex: 1, name: 'Push' });
  review = edit(review, { type: 'set-subtitle', dayIndex: 1, subtitle: '  Upper  ' });
  review = edit(review, { type: 'add-exercise', dayIndex: 1 });
  review = edit(review, {
    type: 'choose-exercise',
    dayIndex: 1,
    exerciseIndex: 0,
    exerciseId: '12',
  });
  review = number(review, 1, 0, 'sets', '03');
  review = number(review, 1, 0, 'repsMin', '8');
  review = number(review, 1, 0, 'repsMax', '12');
  review = edit(review, {
    type: 'set-notes',
    dayIndex: 1,
    exerciseIndex: 0,
    notes: '  Pause  ',
  });
  review = edit(review, { type: 'add-exercise', dayIndex: 1 });
  review = edit(review, {
    type: 'choose-exercise',
    dayIndex: 1,
    exerciseIndex: 1,
    exerciseId: '4',
  });
  review = number(review, 1, 1, 'sets', '4');
  review = number(review, 1, 1, 'repsMin', '6');
  review = number(review, 1, 1, 'repsMax', '10');
  review = edit(review, {
    type: 'move-exercise',
    dayIndex: 1,
    exerciseIndex: 1,
    direction: 'up',
  });
  review = edit(review, { type: 'add-day' });
  review = edit(review, { type: 'rename-day', dayIndex: 2, name: 'Push' });
  review = edit(review, { type: 'move-day', dayIndex: 0, direction: 'down' });
  return review;
}

const currentProgram: SavedProgramSummary = {
  id: '1',
  name: 'Current split',
  isActive: true,
};

try {
  assert.equal(IMPORT_ENABLED, false);

  const review = readyReview();
  assert.deepEqual(
    review.days.map((day) => day.name),
    ['Push', 'Pull', 'Push'],
  );
  assert.equal(review.days[0]?.subtitle, '  Upper  ');
  assert.equal(review.days[1]?.exercises.length, 0);
  assert.equal(review.days[2]?.exercises.length, 0);
  assert.equal(review.days[0]?.exercises[0]?.exerciseId, '4');
  assert.equal(review.days[0]?.exercises[1]?.exerciseId, '12');
  const trackedReview = applyManualEdit(review, {
    type: 'set-load-mode',
    dayIndex: 0,
    exerciseIndex: 0,
    loadMode: 'assisted',
  });
  assert.equal(trackedReview.error, null);
  assert.equal(trackedReview.review.days[0]?.exercises[0]?.loadMode, 'assisted');
  assert.equal(trackedReview.review.days[0]?.exercises[1]?.loadMode ?? null, null);
  assert.equal(validateManualRoutine(trackedReview.review).ok, true);
  const trackedPreview = JSON.stringify(toImportPreview(trackedReview.review));
  assert.equal(trackedPreview.includes('loadMode'), false);
  assert.equal(trackedPreview.includes('load_mode'), false);
  assert.equal(review.days[0]?.exercises[1]?.sets.value, 3);
  assert.equal(review.days[0]?.exercises[1]?.sets.acceptance, 'user_entered');
  assert.equal(review.days[0]?.exercises[0]?.matchStatus, 'manual');

  const unchanged = review;
  const rejectedSets = applyManualNumber(review, {
    dayIndex: 0,
    exerciseIndex: 0,
    field: 'sets',
    raw: '13',
  });
  assert.equal(rejectedSets.review, unchanged);
  assert.equal(rejectedSets.error, MANUAL_SETS_MESSAGE);
  const rejectedZero = applyManualNumber(review, {
    dayIndex: 0,
    exerciseIndex: 0,
    field: 'sets',
    raw: '0',
  });
  assert.equal(rejectedZero.review, unchanged);
  assert.equal(rejectedZero.error, MANUAL_SETS_MESSAGE);
  const rejectedText = applyManualNumber(review, {
    dayIndex: 0,
    exerciseIndex: 0,
    field: 'repsMax',
    raw: '3abc',
  });
  assert.equal(rejectedText.review, unchanged);
  assert.equal(rejectedText.error, MANUAL_REPS_MESSAGE);
  const padded = applyManualNumber(review, {
    dayIndex: 0,
    exerciseIndex: 0,
    field: 'repsMax',
    raw: ' 10 ',
  });
  assert.equal(padded.error, null);
  assert.equal(padded.review.days[0]?.exercises[0]?.repsMax.value, 10);
  const cleared = applyManualNumber(padded.review, {
    dayIndex: 0,
    exerciseIndex: 0,
    field: 'repsMax',
    raw: '',
  });
  assert.equal(cleared.review.days[0]?.exercises[0]?.repsMax.value, null);

  const firstMove = applyManualEdit(review, {
    type: 'move-day',
    dayIndex: 0,
    direction: 'up',
  });
  assert.equal(firstMove.review, review);
  assert.equal(firstMove.error, null);

  let capped = createManualProgramReview();
  for (let index = 0; index < MAX_DAYS - 1; index += 1) {
    const added = applyManualEdit(capped, { type: 'add-day' });
    assert.equal(added.error, null);
    capped = added.review;
  }
  assert.equal(capped.days.length, MAX_DAYS);
  const overDays = applyManualEdit(capped, { type: 'add-day' });
  assert.equal(overDays.review, capped);
  assert.equal(overDays.error, IMPORT_CAPACITY_MESSAGE);

  let crowded = createManualProgramReview();
  for (let index = 0; index < MAX_EXERCISES_PER_DAY; index += 1) {
    const added = applyManualEdit(crowded, { type: 'add-exercise', dayIndex: 0 });
    assert.equal(added.error, null);
    crowded = added.review;
  }
  const overDay = applyManualEdit(crowded, { type: 'add-exercise', dayIndex: 0 });
  assert.equal(overDay.review, crowded);
  assert.equal(overDay.error, IMPORT_CAPACITY_MESSAGE);

  let total = createManualProgramReview();
  const fullDays = Math.floor(MAX_EXERCISES / MAX_EXERCISES_PER_DAY);
  for (let day = 0; day < fullDays; day += 1) {
    if (day > 0) {
      total = edit(total, { type: 'add-day' });
    }
    for (let exercise = 0; exercise < MAX_EXERCISES_PER_DAY; exercise += 1) {
      total = edit(total, { type: 'add-exercise', dayIndex: day });
    }
  }
  const remainder = MAX_EXERCISES - fullDays * MAX_EXERCISES_PER_DAY;
  total = edit(total, { type: 'add-day' });
  for (let exercise = 0; exercise < remainder; exercise += 1) {
    total = edit(total, { type: 'add-exercise', dayIndex: fullDays });
  }
  const overTotal = applyManualEdit(total, { type: 'add-exercise', dayIndex: fullDays });
  assert.equal(overTotal.review, total);
  assert.equal(overTotal.error, IMPORT_CAPACITY_MESSAGE);

  const longName = applyManualEdit(createManualProgramReview(), {
    type: 'rename-program',
    name: 'A'.repeat(PROGRAM_NAME_MAX + 1),
  });
  assert.equal(longName.review.programName.length, PROGRAM_NAME_MAX);
  const longDay = applyManualEdit(longName.review, {
    type: 'rename-day',
    dayIndex: 0,
    name: 'B'.repeat(DAY_NAME_MAX + 1),
  });
  assert.equal(longDay.review.days[0]?.name.length, DAY_NAME_MAX);
  const withExercise = edit(longDay.review, { type: 'add-exercise', dayIndex: 0 });
  const longNotes = applyManualEdit(withExercise, {
    type: 'set-notes',
    dayIndex: 0,
    exerciseIndex: 0,
    notes: 'C'.repeat(NOTE_EDIT_MAX + 1),
  });
  assert.equal(longNotes.review.days[0]?.exercises[0]?.notes?.length, NOTE_EDIT_MAX);
  const longSubtitle = applyManualEdit(longNotes.review, {
    type: 'set-subtitle',
    dayIndex: 0,
    subtitle: 'D'.repeat(TEXT_FIELD_MAX + 1),
  });
  assert.equal(longSubtitle.review.days[0]?.subtitle?.length, TEXT_FIELD_MAX);

  let removable = createManualProgramReview();
  removable = edit(removable, { type: 'add-day' });
  removable = edit(removable, { type: 'rename-day', dayIndex: 1, name: 'Legs' });
  removable = edit(removable, { type: 'remove-day', dayIndex: 0 });
  assert.deepEqual(
    removable.days.map((day) => day.name),
    ['Legs'],
  );
  removable = edit(removable, { type: 'add-exercise', dayIndex: 0 });
  removable = edit(removable, { type: 'add-exercise', dayIndex: 0 });
  removable = edit(removable, {
    type: 'choose-exercise',
    dayIndex: 0,
    exerciseIndex: 1,
    exerciseId: '7',
  });
  removable = edit(removable, { type: 'remove-exercise', dayIndex: 0, exerciseIndex: 0 });
  assert.equal(removable.days[0]?.exercises.length, 1);
  assert.equal(removable.days[0]?.exercises[0]?.exerciseId, '7');

  const catalog = [
    { id: '4', name: 'Bench Press' },
    { id: '12', name: 'Incline Bench Press' },
  ];
  assert.equal(exerciseChoiceText(null, catalog), 'Choose exercise');
  assert.equal(exerciseChoiceText('4', catalog), 'Bench Press');
  assert.equal(exerciseChoiceText('99', catalog), 'Exercise 99');
  const filtered = filterCatalog(catalog, '  incline ');
  assert.deepEqual(filtered, [{ id: '12', name: 'Incline Bench Press' }]);
  assert.equal(filterCatalog(catalog, '').length, 2);
  assert.equal(catalog.length, 2);

  const listed = savedProgramListItems([
    currentProgram,
    { id: '8', name: 'Off season', isActive: false },
  ]);
  assert.deepEqual(
    listed.map((item) => item.statusLabel),
    ['Current program', 'Saved program'],
  );
  assert.equal(listed[0]?.offerSwitch, false);
  assert.equal(listed[1]?.offerSwitch, true);
  const switchPrompt = requestProgramSwitch(
    [currentProgram, { id: '8', name: 'Off season', isActive: false }],
    '8',
  );
  assert.equal(switchPrompt.ok, true);
  if (switchPrompt.ok) {
    assert.equal(switchPrompt.prompt.title, 'Use Off season as your current program?');
    assert.equal(switchPrompt.prompt.body, UNFINISHED_WORKOUT_SWITCH_MESSAGE);
    assert.equal(switchPrompt.prompt.confirmLabel, 'Use this routine');
    assert.equal(switchPrompt.prompt.cancelLabel, 'Keep the current program');
    assert.match(switchPrompt.prompt.body, /original day/);
  }
  const currentSwitch = requestProgramSwitch([currentProgram], currentProgram.id);
  assert.equal(currentSwitch.ok, false);
  const missingSwitch = requestProgramSwitch([currentProgram], '99');
  assert.equal(missingSwitch.ok, false);
  assert.equal(hasCurrentProgram(listed.map((item) => ({
    id: item.id,
    name: item.name,
    isActive: item.statusLabel === 'Current program',
  }))), true);
  assert.equal(hasCurrentProgram([]), false);
  assert.equal(
    hasCurrentProgram([{ id: '8', name: 'Off season', isActive: false }]),
    false,
  );
  assert.deepEqual(
    toSavedPrograms([
      { id: 1, name: 'Current split', is_active: true },
      { id: '8', name: 'Off season', is_active: false },
    ]),
    [currentProgram, { id: '8', name: 'Off season', isActive: false }],
  );

  const history = historySnapshot();
  const before = structuredClone(history);
  const saved: Array<{ id: number; name: string; is_active: boolean }> = [];
  let rpcCalls = 0;
  const rpc: ImportSaveRpc = async (name, args) => {
    rpcCalls += 1;
    assert.equal(name, 'save_imported_program');
    const payload = args.p_program;
    assert.deepEqual(Object.keys(payload).sort(), ['days', 'name']);
    const serialized = JSON.stringify(payload);
    for (const token of ['is_active', 'workout_sessions', 'workout_sets', 'rest_seconds', 'user_id']) {
      assert.equal(serialized.includes(token), false, token);
    }
    saved.push({ id: 50, name: payload.name, is_active: false });
    return { data: 50, error: null };
  };

  const blocked = await saveManualProgram(review, {
    userId: USER_ID,
    programs: Object.freeze([]),
    rpc,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.deepEqual(blocked.errors, [FIRST_PROGRAM_UNAVAILABLE_MESSAGE]);
  }
  const inactiveOnly = await saveManualProgram(review, {
    userId: USER_ID,
    programs: Object.freeze([{ id: '8', name: 'Off season', isActive: false }]),
    rpc,
  });
  assert.equal(inactiveOnly.ok, false);
  if (!inactiveOnly.ok) {
    assert.deepEqual(inactiveOnly.errors, [FIRST_PROGRAM_UNAVAILABLE_MESSAGE]);
  }
  assert.equal(rpcCalls, 0);
  assert.deepEqual(saved, []);

  const invalidFirst = await saveManualProgram(
    edit(review, { type: 'rename-program', name: '   ' }),
    {
      userId: USER_ID,
      programs: Object.freeze([]),
      rpc,
      ownedRpc: async () => {
        rpcCalls += 1;
        return { data: 70, error: null };
      },
    },
  );
  assert.equal(invalidFirst.ok, false);
  if (!invalidFirst.ok) {
    assert.equal(invalidFirst.errors.includes(FIRST_PROGRAM_UNAVAILABLE_MESSAGE), false);
  }
  assert.equal(rpcCalls, 0);

  let ownedCalls = 0;
  const ownedFirst = await saveManualProgram(review, {
    userId: USER_ID,
    programs: Object.freeze([]),
    rpc,
    ownedRpc: async (args) => {
      ownedCalls += 1;
      assert.equal(args.p_make_current, true);
      assert.deepEqual(Object.keys(args.p_program).sort(), ['days', 'name']);
      const serialized = JSON.stringify(args.p_program);
      for (const token of ['is_active', 'workout_sessions', 'workout_sets', 'rest_seconds', 'user_id']) {
        assert.equal(serialized.includes(token), false, token);
      }
      return { data: 70, error: null };
    },
  });
  assert.equal(ownedFirst.ok, true);
  if (ownedFirst.ok) {
    assert.equal(ownedFirst.programId, '70');
  }
  assert.equal(ownedCalls, 1);
  assert.equal(rpcCalls, 0);
  assert.deepEqual(history, before);

  const alreadyCurrent = await saveManualProgram(review, {
    userId: USER_ID,
    programs: Object.freeze([{ id: '8', name: 'Off season', isActive: false }]),
    rpc,
    ownedRpc: async () => ({ data: null, error: { message: 'active_program_exists' } }),
  });
  assert.equal(alreadyCurrent.ok, false);
  if (!alreadyCurrent.ok) {
    assert.deepEqual(alreadyCurrent.errors, [ALREADY_CURRENT_PROGRAM_MESSAGE]);
  }
  assert.equal(rpcCalls, 0);

  const savedResult = await saveManualProgram(review, {
    userId: USER_ID,
    programs: Object.freeze([{ ...currentProgram }]),
    rpc,
  });
  assert.equal(savedResult.ok, true);
  if (savedResult.ok) {
    assert.equal(savedResult.programId, '50');
  }
  assert.equal(rpcCalls, 1);
  assert.deepEqual(saved, [{ id: 50, name: 'Home Routine', is_active: false }]);
  assert.deepEqual(history, before);
  assert.equal(history.active.is_active, true);
  assert.equal(history.sessions.length, 30);
  assert.equal(history.sets.length, 3);

  const payloadCalls: unknown[] = [];
  const capturingRpc: ImportSaveRpc = async (_name, args) => {
    payloadCalls.push(args.p_program);
    return { data: 51, error: null };
  };
  const captured = await saveManualProgram(review, {
    userId: USER_ID,
    programs: [currentProgram],
    rpc: capturingRpc,
  });
  assert.equal(captured.ok, true);
  const payload = payloadCalls[0] as {
    name: string;
    days: Array<{
      name: string;
      subtitle: string | null;
      exercises: Array<{
        exercise_id: number;
        target_sets: number;
        min_reps: number;
        max_reps: number;
        notes: string | null;
      }>;
    }>;
  };
  assert.equal(payload.name, 'Home Routine');
  assert.deepEqual(
    payload.days.map((day) => day.name),
    ['Push', 'Pull', 'Push'],
  );
  assert.equal(payload.days[0]?.subtitle, 'Upper');
  assert.equal(payload.days[1]?.subtitle, null);
  assert.deepEqual(payload.days[1]?.exercises, []);
  assert.deepEqual(payload.days[2]?.exercises, []);
  assert.deepEqual(payload.days[0]?.exercises, [
    {
      exercise_id: 4,
      target_sets: 4,
      min_reps: 6,
      max_reps: 10,
      notes: null,
    },
    {
      exercise_id: 12,
      target_sets: 3,
      min_reps: 8,
      max_reps: 12,
      notes: 'Pause',
    },
  ]);
  assert.deepEqual(history, before);

  const duplicate = edit(review, {
    type: 'choose-exercise',
    dayIndex: 0,
    exerciseIndex: 1,
    exerciseId: '4',
  });
  let validationCalls = 0;
  const validationRpc: ImportSaveRpc = async () => {
    validationCalls += 1;
    return { data: 99, error: null };
  };
  const duplicateResult = await saveManualProgram(duplicate, {
    userId: USER_ID,
    programs: [currentProgram],
    rpc: validationRpc,
  });
  assert.equal(duplicateResult.ok, false);
  const emptyDays = edit(createManualProgramReview(), { type: 'remove-day', dayIndex: 0 });
  const emptyDaysResult = await saveManualProgram(emptyDays, {
    userId: USER_ID,
    programs: [currentProgram],
    rpc: validationRpc,
  });
  assert.equal(emptyDaysResult.ok, false);
  const unnamed = edit(review, { type: 'rename-program', name: '   ' });
  const unnamedResult = await saveManualProgram(unnamed, {
    userId: USER_ID,
    programs: [currentProgram],
    rpc: validationRpc,
  });
  assert.equal(unnamedResult.ok, false);
  assert.equal(validationCalls, 0);
  const blockedCurrent = await saveManualProgram(review, {
    userId: USER_ID,
    programs: [currentProgram],
  });
  assert.equal(blockedCurrent.ok, false);
  if (!blockedCurrent.ok) {
    assert.deepEqual(blockedCurrent.errors, [MANUAL_SAVE_UNAVAILABLE_MESSAGE]);
  }
  const invalidCurrent = await saveManualProgram(unnamed, {
    userId: USER_ID,
    programs: [currentProgram],
  });
  assert.equal(invalidCurrent.ok, false);
  if (!invalidCurrent.ok) {
    assert.equal(invalidCurrent.errors.includes(MANUAL_SAVE_UNAVAILABLE_MESSAGE), false);
  }
  assert.equal(validationCalls, 0);
  assert.deepEqual(history, before);

  let loaded = 0;
  const signedOut = await saveManualProgramForCurrentUser(review, {
    getUserId: async () => ({ ok: false, error: 'signed out' }),
    loadPrograms: async () => {
      loaded += 1;
      return { ok: true, data: [currentProgram] };
    },
    rpc: validationRpc,
  });
  assert.equal(signedOut.ok, false);
  if (!signedOut.ok) {
    assert.deepEqual(signedOut.errors, [MANUAL_SIGN_IN_SAVE_MESSAGE]);
    assert.equal(signedOut.errors.join(' ').includes('import'), false);
  }
  const blankUser = await saveManualProgramForCurrentUser(review, {
    getUserId: async () => ({ ok: true, data: '   ' }),
    loadPrograms: async () => {
      loaded += 1;
      return { ok: true, data: [currentProgram] };
    },
    rpc: validationRpc,
  });
  assert.equal(blankUser.ok, false);
  if (!blankUser.ok) {
    assert.deepEqual(blankUser.errors, [MANUAL_SIGN_IN_SAVE_MESSAGE]);
  }
  assert.equal(loaded, 0);
  assert.equal(validationCalls, 0);

  const loadFailed = await saveManualProgramForCurrentUser(review, {
    getUserId: async () => ({ ok: true, data: USER_ID }),
    loadPrograms: async () => ({ ok: false, error: 'Could not load programs.' }),
    rpc: validationRpc,
  });
  assert.equal(loadFailed.ok, false);
  if (!loadFailed.ok) {
    assert.deepEqual(loadFailed.errors, ['Could not load programs.']);
  }
  const noCurrent = await saveManualProgramForCurrentUser(review, {
    getUserId: async () => ({ ok: true, data: USER_ID }),
    loadPrograms: async () => ({ ok: true, data: [] }),
    rpc: validationRpc,
  });
  assert.equal(noCurrent.ok, false);
  if (!noCurrent.ok) {
    assert.deepEqual(noCurrent.errors, [FIRST_PROGRAM_UNAVAILABLE_MESSAGE]);
  }
  assert.equal(validationCalls, 0);
  assert.equal(OWNED_PROGRAM_RPC_ENABLED, false);
  assert.equal(MANUAL_SAVE_RPC_ENABLED, false);
  const phoneSave = await saveManualProgramForCurrentUser(review, {
    getUserId: async () => ({ ok: true, data: USER_ID }),
    loadPrograms: async () => ({ ok: true, data: [currentProgram] }),
  });
  assert.equal(phoneSave.ok, false);
  if (!phoneSave.ok) {
    assert.deepEqual(phoneSave.errors, [MANUAL_SAVE_UNAVAILABLE_MESSAGE]);
  }
  assert.equal(validationCalls, 0);

  const customReview = number(
    number(
      number(
        edit(
          edit(
            edit(
              edit(createManualProgramReview(), { type: 'rename-program', name: 'Band Day' }),
              { type: 'rename-day', dayIndex: 0, name: 'Push' },
            ),
            { type: 'add-exercise', dayIndex: 0 },
          ),
          { type: 'preview-exercise', dayIndex: 0, exerciseIndex: 0, name: 'Band Fly' },
        ),
        0,
        0,
        'sets',
        '3',
      ),
      0,
      0,
      'repsMin',
      '8',
    ),
    0,
    0,
    'repsMax',
    '12',
  );
  assert.equal(customReview.days[0]?.exercises[0]?.exerciseId, null);
  assert.equal(customReview.days[0]?.exercises[0]?.sourceName, 'Band Fly');
  assert.deepEqual(validateManualRoutine(customReview), { ok: true });
  assert.deepEqual(validateManualRoutine(edit(customReview, { type: 'add-day' })), { ok: true });
  let customRpcCalls = 0;
  const customSaved = await saveManualProgram(customReview, {
    userId: USER_ID,
    programs: [currentProgram],
    rpc: async () => {
      customRpcCalls += 1;
      return { data: 80, error: null };
    },
  });
  assert.equal(customSaved.ok, false);
  if (!customSaved.ok) {
    assert.deepEqual(customSaved.errors, [MANUAL_SAVE_UNAVAILABLE_MESSAGE]);
    assert.equal(customSaved.errors.includes(IMPORT_UNRESOLVED_EXERCISE_MESSAGE), false);
  }
  assert.equal(customRpcCalls, 0);
  const customEdit = previewProgramEdit(customReview, USER_ID);
  assert.deepEqual(customEdit, { ok: false, errors: [EDIT_SAVE_BLOCKED_MESSAGE] });
  const customFirst = await saveManualProgram(customReview, {
    userId: USER_ID,
    programs: [],
    ownedRpc: async () => {
      customRpcCalls += 1;
      return { data: 81, error: null };
    },
  });
  assert.equal(customFirst.ok, false);
  if (!customFirst.ok) {
    assert.deepEqual(customFirst.errors, [FIRST_PROGRAM_UNAVAILABLE_MESSAGE]);
    assert.equal(customFirst.errors.includes(IMPORT_UNRESOLVED_EXERCISE_MESSAGE), false);
  }
  assert.equal(customRpcCalls, 0);

  const blankSlot = edit(
    edit(
      edit(createManualProgramReview(), { type: 'rename-program', name: 'Band Day' }),
      { type: 'rename-day', dayIndex: 0, name: 'Push' },
    ),
    { type: 'add-exercise', dayIndex: 0 },
  );
  const blankSave = await saveManualProgram(blankSlot, {
    userId: USER_ID,
    programs: [currentProgram],
    rpc: async () => {
      customRpcCalls += 1;
      return { data: 82, error: null };
    },
  });
  assert.equal(blankSave.ok, false);
  if (!blankSave.ok) {
    assert.equal(blankSave.errors.includes(MANUAL_CHOOSE_EXERCISE_MESSAGE), true);
    assert.equal(blankSave.errors.includes(MANUAL_SETS_SAVE_MESSAGE), true);
    assert.equal(blankSave.errors.includes(IMPORT_UNRESOLVED_EXERCISE_MESSAGE), false);
    assert.equal(blankSave.errors.includes(MANUAL_SAVE_UNAVAILABLE_MESSAGE), false);
    assert.equal(blankSave.errors.includes(EDIT_SAVE_BLOCKED_MESSAGE), false);
  }
  assert.equal(customRpcCalls, 0);
  const plannedSelection = number(
    number(
      number(
        edit(blankSlot, {
          type: 'choose-exercise',
          dayIndex: 0,
          exerciseIndex: 0,
          exerciseId: 'planned:band-fly',
        }),
        0,
        0,
        'sets',
        '3',
      ),
      0,
      0,
      'repsMin',
      '8',
    ),
    0,
    0,
    'repsMax',
    '12',
  );
  const plannedSave = await saveManualProgram(plannedSelection, {
    userId: USER_ID,
    programs: [currentProgram],
    rpc: async () => {
      customRpcCalls += 1;
      return { data: 83, error: null };
    },
  });
  assert.equal(plannedSave.ok, false);
  if (!plannedSave.ok) {
    assert.equal(plannedSave.errors.includes(MANUAL_CHOOSE_EXERCISE_MESSAGE), true);
    assert.equal(plannedSave.errors.includes(IMPORT_UNRESOLVED_EXERCISE_MESSAGE), false);
    assert.equal(plannedSave.errors.includes(MANUAL_SAVE_UNAVAILABLE_MESSAGE), false);
  }
  assert.equal(customRpcCalls, 0);
  let injectedOwnedCalls = 0;
  const injectedFirst = await saveManualProgramForCurrentUser(review, {
    getUserId: async () => ({ ok: true, data: USER_ID }),
    loadPrograms: async () => ({ ok: true, data: [] }),
    rpc: validationRpc,
    ownedRpc: async (args) => {
      injectedOwnedCalls += 1;
      assert.equal(args.p_make_current, true);
      assert.equal(Object.prototype.hasOwnProperty.call(args.p_program, 'user_id'), false);
      return { data: 71, error: null };
    },
  });
  assert.equal(injectedFirst.ok, true);
  if (injectedFirst.ok) {
    assert.equal(injectedFirst.programId, '71');
  }
  assert.equal(injectedOwnedCalls, 1);
  assert.equal(validationCalls, 0);

  const remappedSignIn = await saveManualProgramForCurrentUser(review, {
    getUserId: async () => ({ ok: true, data: USER_ID }),
    loadPrograms: async () => ({ ok: true, data: [currentProgram] }),
    rpc: async () => ({ data: null, error: { message: 'Not authenticated' } }),
  });
  assert.equal(remappedSignIn.ok, false);
  if (!remappedSignIn.ok) {
    assert.deepEqual(remappedSignIn.errors, [MANUAL_SIGN_IN_SAVE_MESSAGE]);
  }
  assert.match(IMPORT_SIGN_IN_MESSAGE, /saving an import/);

  let activationCalls = 0;
  const switchUnavailable = await activateOwnedProgramForCurrentUser('8', {
    getUserId: async () => ({ ok: true, data: USER_ID }),
  });
  assert.equal(ACTIVATION_RPC_ENABLED, false);
  assert.deepEqual(switchUnavailable, { ok: false, error: PROGRAM_SWITCH_UNAVAILABLE_MESSAGE });
  const switchSignedOut = await activateOwnedProgramForCurrentUser('8', {
    getUserId: async () => ({ ok: false, error: 'signed out' }),
    rpc: async () => {
      activationCalls += 1;
      return { data: 8, error: null };
    },
  });
  assert.equal(switchSignedOut.ok, false);
  if (!switchSignedOut.ok) {
    assert.equal(switchSignedOut.error, MANUAL_SIGN_IN_SWITCH_MESSAGE);
  }
  const switchBadId = await activateOwnedProgramForCurrentUser('0', {
    getUserId: async () => ({ ok: true, data: USER_ID }),
    rpc: async () => {
      activationCalls += 1;
      return { data: 1, error: null };
    },
  });
  assert.equal(switchBadId.ok, false);
  assert.equal(activationCalls, 0);
  const switched = await activateOwnedProgramForCurrentUser('8', {
    getUserId: async () => ({ ok: true, data: USER_ID }),
    rpc: async (programId) => {
      activationCalls += 1;
      assert.equal(programId, '8');
      return { data: 8, error: null };
    },
  });
  assert.equal(switched.ok, true);
  if (switched.ok) {
    assert.equal(switched.programId, '8');
  }
  const hiddenProgram = await activateOwnedProgramForCurrentUser('8', {
    getUserId: async () => ({ ok: true, data: USER_ID }),
    rpc: async () => ({ data: null, error: { message: 'program_not_found' } }),
  });
  assert.equal(hiddenProgram.ok, false);
  if (!hiddenProgram.ok) {
    assert.match(hiddenProgram.error, /Nothing was changed/);
  }
  assert.equal(activationCalls, 1);

  const reloaded = await saveManualProgramForCurrentUser(review, {
    getUserId: async () => ({ ok: true, data: USER_ID }),
    loadPrograms: async () => ({ ok: true, data: [currentProgram] }),
    rpc: async () => ({ data: 52, error: null }),
  });
  assert.equal(reloaded.ok, true);
  if (reloaded.ok) {
    assert.equal(reloaded.programId, '52');
  }
  assert.deepEqual(history, before);

  let selectedUser = '';
  const owned = await loadOwnedPrograms({
    getUserId: async () => ({ ok: true, data: USER_ID }),
    selectPrograms: async (userId) => {
      selectedUser = userId;
      return {
        data: [
          { id: 1, name: 'Current split', is_active: true },
          { id: 8, name: 'Off season', is_active: false },
        ],
        error: null,
      };
    },
  });
  assert.equal(owned.ok, true);
  if (owned.ok) {
    assert.equal(hasCurrentProgram(owned.data), true);
    assert.equal(owned.data.some((program) => program.isActive === false), true);
  }
  assert.equal(selectedUser, USER_ID);

  let selectCalls = 0;
  const signedOutList = await loadOwnedPrograms({
    getUserId: async () => ({ ok: false, error: 'signed out' }),
    selectPrograms: async () => {
      selectCalls += 1;
      return { data: [], error: null };
    },
  });
  assert.equal(signedOutList.ok, false);
  if (!signedOutList.ok) {
    assert.equal(signedOutList.error, MANUAL_SIGN_IN_LIST_MESSAGE);
    assert.equal(signedOutList.error.includes('import'), false);
  }
  assert.equal(selectCalls, 0);

  const catalogResult = await loadExerciseCatalog({
    selectExercises: async () => ({
      data: [{ id: 4, name: 'Bench Press' }],
      error: null,
    }),
  });
  assert.equal(catalogResult.ok, true);
  if (catalogResult.ok) {
    assert.deepEqual(catalogResult.data, [
      { id: '4', name: 'Bench Press', muscle: null, equipment: null },
    ]);
  }

  const workoutHistory = {
    sessions: [
      { id: 'session-1', programDayId: '3', finishedAt: '2026-10-01T00:00:00Z' },
      { id: 'session-2', programDayId: '4', finishedAt: null },
    ],
    sets: [
      { id: 'set-1', sessionId: 'session-1', exerciseId: '4' },
      { id: 'set-2', sessionId: 'session-2', exerciseId: '12' },
    ],
  };
  const beforeHistory = structuredClone(workoutHistory);
  const assembled = assembleProgramDraft({
    programId: '8',
    name: 'Off season',
    isActive: false,
    focusDayId: '4',
    days: [
      { id: '3', name: 'Push', subtitle: 'Upper', dayOrder: 1 },
      { id: '4', name: 'Pull', subtitle: null, dayOrder: 2 },
    ],
    exercises: [
      {
        id: '30',
        programDayId: '3',
        exerciseId: '4',
        name: 'Bench Press',
        order: 1,
        targetSets: 4,
        minReps: 6,
        maxReps: 10,
        notes: 'Pause',
      },
      {
        id: '31',
        programDayId: '4',
        exerciseId: '12',
        name: 'Row',
        order: 1,
        targetSets: 3,
        minReps: 8,
        maxReps: 12,
        notes: null,
      },
    ],
  });
  assert.equal(assembled.ok, true);
  if (!assembled.ok) {
    throw new Error('draft');
  }
  const beforeDraft = structuredClone(assembled.draft);
  const beforeIdentity = draftIdentity(assembled.draft);
  assert.equal(assembled.focusDayIndex, 1);
  let edited = reviewFromProgramDraft(assembled.draft);
  assert.equal(edited.programName, 'Off season');
  assert.equal(edited.days[0]?.name, 'Push');
  assert.equal(edited.days[0]?.exercises[0]?.sets.value, 4);
  assert.equal(edited.days[0]?.exercises[0]?.repsMin.value, 6);
  assert.equal(edited.days[0]?.exercises[0]?.repsMax.value, 10);
  assert.equal(edited.days[0]?.exercises[0]?.notes, 'Pause');
  edited = applyManualEdit(edited, { type: 'rename-day', dayIndex: 0, name: 'Push day' }).review;
  edited = applyManualEdit(edited, { type: 'add-day' }).review;
  edited = applyManualEdit(edited, { type: 'move-day', dayIndex: 2, direction: 'up' }).review;
  edited = applyManualEdit(edited, { type: 'remove-day', dayIndex: 1 }).review;
  edited = applyManualEdit(edited, { type: 'add-exercise', dayIndex: 0 }).review;
  const addedIndex = (edited.days[0]?.exercises.length ?? 1) - 1;
  edited = applyManualEdit(edited, {
    type: 'preview-exercise',
    dayIndex: 0,
    exerciseIndex: addedIndex,
    name: 'Band Fly',
  }).review;
  edited = applyManualNumber(edited, {
    dayIndex: 0,
    exerciseIndex: 0,
    field: 'sets',
    raw: '5',
  }).review;
  edited = applyManualNumber(edited, {
    dayIndex: 0,
    exerciseIndex: 0,
    field: 'repsMin',
    raw: '5',
  }).review;
  edited = applyManualNumber(edited, {
    dayIndex: 0,
    exerciseIndex: 0,
    field: 'repsMax',
    raw: '8',
  }).review;
  edited = applyManualEdit(edited, {
    type: 'set-notes',
    dayIndex: 0,
    exerciseIndex: 0,
    notes: 'Slow',
  }).review;
  assert.equal(edited.days[0]?.name, 'Push day');
  assert.equal(edited.days[0]?.exercises[0]?.sets.value, 5);
  assert.equal(edited.days[0]?.exercises[0]?.notes, 'Slow');
  assert.equal(edited.days[0]?.exercises[0]?.exerciseId, '4');
  assert.equal(edited.days[0]?.exercises[addedIndex]?.exerciseId, null);
  assert.equal(edited.days[0]?.exercises[addedIndex]?.sourceName, 'Band Fly');
  assert.deepEqual(assembled.draft, beforeDraft);
  assert.deepEqual(draftIdentity(assembled.draft), beforeIdentity);
  assert.deepEqual(workoutHistory, beforeHistory);
  assert.equal(workoutHistory.sessions[0]?.programDayId, assembled.draft.days[0]?.id);
  assert.equal(workoutHistory.sets[0]?.exerciseId, assembled.draft.days[0]?.exercises[0]?.exerciseId);
  assert.equal(JSON.stringify(edited).includes('session-1'), false);
  assert.equal(JSON.stringify(edited).includes('set-1'), false);
  const blockedEdit = previewProgramEdit(reviewFromProgramDraft(assembled.draft), USER_ID);
  assert.deepEqual(blockedEdit, { ok: false, errors: [EDIT_SAVE_BLOCKED_MESSAGE] });
  const invalidEdit = previewProgramEdit(
    applyManualEdit(reviewFromProgramDraft(assembled.draft), {
      type: 'rename-program',
      name: '   ',
    }).review,
    USER_ID,
  );
  assert.equal(invalidEdit.ok, false);
  assert.equal(invalidEdit.errors.includes(EDIT_SAVE_BLOCKED_MESSAGE), false);
  assert.deepEqual(workoutHistory, beforeHistory);
  assert.deepEqual(assembled.draft, beforeDraft);

  let draftSelects = 0;
  const loadedDraft = await loadProgramDraftForCurrentUser(
    { programId: '8', dayId: '4' },
    {
      getUserId: async () => ({ ok: true, data: USER_ID }),
      selectProgram: async (userId, id) => {
        draftSelects += 1;
        assert.equal(userId, USER_ID);
        assert.equal(id, '8');
        return { data: { id: 8, name: 'Off season', is_active: false }, error: null };
      },
      selectActiveProgram: async () => {
        draftSelects += 1;
        return { data: null, error: null };
      },
      selectDays: async (id) => {
        assert.equal(id, '8');
        return {
          data: [
            { id: 3, name: 'Push', subtitle: 'Upper', day_order: 1 },
            { id: 4, name: 'Pull', subtitle: null, day_order: 2 },
          ],
          error: null,
        };
      },
      selectDraftExercises: async (dayIds) => {
        assert.deepEqual([...dayIds], ['3', '4']);
        return {
          data: [
            {
              id: 30,
              program_day_id: 3,
              exercise_id: 4,
              exercise_order: 1,
              target_sets: 4,
              min_reps: 6,
              max_reps: 10,
              notes: 'Pause',
              exercise: { name: 'Bench Press' },
            },
          ],
          error: null,
        };
      },
    },
  );
  assert.equal(loadedDraft.ok, true);
  if (loadedDraft.ok) {
    assert.equal(loadedDraft.focusDayIndex, 1);
    assert.equal(loadedDraft.draft.isActive, false);
    assert.equal(loadedDraft.draft.days[0]?.exercises[0]?.name, 'Bench Press');
    assert.equal(loadedDraft.draft.days[0]?.exercises[0]?.targetSets, 4);
    assert.equal(loadedDraft.userId, USER_ID);
  }
  const signedOutDraft = await loadProgramDraftForCurrentUser(
    { dayId: '4' },
    {
      getUserId: async () => ({ ok: false, error: 'signed out' }),
      selectActiveProgram: async () => {
        draftSelects += 1;
        return { data: null, error: null };
      },
    },
  );
  assert.equal(signedOutDraft.ok, false);
  const badDraftId = await loadProgramDraftForCurrentUser(
    { programId: '0' },
    {
      getUserId: async () => {
        draftSelects += 1;
        return { ok: true, data: USER_ID };
      },
    },
  );
  assert.equal(badDraftId.ok, false);
  assert.equal(draftSelects, 1);
  assert.deepEqual(workoutHistory, beforeHistory);

  assert.equal(PLANNED_EXERCISES.length >= CATALOG_TARGET_MIN, true);
  assert.equal(PLANNED_EXERCISES.length <= CATALOG_TARGET_MAX, true);
  const plannedNames = PLANNED_EXERCISES.map((exercise) => normalizeExerciseName(exercise.name));
  assert.equal(new Set(plannedNames).size, plannedNames.length);
  for (const exercise of PLANNED_EXERCISES) {
    assert.equal(MUSCLE_GROUPS.includes(exercise.muscle), true, exercise.name);
    assert.equal(EQUIPMENT_TYPES.includes(exercise.equipment), true, exercise.name);
  }
  assert.equal(CUSTOM_EXERCISE_WRITES_ENABLED, false);
  assert.equal(source('lib/import/planned-exercises.ts').includes('INSERT INTO'), false);
  assert.equal(source('lib/import/program-draft.ts').includes('supabase'), false);
  const merged = mergeExerciseChoices(
    [{ id: '4', name: 'Push-Up', muscle: 'Chest', equipment: 'Bodyweight' }],
    PLANNED_EXERCISES,
  );
  assert.equal(merged.filter((exercise) => normalizeExerciseName(exercise.name) === 'push up').length, 1);
  assert.equal(merged.find((exercise) => exercise.id === '4')?.saved, true);
  assert.equal(merged.some((exercise) => exercise.saved === false), true);
  const chestBarbell = filterCatalog(merged, 'press', { muscle: 'Chest', equipment: 'Barbell' });
  assert.equal(chestBarbell.length > 0, true);
  assert.equal(
    chestBarbell.every((exercise) => exercise.muscle === 'Chest' && exercise.equipment === 'Barbell'),
    true,
  );

  const manualSource = source('lib/import/manual-program.ts');
  const clientSource = source('lib/import/manual-program-client.ts');
  const builderSource = source('components/manual-program-builder.tsx');
  const listSource = source('components/saved-program-list.tsx');
  const buildScreen = source('app/(tabs)/program/build.tsx');
  const savedScreen = source('app/(tabs)/program/saved.tsx');
  const layoutSource = source('app/(tabs)/program/_layout.tsx');
  const indexSource = source('app/(tabs)/program/index.tsx');
  const dayScreen = source('app/(tabs)/program/[id].tsx');
  const draftStart = clientSource.indexOf('export async function loadProgramDraftForCurrentUser');
  const draftEnd = clientSource.indexOf('export const MANUAL_SAVE_RPC_ENABLED');
  const draftSource = clientSource.slice(draftStart, draftEnd);
  for (const token of ['.rpc(', '.insert(', '.update(', '.delete(', 'workout_sessions', 'workout_sets']) {
    assert.equal(draftSource.includes(token), false, token);
  }
  const forbidden = [
    'IMPORT_ENABLED',
    'consume_ai_import_quota',
    'grok',
    'api.x.ai',
    'XAI_API_KEY',
    'ensureOwnProgram',
    'copy_starter',
    'workout_sessions',
    'workout_sets',
    'health-connect',
    'exercise-swap',
  ];
  for (const token of forbidden) {
    assert.equal(manualSource.includes(token), false, token);
    assert.equal(clientSource.includes(token), false, token);
    assert.equal(builderSource.includes(token), false, token);
    assert.equal(listSource.includes(token), false, token);
    assert.equal(buildScreen.includes(token), false, token);
    assert.equal(savedScreen.includes(token), false, token);
  }
  assert.equal(clientSource.includes("from '../supabase.ts'"), false);
  assert.equal(clientSource.includes("await import('../supabase.ts')"), true);
  assert.equal(clientSource.includes('.insert('), false);
  assert.equal(clientSource.includes('.update('), false);
  assert.equal(clientSource.includes('.delete('), false);
  assert.equal(clientSource.includes(".eq('user_id', userId)"), true);
  assert.equal(clientSource.includes('save_imported_program'), true);

  for (const label of [
    'PROGRAM_NAME_LABEL',
    'dayNameLabel(',
    'daySubtitleLabel(',
    'removeDayLabel(',
    'moveDayLabel(',
    'addExerciseLabel(',
    'chooseExerciseLabel(',
    'setsLabel(',
    'repsMinLabel(',
    'repsMaxLabel(',
    'notesLabel(',
    'SAVE_ROUTINE_LABEL',
    'ADD_DAY_LABEL',
  ]) {
    assert.equal(builderSource.includes(label), true, label);
  }
  assert.equal(builderSource.includes("from 'react-native'"), true);
  assert.equal(builderSource.includes('VIEW_SAVED_PROGRAMS_LABEL'), true);
  assert.equal(builderSource.includes('href="/program/saved"'), true);
  assert.equal(builderSource.includes('savedProgramId == null'), true);
  assert.equal(builderSource.includes(MANUAL_SAVE_ONCE_MESSAGE), false);
  assert.equal(builderSource.includes('MANUAL_SAVE_ONCE_MESSAGE'), true);
  assert.equal(builderSource.includes('saving an import'), false);
  assert.equal(listSource.includes('Pressable'), true);
  assert.equal(listSource.includes('requestProgramSwitch'), true);
  assert.equal(listSource.includes('UNFINISHED_WORKOUT_SWITCH_MESSAGE'), true);
  assert.equal(listSource.includes('{prompt?.body}'), true);
  assert.equal(listSource.includes('Keep the current program'), true);
  assert.equal(listSource.includes('activate_owned_program'), false);
  assert.equal(listSource.includes('savedProgramListItems'), true);

  assert.equal(
    buildScreen.includes("Platform.OS === 'ios' ? 'padding' : undefined"),
    true,
  );
  assert.equal(
    savedScreen.includes("Platform.OS === 'ios' ? 'padding' : undefined"),
    true,
  );
  assert.equal(buildScreen.includes('saveManualProgramForCurrentUser(review)'), true);
  assert.equal(buildScreen.includes('saveLock.current'), true);
  assert.equal(savedScreen.includes('activateOwnedProgramForCurrentUser'), true);
  assert.equal(savedScreen.includes('requestProgramSwitch'), true);
  assert.equal(savedScreen.includes('supabase'), false);
  assert.equal(clientSource.includes('ACTIVATION_RPC_ENABLED = false'), true);
  assert.equal(clientSource.includes('OWNED_PROGRAM_RPC_ENABLED = false'), true);
  assert.equal(clientSource.includes('MANUAL_SAVE_RPC_ENABLED = false'), true);
  assert.equal(
    clientSource.includes('io?.ownedRpc ?? (OWNED_PROGRAM_RPC_ENABLED ? defaultOwnedSaveRpc : undefined)'),
    true,
  );
  assert.equal(
    clientSource.includes('io?.rpc ?? (MANUAL_SAVE_RPC_ENABLED ? defaultSaveRpc : undefined)'),
    true,
  );
  assert.equal(builderSource.includes('SAVE_FIRST_ROUTINE_LABEL'), true);
  assert.equal(builderSource.includes('FIRST_PROGRAM_NOTICE'), true);
  assert.equal(builderSource.includes('MANUAL_NO_ACTIVE_PROGRAM_MESSAGE'), false);
  assert.equal(buildScreen.includes('save_owned_program'), false);
  assert.equal(buildScreen.includes('activate_owned_program'), false);
  assert.equal(clientSource.includes(VIEW_SAVED_PROGRAMS_LABEL), false);
  assert.equal(buildScreen.includes('listProgramDays'), false);
  assert.equal(savedScreen.includes('listProgramDays'), false);
  assert.equal(
    buildScreen.includes(
      'hasActiveProgram={!programsLoaded || loadError != null || hasCurrentProgram(programs)}',
    ),
    true,
  );

  const buildRoute = layoutSource.indexOf('name="build"');
  const savedRoute = layoutSource.indexOf('name="saved"');
  const dayRoute = layoutSource.indexOf('name="[id]"');
  assert.equal(buildRoute > 0 && buildRoute < dayRoute, true);
  assert.equal(savedRoute > buildRoute && savedRoute < dayRoute, true);

  const buildLink = indexSource.indexOf('href="/program/build"');
  const savedLink = indexSource.indexOf('href="/program/saved"');
  const errorBranch = indexSource.indexOf('Could not load program days');
  assert.equal(buildLink > 0 && buildLink < errorBranch, true);
  assert.equal(savedLink > buildLink && savedLink < errorBranch, true);
  assert.equal(indexSource.includes('listProgramDays'), true);
  assert.equal(indexSource.includes('primaryBuildButton'), true);
  assert.equal(indexSource.includes('secondarySavedButton'), true);
  assert.equal(indexSource.includes('name="add"'), true);
  assert.equal(indexSource.includes('EDIT_DAY_LABEL'), true);
  assert.equal(indexSource.includes('minHeight: 56'), true);
  assert.equal(indexSource.includes("buttonPaletteForSurface('dark')"), true);
  assert.equal(indexSource.includes('transform'), false);
  const buildButton = indexSource.slice(
    indexSource.indexOf('accessibilityLabel="Build a routine"'),
    indexSource.indexOf('accessibilityLabel="Saved programs"'),
  );
  assert.equal(buildLink < indexSource.indexOf('accessibilityLabel="Build a routine"'), true);
  assert.equal(buildButton.includes('style={({ pressed })'), false);
  assert.equal(buildButton.includes('style={styles.primaryBuildButton}'), true);
  assert.equal(buildButton.includes('name="add"'), true);
  assert.equal(buildButton.includes('primaryButton.icon'), true);
  assert.equal(buildButton.includes('primaryButton.label') || indexSource.includes('primaryButton.label'), true);
  assert.equal(indexSource.includes('style={({ pressed })'), false);
  const darkPair = buttonPaletteForSurface('dark');
  const lightPair = buttonPaletteForSurface('light');
  assert.equal(darkPair.background, '#C6FF4D');
  assert.equal(darkPair.label, '#111111');
  assert.equal(darkPair.icon, '#111111');
  assert.equal(lightPair.background, '#111111');
  assert.equal(lightPair.label, '#F4F4F5');
  assert.equal(contrastRatio(darkPair.label, darkPair.background) >= 4.5, true);
  assert.equal(contrastRatio(darkPair.icon, darkPair.background) >= 4.5, true);
  assert.equal(contrastRatio(lightPair.label, lightPair.background) >= 4.5, true);
  assert.equal(contrastRatio(lightPair.icon, lightPair.background) >= 4.5, true);
  assert.equal(dayScreen.includes('EDIT_DAY_LABEL'), true);
  assert.equal(dayScreen.includes("buttonPaletteForSurface('dark')"), true);
  assert.equal(dayScreen.includes('style={styles.editButton}'), true);
  assert.equal(dayScreen.includes('style={({ pressed })'), false);
  assert.equal(dayScreen.includes('.update('), false);
  assert.equal(dayScreen.includes('.insert('), false);
  assert.equal(dayScreen.includes('.rpc('), false);
  assert.equal(listSource.includes('EDIT_ROUTINE_LABEL'), true);
  const editRoutineLink = listSource.slice(
    listSource.indexOf("pathname: '/program/build'"),
    listSource.indexOf('item.offerSwitch'),
  );
  assert.equal(editRoutineLink.includes('style={({ pressed })'), false);
  assert.equal(editRoutineLink.includes('style={styles.editButton}'), true);
  const savedProgramsLink = builderSource.slice(
    builderSource.indexOf('href="/program/saved"'),
    builderSource.indexOf('<Modal'),
  );
  assert.equal(savedProgramsLink.includes('style={({ pressed })'), false);
  assert.equal(savedProgramsLink.includes('style={styles.primaryButton}'), true);
  assert.equal(builderSource.includes('accessibilityLabel={`Use ${customName}`}'), true);
  assert.equal(builderSource.includes('Your exercise'), true);
  assert.equal(builderSource.includes('normalizeExerciseName'), true);
  const editPreview = manualSource.slice(
    manualSource.indexOf('export function previewProgramEdit'),
    manualSource.indexOf('export async function saveManualProgram'),
  );
  assert.equal(editPreview.includes('validateManualRoutine'), true);
  assert.equal(editPreview.includes('toSavePayload'), false);
  assert.equal(editPreview.includes('IMPORT_UNRESOLVED_EXERCISE_MESSAGE'), false);
  assert.equal(manualSource.includes('IMPORT_UNRESOLVED_EXERCISE_MESSAGE'), false);
  assert.equal(builderSource.includes('LOCAL_DAY_NOTICE'), true);
  assert.equal(builderSource.includes('DAY_ADDED_LOCALLY_MESSAGE'), true);
  assert.equal(builderSource.includes('mergeExerciseChoices'), true);
  assert.equal(builderSource.includes('MUSCLE_GROUPS'), true);
  assert.equal(buildScreen.includes('previewProgramEdit(review, draftUserId)'), true);
  assert.equal(
    buildScreen.indexOf('previewProgramEdit(review, draftUserId)') <
      buildScreen.indexOf('saveManualProgramForCurrentUser(review)'),
    true,
  );

  for (const path of [
    'app/(tabs)/program/build.ios.tsx',
    'app/(tabs)/program/build.android.tsx',
    'app/(tabs)/program/saved.ios.tsx',
    'app/(tabs)/program/saved.android.tsx',
    'components/manual-program-builder.ios.tsx',
    'components/manual-program-builder.android.tsx',
    'components/saved-program-list.ios.tsx',
    'components/saved-program-list.android.tsx',
  ]) {
    assert.equal(existsSync(fileURLToPath(new URL(`../${path}`, import.meta.url))), false, path);
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('manual program checks passed');
