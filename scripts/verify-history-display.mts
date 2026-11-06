import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  historySetDisplayLine,
  historySetTracking,
  historyTrackingColumnMissing,
} from '../lib/history-sets.ts';

const times = '×';

type SetRow = {
  weight: number | null;
  reps: number | null;
  load_mode?: string | null;
  assistance?: number | string | null;
  weight_unit?: string | null;
};

function displayLine(row: SetRow): string {
  const tracking = historySetTracking(row);
  return historySetDisplayLine({
    weight: row.weight,
    reps: row.reps,
    loadMode: tracking.loadMode,
    assistance: tracking.assistance,
    weightUnit: tracking.weightUnit,
  });
}

assert.equal(
  displayLine({ weight: null, reps: 8, load_mode: 'bodyweight', assistance: null, weight_unit: 'lb' }),
  `BW ${times} 8`,
);
assert.equal(
  displayLine({ weight: 25, reps: 5, load_mode: 'added', assistance: null, weight_unit: 'lb' }),
  `BW + 25 lb ${times} 5`,
);
assert.equal(
  displayLine({ weight: null, reps: 6, load_mode: 'assisted', assistance: 20, weight_unit: 'lb' }),
  `Assisted 20 lb ${times} 6`,
);
assert.equal(
  displayLine({ weight: 135, reps: 5, load_mode: null, assistance: null, weight_unit: null }),
  `135 lb ${times} 5`,
);
assert.equal(displayLine({ weight: null, reps: 8 }), '8 reps');
assert.equal(displayLine({ weight: 0, reps: 8, load_mode: null }), '8 reps');
assert.equal(
  displayLine({ weight: 10, reps: 5, load_mode: 'added', assistance: null, weight_unit: 'kg' }),
  `BW + 10 kg ${times} 5`,
);

const legacyAfterMissingColumn = displayLine({ weight: 135, reps: 5 });
assert.equal(legacyAfterMissingColumn, `135 lb ${times} 5`);
assert.equal(
  historyTrackingColumnMissing({ code: 'PGRST204', message: 'Could not find the load_mode column' }),
  true,
);
assert.equal(
  historyTrackingColumnMissing({ code: '42703', message: 'column workout_sets.assistance does not exist' }),
  true,
);
assert.equal(
  historyTrackingColumnMissing({ code: '42501', message: 'permission denied for table workout_sets' }),
  false,
);

const historyScreen = readFileSync(
  new URL('../app/(tabs)/history/[sessionId].tsx', import.meta.url),
  'utf8',
);
assert.equal(historyScreen.includes('historySetDisplayLine(set)'), true);
assert.equal(historyScreen.includes('historyTrackingColumnMissing(trackedSets.error)'), true);
assert.equal(historyScreen.includes('HISTORY_SET_SELECT_LEGACY'), true);
assert.equal(historyScreen.includes('HISTORY_SET_SELECT_TRACKED'), true);
assert.equal(historyScreen.includes('archived_at'), false);
assert.equal(historyScreen.includes('planned_weight'), false);
const historySets = readFileSync(new URL('../lib/history-sets.ts', import.meta.url), 'utf8');
assert.equal(historySets.includes('planned_weight'), false);
const workoutScreen = readFileSync(new URL('../app/workout/[sessionId].tsx', import.meta.url), 'utf8');
assert.equal(workoutScreen.includes("value={String(values.weight ?? '')}"), true);
assert.equal(workoutScreen.includes('formatPlannedWeightSentence'), true);
assert.equal(workoutScreen.includes('saveWorkoutSet'), false);
assert.equal(workoutScreen.includes('planned_weight'), false);
const persistedSets = readFileSync(new URL('../hooks/use-persisted-workout-sets.ts', import.meta.url), 'utf8');
assert.equal(persistedSets.includes('saveWorkoutSet'), true);
assert.equal(persistedSets.includes('planned_weight'), false);
assert.equal(persistedSets.includes('plannedWeight'), false);

console.log('history display checks passed');
