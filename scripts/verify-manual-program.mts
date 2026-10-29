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
  hasCurrentProgram,
  MANUAL_NO_ACTIVE_PROGRAM_MESSAGE,
  MANUAL_REPS_MESSAGE,
  MANUAL_SETS_MESSAGE,
  saveManualProgram,
  savedProgramListItems,
  toSavedPrograms,
  type ManualEdit,
  type SavedProgramSummary,
} from '../lib/import/manual-program.ts';
import {
  loadExerciseCatalog,
  loadOwnedPrograms,
  saveManualProgramForCurrentUser,
} from '../lib/import/manual-program-client.ts';
import { createManualProgramReview, type ProgramReview } from '../lib/import/review-editor.ts';
import { IMPORT_CAPACITY_MESSAGE } from '../lib/import/save-plan.ts';
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
  assert.equal(listed.every((item) => item.canActivate === false), true);
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
    assert.deepEqual(blocked.errors, [MANUAL_NO_ACTIVE_PROGRAM_MESSAGE]);
  }
  const inactiveOnly = await saveManualProgram(review, {
    userId: USER_ID,
    programs: Object.freeze([{ id: '8', name: 'Off season', isActive: false }]),
    rpc,
  });
  assert.equal(inactiveOnly.ok, false);
  assert.equal(rpcCalls, 0);
  assert.deepEqual(saved, []);

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
  const blankUser = await saveManualProgramForCurrentUser(review, {
    getUserId: async () => ({ ok: true, data: '   ' }),
    loadPrograms: async () => {
      loaded += 1;
      return { ok: true, data: [currentProgram] };
    },
    rpc: validationRpc,
  });
  assert.equal(blankUser.ok, false);
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
    assert.deepEqual(noCurrent.errors, [MANUAL_NO_ACTIVE_PROGRAM_MESSAGE]);
  }
  assert.equal(validationCalls, 0);

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
  assert.equal(selectCalls, 0);

  const catalogResult = await loadExerciseCatalog({
    selectExercises: async () => ({
      data: [{ id: 4, name: 'Bench Press' }],
      error: null,
    }),
  });
  assert.equal(catalogResult.ok, true);
  if (catalogResult.ok) {
    assert.deepEqual(catalogResult.data, [{ id: '4', name: 'Bench Press' }]);
  }

  const manualSource = source('lib/import/manual-program.ts');
  const clientSource = source('lib/import/manual-program-client.ts');
  const builderSource = source('components/manual-program-builder.tsx');
  const listSource = source('components/saved-program-list.tsx');
  const buildScreen = source('app/(tabs)/program/build.tsx');
  const savedScreen = source('app/(tabs)/program/saved.tsx');
  const layoutSource = source('app/(tabs)/program/_layout.tsx');
  const indexSource = source('app/(tabs)/program/index.tsx');
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
  assert.equal(listSource.includes('Pressable'), false);
  assert.equal(listSource.includes('onPress'), false);
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
