import assert from 'node:assert/strict';

import { formatWorkoutActionError } from '../lib/workout-action-errors.ts';
import {
  applyDiscardConfirmation,
  compareUnfinishedSessions,
  createAsyncLock,
  formatUnfinishedSessionWhen,
  partitionUnfinishedSessions,
  selectUnfinishedDeleteIds,
  sortUnfinishedSessions,
  workoutNavigationTarget,
} from '../lib/workout-day-selection.ts';

type Session = {
  id: string;
  programDayId: string;
  startedAt: string;
  name: string;
};

function session(id: string, programDayId: string, startedAt: string, name: string): Session {
  return { id, programDayId, startedAt, name };
}

const newer = session('20', '2', '2026-10-28T18:00:00.000Z', 'Pull');
const olderSameDay = session('9', '2', '2026-10-27T18:00:00.000Z', 'Pull');
const sameTimeHigherId = session('15', '2', '2026-10-27T18:00:00.000Z', 'Pull later id');
const otherDay = session('11', '4', '2026-10-28T12:00:00.000Z', 'Legs');
const otherOlder = session('3', '1', '2026-10-20T12:00:00.000Z', 'Push');
const invalidDate = session('30', '2', 'not-a-date', 'Pull unknown');

const input = [olderSameDay, otherDay, newer, sameTimeHigherId, otherOlder, invalidDate];
const sorted = sortUnfinishedSessions(input);

assert.deepEqual(
  sorted.map((item) => item.id),
  ['20', '11', '15', '9', '3', '30'],
  'newest valid start comes first, then id descending, invalid dates last',
);
assert.deepEqual(
  input.map((item) => item.id),
  ['9', '11', '20', '15', '3', '30'],
  'sorting does not mutate the original list',
);
assert.equal(compareUnfinishedSessions(sameTimeHigherId, olderSameDay), -1);

const selected = partitionUnfinishedSessions(input, '2');

assert.deepEqual(
  selected.sameDay.map((item) => item.id),
  ['20', '15', '9', '30'],
  'every unfinished session for the selected day is kept, newest first',
);
assert.deepEqual(
  selected.otherDays.map((item) => item.name),
  ['Legs', 'Push'],
  'other days keep their own workout names',
);
assert.equal(
  selected.sameDay.some((item) => item.programDayId !== '2'),
  false,
);
assert.equal(
  selected.otherDays.some((item) => item.programDayId === '2'),
  false,
);

const numericDay = partitionUnfinishedSessions(
  [session('4', '7', '2026-10-01T00:00:00.000Z', 'Arms')],
  '7',
);
assert.equal(numericDay.sameDay.length, 1);
assert.equal(numericDay.otherDays.length, 0);

const empty = partitionUnfinishedSessions([], '2');
assert.deepEqual(empty, { sameDay: [], otherDays: [] });

assert.equal(formatUnfinishedSessionWhen('not-a-date'), 'Unknown start time');
assert.notEqual(formatUnfinishedSessionWhen('2026-10-28T18:05:00.000Z'), 'Unknown start time');

let discarded = false;
applyDiscardConfirmation('cancel', () => {
  discarded = true;
});
assert.equal(discarded, false, 'cancelling discard does not discard');
applyDiscardConfirmation('discard', () => {
  discarded = true;
});
assert.equal(discarded, true, 'confirming discard discards');

assert.deepEqual(workoutNavigationTarget('home', 'discard', '12'), { stay: true });
assert.deepEqual(workoutNavigationTarget('select', 'discard', '12'), { stay: true });
assert.deepEqual(workoutNavigationTarget('home', 'start', null), {
  stay: false,
  method: 'push',
  pathname: '/workout/select',
});
assert.deepEqual(workoutNavigationTarget('select', 'start', '12'), {
  stay: false,
  method: 'replace',
  pathname: '/workout/[sessionId]',
  sessionId: '12',
});
assert.deepEqual(workoutNavigationTarget('home', 'resume', '12'), {
  stay: false,
  method: 'push',
  pathname: '/workout/[sessionId]',
  sessionId: '12',
});
assert.equal(workoutNavigationTarget('select', 'resume', '  ').stay, true);

const finishedGuard = selectUnfinishedDeleteIds(['9', '4'], ['9']);
assert.equal(finishedGuard.ok, false);
if (!finishedGuard.ok) {
  assert.match(finishedGuard.error, /Completed workouts stay saved/);
}
assert.deepEqual(selectUnfinishedDeleteIds(['9'], ['9']), { ok: true, ids: ['9'] });
assert.deepEqual(selectUnfinishedDeleteIds([], ['9']), { ok: true, ids: [] });

assert.match(
  formatWorkoutActionError({
    action: 'start',
    code: '42501',
    message: 'new row violates row-level security policy',
  }),
  /permission/i,
);
assert.match(
  formatWorkoutActionError({
    action: 'save-set',
    message: 'duplicate key value violates unique constraint "workout_sets_session_exercise_set_uidx"',
  }),
  /already saved/i,
);
assert.match(
  formatWorkoutActionError({
    action: 'start',
    message: 'TypeError: Network request failed',
  }),
  /connection dropped/i,
);
assert.equal(
  formatWorkoutActionError({
    action: 'discard',
    message: 'That workout is no longer unfinished. Completed workouts stay saved.',
  }),
  'That workout is no longer unfinished. Completed workouts stay saved.',
);

let activeStarts = 0;
let maxActiveStarts = 0;
const runExclusive = createAsyncLock();

function delayedStart(value: number) {
  return runExclusive(async () => {
    activeStarts += 1;
    maxActiveStarts = Math.max(maxActiveStarts, activeStarts);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeStarts -= 1;
    return value;
  });
}

const startResults = await Promise.all([delayedStart(1), delayedStart(2), delayedStart(3)]);
assert.deepEqual(startResults, [1, 2, 3]);
assert.equal(maxActiveStarts, 1, 'workout starts do not overlap');

console.log('workout day selection checks passed');
