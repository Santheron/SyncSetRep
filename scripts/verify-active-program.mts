import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  decideActiveProgram,
  NO_ACTIVE_PROGRAM_CODE,
  NO_ACTIVE_PROGRAM_MESSAGE,
  programLoadErrorText,
} from '../lib/active-program.ts';

function source(path: string) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

assert.deepEqual(
  decideActiveProgram({ signedIn: false, queryFailed: false, activeId: '1' }),
  { action: 'refuse', code: 'signed-out' },
);
assert.deepEqual(
  decideActiveProgram({ signedIn: true, queryFailed: true, activeId: '1' }),
  { action: 'refuse', code: 'query-error' },
);
assert.deepEqual(
  decideActiveProgram({ signedIn: true, queryFailed: true, activeId: null }),
  { action: 'refuse', code: 'query-error' },
);
assert.deepEqual(
  decideActiveProgram({ signedIn: true, queryFailed: false, activeId: '4' }),
  { action: 'use', programId: '4' },
);
assert.deepEqual(
  decideActiveProgram({ signedIn: true, queryFailed: false, activeId: null }),
  { action: 'refuse', code: 'no-active-program' },
);
assert.deepEqual(
  decideActiveProgram({ signedIn: true, queryFailed: false, activeId: '' }),
  { action: 'refuse', code: 'no-active-program' },
);

assert.equal(
  programLoadErrorText('Could not load program days.', {
    error: NO_ACTIVE_PROGRAM_MESSAGE,
    code: NO_ACTIVE_PROGRAM_CODE,
  }),
  NO_ACTIVE_PROGRAM_MESSAGE,
);
assert.equal(
  programLoadErrorText('Could not load workout days.', { error: 'db down' }),
  'Could not load workout days. db down',
);

const programs = source('lib/programs.ts');
const profile = source('lib/profile.ts');
const workout = source('lib/workout-session.ts');
const programDay = source('app/(tabs)/program/[id].tsx');
const programIndex = source('app/(tabs)/program/index.tsx');
const workoutSelect = source('app/workout/select.tsx');

assert.equal(programs.includes('ensureOwnProgram'), false);
assert.equal(programs.includes('copy_starter'), false);
assert.equal(programs.includes('.rpc('), false);
assert.equal(programs.split(".from('programs')").length - 1, 1);
assert.equal(programs.includes(".eq('is_active', true)"), true);
assert.equal(programs.includes('loadActiveProgram'), true);
assert.equal(profile.includes('ensureOwnProgram'), false);
assert.equal(profile.includes('copy_starter'), false);
assert.equal(profile.includes('programs'), false);
assert.equal(workout.includes('ensureOwnProgram'), false);
assert.equal(workout.includes('copy_starter'), false);
assert.equal(workout.includes('loadActiveProgram'), true);
assert.equal(programDay.includes('loadActiveProgram'), true);
assert.equal(programDay.includes('ensureOwnProgram'), false);
assert.equal(programIndex.includes('NO_ACTIVE_PROGRAM_CODE'), true);
assert.equal(programIndex.includes('Could not load program days.'), true);
assert.equal(programIndex.includes('href="/program/build"'), true);
assert.equal(programIndex.includes('href="/program/saved"'), true);
assert.equal(workoutSelect.includes('NO_ACTIVE_PROGRAM_CODE'), true);
assert.equal(workoutSelect.includes('Could not load workout days.'), true);
assert.equal(workoutSelect.includes('listUnfinishedSessions'), true);

console.log('active program loader checks passed');
