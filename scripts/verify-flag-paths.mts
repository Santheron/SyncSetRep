import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createCustomExercise } from '../lib/import/custom-exercise.ts';
import { IMPORT_ENABLED, PERSIST_REST_SECONDS, SUBTITLE_REQUIRED } from '../lib/import/flags.ts';
import { IMPORT_DISABLED_MESSAGE, importWorkoutDraft } from '../lib/import/import-workout.ts';
import {
  CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE,
  EDIT_SAVE_BLOCKED_MESSAGE,
  FIRST_PROGRAM_UNAVAILABLE_MESSAGE,
  MANUAL_SAVE_UNAVAILABLE_MESSAGE,
  saveManualProgram,
  saveOwnedProgramEdit,
  validateManualRoutine,
} from '../lib/import/manual-program.ts';
import {
  ACTIVATION_RPC_ENABLED,
  MANUAL_SAVE_RPC_ENABLED,
  OWNED_PROGRAM_EDIT_ENABLED,
  OWNED_PROGRAM_RPC_ENABLED,
  activateOwnedProgramForCurrentUser,
  saveManualProgramForCurrentUser,
  saveOwnedProgramEditForCurrentUser,
} from '../lib/import/manual-program-client.ts';
import { CUSTOM_EXERCISE_WRITES_ENABLED } from '../lib/import/planned-exercises.ts';
import { reviewFromProgramDraft } from '../lib/import/program-draft.ts';
import { IMPORT_BLANK_SUBTITLE_MESSAGE } from '../lib/import/save-plan.ts';
import { toSavePayload } from '../lib/import/save-payload.ts';
import { toImportPreview } from '../lib/import/review-editor.ts';
import {
  LOAD_MODE_SAVE_BLOCKED_MESSAGE,
  PERSIST_LOAD_MODE,
  prepareTrackedWrite,
} from '../lib/load-mode.ts';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function source(name: string): string {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

function stripSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

const flags = {
  IMPORT_ENABLED,
  PERSIST_REST_SECONDS,
  SUBTITLE_REQUIRED,
  PERSIST_LOAD_MODE,
  MANUAL_SAVE_RPC_ENABLED,
  OWNED_PROGRAM_RPC_ENABLED,
  OWNED_PROGRAM_EDIT_ENABLED,
  ACTIVATION_RPC_ENABLED,
  CUSTOM_EXERCISE_WRITES_ENABLED,
};
for (const [name, value] of Object.entries(flags)) {
  assert.equal(value, false, name);
}

const client = source('lib/import/manual-program-client.ts');
const custom = source('lib/import/custom-exercise.ts');
const importer = source('lib/import/import-workout.ts');
const savePlan = source('lib/import/save-plan.ts');
const loadMode = source('lib/load-mode.ts');
assert.equal(client.includes('io?.rpc ?? (MANUAL_SAVE_RPC_ENABLED ? defaultSaveRpc : undefined)'), true);
assert.equal(client.includes('io?.ownedRpc ?? (OWNED_PROGRAM_RPC_ENABLED ? defaultOwnedSaveRpc : undefined)'), true);
assert.equal(client.includes('io?.rpc ?? (OWNED_PROGRAM_EDIT_ENABLED ? defaultEditRpc : undefined)'), true);
assert.equal(client.includes('if (!io?.rpc && !ACTIVATION_RPC_ENABLED)'), true);
assert.equal(client.includes("supabase.rpc('save_owned_program'"), true);
assert.equal(client.includes("supabase.rpc('update_owned_program'"), true);
assert.equal(client.includes("supabase.rpc('activate_owned_program'"), true);
assert.equal(client.includes("supabase.rpc(name, args)"), true);
assert.equal(custom.includes('options?.enabled ?? CUSTOM_EXERCISE_WRITES_ENABLED'), true);
assert.equal(custom.includes("supabase.rpc('create_custom_exercise'"), true);
assert.equal(importer.includes('options?.enabled ?? IMPORT_ENABLED'), true);
assert.equal(importer.includes("supabase.functions.invoke('import-workout'"), true);
assert.equal(savePlan.includes('options.persistRestSeconds ?? PERSIST_REST_SECONDS'), true);
assert.equal(savePlan.includes('options.subtitleRequired ?? SUBTITLE_REQUIRED'), true);
assert.equal(loadMode.includes('input.persistLoadMode ?? PERSIST_LOAD_MODE'), true);

const routineEdit = source('sql/routine-edit.sql');
const activation = source('sql/program-activation.sql');
const privilege = stripSql(source('sql/program-activation-privilege.sql'));
const rest = source('sql/program-exercise-rest.sql');
const saveProgram = stripSql(source('sql/ai-import-save-program.sql'));
const enablement = stripSql(source('sql/routine-write-enablement.sql'));
assert.equal(source('sql/load-mode.sql').includes('load_mode'), true);
assert.equal(source('sql/load-mode.sql').includes('record_tracked_set'), true);
assert.equal(routineEdit.includes('update_owned_program'), true);
assert.equal(routineEdit.includes('create_custom_exercise'), true);
assert.equal(routineEdit.includes('save_manual_program'), true);
assert.equal(activation.includes('save_owned_program'), true);
assert.equal(activation.includes('activate_owned_program'), true);
assert.equal(privilege.includes('enforce_program_activation'), true);
assert.equal(/revoke\s+update\s+on\s+table\s+public\.programs/i.test(privilege), true);
assert.equal(rest.startsWith('-- NOT APPLIED.'), true);
assert.equal(stripSql(rest).includes('rest_seconds'), true);
assert.equal(/\bgrant\b/i.test(stripSql(rest)), false);
assert.equal(saveProgram.includes('save_imported_program'), true);
assert.match(source('sql/routine-write-enablement.sql'), /-- NOT APPLIED\./);
assert.match(enablement, /GRANT EXECUTE ON FUNCTION public\.update_owned_program\(jsonb\)/);
assert.match(enablement, /GRANT EXECUTE ON FUNCTION public\.create_custom_exercise\(text\)/);
assert.equal(source('supabase/functions/import-workout/index.ts').includes('NOT DEPLOYED'), true);
assert.equal(source('sql/program-signup-no-starter.sql').includes('handle_new_user'), true);
assert.equal(source('sql/program-starter-disable.sql').includes('copy_starter_program'), true);

const review = reviewFromProgramDraft({
  programId: '9',
  name: 'Current split',
  isActive: true,
  days: [
    {
      id: '3',
      name: 'Push',
      subtitle: null,
      dayOrder: 1,
      exercises: [
        {
          id: '8',
          exerciseId: '4',
          name: 'Bench Press',
          order: 1,
          targetSets: 3,
          minReps: 5,
          maxReps: 8,
          notes: null,
        },
      ],
    },
  ],
});
const subtitled = {
  ...review,
  days: review.days.map((day) => ({ ...day, subtitle: 'Upper' })),
};
const withRest = {
  ...subtitled,
  days: subtitled.days.map((day) => ({
    ...day,
    exercises: day.exercises.map((exercise) => ({
      ...exercise,
      restSeconds: { acceptance: 'user_entered' as const, value: 90 },
    })),
  })),
};

assert.equal(validateManualRoutine(review).ok, true);
const requiredSubtitle = validateManualRoutine(review, { subtitleRequired: true });
assert.equal(requiredSubtitle.ok, false);
if (requiredSubtitle.ok) {
  throw new Error('blank subtitle was accepted');
}
assert.equal(requiredSubtitle.errors.includes(IMPORT_BLANK_SUBTITLE_MESSAGE), true);

const programs = [{ id: '1', name: 'Current split', isActive: true }];
const manualClosed = await saveManualProgram(subtitled, { userId: USER_ID, programs });
assert.deepEqual(manualClosed, { ok: false, errors: [MANUAL_SAVE_UNAVAILABLE_MESSAGE] });
let manualName: string | null = null;
const manualOpen = await saveManualProgram(withRest, {
  userId: USER_ID,
  programs,
  persistRestSeconds: true,
  rpc: async (name, args) => {
    manualName = name;
    assert.equal(args.p_program.days[0]?.exercises[0]?.rest_seconds, 90);
    return { data: '15', error: null };
  },
});
assert.equal(manualName, 'save_imported_program');
assert.deepEqual(manualOpen, { ok: true, programId: '15' });

const firstClosed = await saveManualProgram(subtitled, { userId: USER_ID, programs: [] });
assert.deepEqual(firstClosed, { ok: false, errors: [FIRST_PROGRAM_UNAVAILABLE_MESSAGE] });
let ownedArgs: { p_make_current?: boolean } | null = null;
const firstOpen = await saveManualProgram(subtitled, {
  userId: USER_ID,
  programs: [],
  ownedRpc: async (args) => {
    ownedArgs = args;
    return { data: '21', error: null };
  },
});
assert.equal(ownedArgs?.p_make_current, true);
assert.deepEqual(firstOpen, { ok: true, programId: '21' });

const currentUser = async () => ({ ok: true as const, data: USER_ID });
const userClosed = await saveManualProgramForCurrentUser(subtitled, {
  getUserId: currentUser,
  loadPrograms: async () => ({ ok: true, data: programs }),
});
assert.deepEqual(userClosed, { ok: false, errors: [MANUAL_SAVE_UNAVAILABLE_MESSAGE] });

const editClosed = await saveOwnedProgramEditForCurrentUser(subtitled, { programId: '9' }, {
  getUserId: currentUser,
});
assert.deepEqual(editClosed, { ok: false, errors: [EDIT_SAVE_BLOCKED_MESSAGE] });
let editProgramId: string | null = null;
const editOpen = await saveOwnedProgramEdit(subtitled, {
  userId: USER_ID,
  programId: '9',
  rpc: async (args) => {
    editProgramId = args.p_program.program_id;
    return { data: 9, error: null };
  },
});
assert.equal(editProgramId, '9');
assert.deepEqual(editOpen, { ok: true, programId: '9' });

const switchClosed = await activateOwnedProgramForCurrentUser('2', {
  getUserId: currentUser,
});
assert.equal(switchClosed.ok, false);
if (switchClosed.ok) {
  throw new Error('program switch ran while activation is off');
}
assert.equal(switchClosed.error.includes('Nothing was changed.'), true);
let activateCalls = 0;
const switchOpen = await activateOwnedProgramForCurrentUser('2', {
  getUserId: currentUser,
  rpc: async (programId) => {
    activateCalls += 1;
    assert.equal(programId, '2');
    return { data: '2', error: null };
  },
});
assert.equal(activateCalls, 1);
assert.deepEqual(switchOpen, { ok: true, programId: '2' });

const customClosed = await createCustomExercise('Band Fly');
assert.deepEqual(customClosed, { ok: false, error: CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE });
let customName: string | null = null;
const customOpen = await createCustomExercise('Band Fly', {
  rpc: async (name) => {
    customName = name;
    return { data: 44, error: null };
  },
});
assert.equal(customName, 'Band Fly');
assert.deepEqual(customOpen, { ok: true, exerciseId: '44', name: 'Band Fly' });

const originalFetch = globalThis.fetch;
let fetched = false;
globalThis.fetch = (() => {
  fetched = true;
  throw new Error('fetch must not be called');
}) as typeof fetch;
try {
  const importClosed = await importWorkoutDraft('Bench press 3 x 8');
  assert.deepEqual(importClosed, { ok: false, errors: [IMPORT_DISABLED_MESSAGE] });
  const importOpen = await importWorkoutDraft('Bench press 3 x 8', {
    enabled: true,
    catalog: [{ id: 4, name: 'Dumbbell Bench Press', equipment_type: 'dumbbell' }],
    invoke: async (body) => {
      assert.equal(body.source, 'Bench press 3 x 8');
      return {
        data: JSON.parse(source('scripts/fixtures/workout-import/valid-extracted.json')),
        error: null,
      };
    },
  });
  assert.equal(importOpen.ok, true);
  assert.equal(fetched, false);
} finally {
  globalThis.fetch = originalFetch;
}

const addedClosed = prepareTrackedWrite({
  loadMode: 'added',
  weight: 25,
  assistance: null,
  weightUnit: 'lb',
});
assert.deepEqual(addedClosed, { ok: false, error: LOAD_MODE_SAVE_BLOCKED_MESSAGE });
const addedOpen = prepareTrackedWrite({
  loadMode: 'added',
  weight: 25,
  assistance: null,
  weightUnit: 'lb',
  persistLoadMode: true,
});
assert.equal(addedOpen.ok, true);
if (!addedOpen.ok) {
  throw new Error(addedOpen.error);
}
assert.equal(addedOpen.extra.load_mode, 'added');
assert.equal(addedOpen.weight, 25);
const bodyweightClosed = prepareTrackedWrite({
  loadMode: 'bodyweight',
  weight: null,
  assistance: null,
  weightUnit: 'lb',
});
assert.equal(bodyweightClosed.ok, true);
if (!bodyweightClosed.ok) {
  throw new Error(bodyweightClosed.error);
}
assert.deepEqual(bodyweightClosed.extra, {});

const defaultPayload = toSavePayload(toImportPreview(withRest), USER_ID, { hasActiveProgram: true });
assert.equal(defaultPayload.ok, true);
if (!defaultPayload.ok) {
  throw new Error(defaultPayload.errors.join('\n'));
}
assert.equal(JSON.stringify(defaultPayload.payload).includes('rest_seconds'), false);
const restPayload = toSavePayload(toImportPreview(withRest), USER_ID, {
  hasActiveProgram: true,
  persistRestSeconds: true,
});
assert.equal(restPayload.ok, true);
if (!restPayload.ok) {
  throw new Error(restPayload.errors.join('\n'));
}
assert.equal(restPayload.payload.days[0]?.exercises[0]?.rest_seconds, 90);

const builder = source('components/manual-program-builder.tsx');
assert.equal(builder.includes('CUSTOM_EXERCISE_WRITES_ENABLED'), true);
assert.equal(builder.includes('to your library'), true);
const importScreen = source('app/(tabs)/program/import.tsx');
assert.equal(importScreen.includes('importWorkoutDraft(source)'), true);
assert.equal(importScreen.includes('saveManualProgramForCurrentUser(review)'), true);
assert.equal(importScreen.includes('XAI_API_KEY'), false);

console.log('nine flag path checks passed');
