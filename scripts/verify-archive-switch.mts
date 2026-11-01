import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EDIT_SAVE_BLOCKED_MESSAGE,
  requestProgramSwitch,
  saveOwnedProgramEdit,
  savedProgramListItems,
} from '../lib/import/manual-program.ts';
import {
  activateOwnedProgramForCurrentUser,
  loadProgramDraftForCurrentUser,
  PROGRAM_SWITCH_UNAVAILABLE_MESSAGE,
} from '../lib/import/manual-program-client.ts';
import { reviewFromProgramDraft } from '../lib/import/program-draft.ts';
import { isActiveProgramDay, visibleProgramDays } from '../lib/load-mode.ts';

const USER_ID = '11111111-1111-1111-1111-111111111111';

function source(name: string): string {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

const days = visibleProgramDays([
  { id: '3', name: 'Push', archivedAt: null },
  { id: '9', name: 'Old pull', archivedAt: '2026-10-30T00:00:00Z' },
  { id: '4', name: 'Legs', archivedAt: '' },
]);
assert.deepEqual(days.map((day) => day.id), ['3', '4']);
assert.equal(isActiveProgramDay('2026-10-30T00:00:00Z'), false);
assert.equal(isActiveProgramDay(null), true);

const client = source('lib/import/manual-program-client.ts');
const draftSelect = client.slice(
  client.indexOf('async function defaultSelectDraftDays'),
  client.indexOf('async function defaultSelectDraftExercises'),
);
assert.equal(draftSelect.includes(".is('archived_at', null)"), true);
assert.equal(draftSelect.includes('isMissingColumnError(withArchive.error, \'archived_at\')'), true);

const session = source('lib/workout-session.ts');
const listDays = session.slice(session.indexOf('export async function listProgramDays'), session.indexOf('export async function ', session.indexOf('export async function listProgramDays') + 10));
assert.equal(listDays.includes(".is('archived_at', null)"), true);

const programDay = source('app/(tabs)/program/[id].tsx');
assert.equal(programDay.includes('isActiveProgramDay(archivedAt)'), true);
assert.equal(programDay.includes('ARCHIVED_DAY_MESSAGE'), true);

const loaded = await loadProgramDraftForCurrentUser(
  { programId: '9' },
  {
    getUserId: async () => ({ ok: true, data: USER_ID }),
    selectProgram: async (_userId, programId) => {
      assert.equal(programId, '9');
      return { data: { id: '9', name: 'Current split', is_active: true }, error: null };
    },
    selectDays: async (programId) => {
      assert.equal(programId, '9');
      return {
        data: [{ id: '3', name: 'Push', subtitle: 'Upper', day_order: 1 }],
        error: null,
      };
    },
    selectDraftExercises: async (dayIds) => {
      assert.deepEqual([...dayIds], ['3']);
      return {
        data: [
          {
            id: '8',
            program_day_id: '3',
            exercise_id: '4',
            exercise_order: 1,
            target_sets: 3,
            min_reps: 5,
            max_reps: 8,
            notes: null,
            exercise: { name: 'Bench Press' },
          },
        ],
        error: null,
      };
    },
  },
);
assert.equal(loaded.ok, true);
if (!loaded.ok) {
  throw new Error(loaded.error);
}
assert.deepEqual(loaded.draft.days.map((day) => day.id), ['3']);

const review = reviewFromProgramDraft(loaded.draft);
let editCalls = 0;
const edited = await saveOwnedProgramEdit(review, {
  userId: USER_ID,
  programId: loaded.draft.programId,
  rpc: async (args) => {
    editCalls += 1;
    assert.equal(args.p_program.program_id, '9');
    assert.deepEqual(
      args.p_program.days.map((day) => day.day_id),
      ['3'],
    );
    assert.equal(JSON.stringify(args.p_program).includes('rest_seconds'), false);
    assert.equal(JSON.stringify(args.p_program).includes('is_active'), false);
    return { data: 9, error: null };
  },
});
assert.equal(editCalls, 1);
assert.deepEqual(edited, { ok: true, programId: '9' });

const locked = await saveOwnedProgramEdit(review, {
  userId: USER_ID,
  programId: '9',
  rpc: async () => ({ data: null, error: { message: 'archived_day_locked' } }),
});
assert.equal(locked.ok, false);
if (locked.ok) {
  throw new Error('archived day was edited');
}
assert.deepEqual(locked.errors, ['That day is archived. Nothing was changed.']);

const closedEdit = await saveOwnedProgramEdit(review, { userId: USER_ID, programId: '9' });
assert.deepEqual(closedEdit, { ok: false, errors: [EDIT_SAVE_BLOCKED_MESSAGE] });

const programs = [
  { id: '1', name: 'Current split', isActive: true },
  { id: '2', name: 'Off season', isActive: false },
];
assert.deepEqual(
  savedProgramListItems(programs).map((item) => item.offerSwitch),
  [false, true],
);
const alreadyCurrent = requestProgramSwitch(programs, '1');
assert.equal(alreadyCurrent.ok, false);
const offered = requestProgramSwitch(programs, '2');
assert.equal(offered.ok, true);
if (!offered.ok) {
  throw new Error(offered.error);
}
assert.equal(offered.prompt.programId, '2');

const closedSwitch = await activateOwnedProgramForCurrentUser('2', {
  getUserId: async () => ({ ok: true, data: USER_ID }),
});
assert.deepEqual(closedSwitch, { ok: false, error: PROGRAM_SWITCH_UNAVAILABLE_MESSAGE });

let activateCalls = 0;
const switched = await activateOwnedProgramForCurrentUser('2', {
  getUserId: async () => ({ ok: true, data: USER_ID }),
  rpc: async (programId) => {
    activateCalls += 1;
    assert.equal(programId, '2');
    return { data: '2', error: null };
  },
});
assert.equal(activateCalls, 1);
assert.deepEqual(switched, { ok: true, programId: '2' });

const savedScreen = source('app/(tabs)/program/saved.tsx');
assert.equal(savedScreen.includes('activateOwnedProgramForCurrentUser(programId)'), true);
assert.equal(savedScreen.includes('.update('), false);
assert.equal(savedScreen.includes('is_active'), false);

console.log('archive edit and program switch checks passed');
