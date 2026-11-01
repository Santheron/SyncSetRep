import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createCustomExercise } from '../lib/import/custom-exercise.ts';
import { IMPORT_ENABLED, PERSIST_REST_SECONDS, SUBTITLE_REQUIRED } from '../lib/import/flags.ts';
import { importWorkoutDraft, IMPORT_DISABLED_MESSAGE } from '../lib/import/import-workout.ts';
import {
  CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE,
  EDIT_SAVE_BLOCKED_MESSAGE,
  ownedProgramUpdatePayload,
  saveManualProgram,
  saveOwnedProgramEdit,
} from '../lib/import/manual-program.ts';
import {
  ACTIVATION_RPC_ENABLED,
  MANUAL_SAVE_RPC_ENABLED,
  OWNED_PROGRAM_EDIT_ENABLED,
  OWNED_PROGRAM_RPC_ENABLED,
} from '../lib/import/manual-program-client.ts';
import { CUSTOM_EXERCISE_WRITES_ENABLED } from '../lib/import/planned-exercises.ts';
import { reviewFromProgramDraft } from '../lib/import/program-draft.ts';
import { IMPORT_BLANK_SUBTITLE_MESSAGE } from '../lib/import/save-plan.ts';
import { PERSIST_LOAD_MODE } from '../lib/load-mode.ts';

const USER_ID = '11111111-1111-1111-1111-111111111111';

assert.equal(IMPORT_ENABLED, false);
assert.equal(PERSIST_REST_SECONDS, false);
assert.equal(SUBTITLE_REQUIRED, false);
assert.equal(PERSIST_LOAD_MODE, false);
assert.equal(MANUAL_SAVE_RPC_ENABLED, false);
assert.equal(OWNED_PROGRAM_RPC_ENABLED, false);
assert.equal(OWNED_PROGRAM_EDIT_ENABLED, false);
assert.equal(ACTIVATION_RPC_ENABLED, false);
assert.equal(CUSTOM_EXERCISE_WRITES_ENABLED, false);

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

const blankSubtitle = await saveManualProgram(review, {
  userId: USER_ID,
  programs: [{ id: '1', name: 'Current split', isActive: true }],
  subtitleRequired: true,
  rpc: async () => {
    throw new Error('rpc must not be called');
  },
});
assert.equal(blankSubtitle.ok, false);
if (blankSubtitle.ok) {
  throw new Error('blank subtitle was saved');
}
assert.deepEqual(blankSubtitle.errors, [IMPORT_BLANK_SUBTITLE_MESSAGE]);

let savedPayload: unknown = null;
const saved = await saveManualProgram(
  {
    ...review,
    days: review.days.map((day) => ({ ...day, subtitle: 'Upper' })),
  },
  {
    userId: USER_ID,
    programs: [{ id: '1', name: 'Current split', isActive: true }],
    rpc: async (_name, args) => {
      savedPayload = args.p_program;
      return { data: '15', error: null };
    },
  },
);
assert.deepEqual(saved, { ok: true, programId: '15' });
assert.equal(JSON.stringify(savedPayload).includes('rest_seconds'), false);
assert.equal(JSON.stringify(savedPayload).includes('load_mode'), false);

const blockedEdit = await saveOwnedProgramEdit(review, { userId: USER_ID, programId: '9' });
assert.deepEqual(blockedEdit, { ok: false, errors: [EDIT_SAVE_BLOCKED_MESSAGE] });

const described = ownedProgramUpdatePayload(
  {
    ...review,
    days: review.days.map((day) => ({ ...day, subtitle: 'Upper' })),
  },
  '9',
);
assert.equal(described.ok, true);
if (!described.ok) {
  throw new Error('edit payload was refused');
}
assert.equal(described.payload.program_id, '9');
assert.equal(described.payload.days[0]?.day_id, '3');
assert.equal(described.payload.days[0]?.exercises[0]?.exercise_id, '4');
assert.equal(Object.hasOwn(described.payload.days[0]?.exercises[0] ?? {}, 'custom_name'), false);

let edited = false;
const storedEdit = await saveOwnedProgramEdit(
  {
    ...review,
    days: review.days.map((day) => ({ ...day, subtitle: 'Upper' })),
  },
  {
    userId: USER_ID,
    programId: '9',
    rpc: async (args) => {
      edited = true;
      assert.equal(args.p_program.days[0]?.day_id, '3');
      return { data: 9, error: null };
    },
  },
);
assert.equal(edited, true);
assert.deepEqual(storedEdit, { ok: true, programId: '9' });

const blockedCustom = await createCustomExercise('Band Fly');
assert.deepEqual(blockedCustom, { ok: false, error: CUSTOM_EXERCISE_SAVE_BLOCKED_MESSAGE });
const created = await createCustomExercise('  Band Fly  ', {
  rpc: async (name) => {
    assert.equal(name, 'Band Fly');
    return { data: 44, error: null };
  },
});
assert.deepEqual(created, { ok: true, exerciseId: '44', name: 'Band Fly' });

const model = JSON.parse(
  readFileSync(new URL('./fixtures/workout-import/valid-extracted.json', import.meta.url), 'utf8'),
);
let fetched = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = (() => {
  fetched = true;
  throw new Error('fetch must not be called');
}) as typeof fetch;
try {
  const disabled = await importWorkoutDraft('Bench press 3 x 8');
  assert.deepEqual(disabled, { ok: false, errors: [IMPORT_DISABLED_MESSAGE] });
  const imported = await importWorkoutDraft('Bench press 3 x 8', {
    catalog: [{ id: 4, name: 'Dumbbell Bench Press', equipment_type: 'dumbbell' }],
    invoke: async (body) => {
      assert.equal(body.source, 'Bench press 3 x 8');
      return { data: model, error: null };
    },
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) {
    throw new Error('import was refused');
  }
  assert.equal(imported.review.programName, 'Upper Lower');
  assert.equal(imported.review.origin, 'import');
  assert.equal(imported.review.days[0]?.exercises[0]?.exerciseId, '4');
  assert.equal(fetched, false);
} finally {
  globalThis.fetch = originalFetch;
}

const importScreen = readFileSync(new URL('../app/(tabs)/program/import.tsx', import.meta.url), 'utf8');
assert.equal(importScreen.includes('XAI_API_KEY'), false);
assert.equal(importScreen.includes('api.x.ai'), false);
assert.equal(importScreen.includes('importWorkoutDraft'), true);
const functionSource = readFileSync(
  new URL('../supabase/functions/import-workout/index.ts', import.meta.url),
  'utf8',
);
assert.equal(functionSource.includes('NOT DEPLOYED'), true);
assert.equal(functionSource.includes('SERVICE_ROLE'), false);
assert.equal(functionSource.includes('workout_sets'), false);
assert.equal(functionSource.includes('workout_sessions'), false);

console.log('feature completion checks passed');
