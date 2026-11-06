import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIVATION_RPC_ENABLED,
  MANUAL_SAVE_RPC_ENABLED,
  OWNED_PROGRAM_EDIT_ENABLED,
  OWNED_PROGRAM_RPC_ENABLED,
} from '../lib/import/manual-program-client.ts';
import { historySetTracking, historyTrackingColumnMissing } from '../lib/history-sets.ts';
import { applyManualEdit, validateManualRoutine } from '../lib/import/manual-program.ts';
import { CUSTOM_EXERCISE_WRITES_ENABLED } from '../lib/import/planned-exercises.ts';
import { createManualProgramReview, toImportPreview } from '../lib/import/review-editor.ts';
import {
  ADDED_WEIGHT_MESSAGE,
  ASSISTANCE_SEPARATE_MESSAGE,
  BODYWEIGHT_ZERO_MESSAGE,
  LOAD_MODE_INVALID_MESSAGE,
  LOAD_MODE_SAVE_BLOCKED_MESSAGE,
  PERSIST_LOAD_MODE,
  TRACKING_MODE_LABELS,
  formatHistorySetLine,
  formatLegacyLoad,
  formatTrackedLoad,
  isActiveProgramDay,
  prepareTrackedWrite,
  trackingModeLabel,
  visibleProgramDays,
} from '../lib/load-mode.ts';
import { formatSetLoad } from '../lib/workout-format.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

function source(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

const times = '×';

assert.equal(PERSIST_LOAD_MODE, false);
assert.equal(ACTIVATION_RPC_ENABLED, false);
assert.equal(MANUAL_SAVE_RPC_ENABLED, false);
assert.equal(OWNED_PROGRAM_RPC_ENABLED, false);
assert.equal(CUSTOM_EXERCISE_WRITES_ENABLED, false);
assert.equal(OWNED_PROGRAM_EDIT_ENABLED, false);

assert.equal(formatLegacyLoad(null), 'BW');
assert.equal(formatLegacyLoad(''), 'BW');
assert.equal(formatLegacyLoad(0), 'BW');
assert.equal(formatLegacyLoad('0'), 'BW');
assert.equal(formatLegacyLoad(135), '135 lb');
assert.equal(formatLegacyLoad('135'), '135 lb');
assert.equal(formatLegacyLoad(10.5), '10.5 lb');
assert.equal(formatSetLoad(135), '135 lb');
assert.equal(formatSetLoad(null), 'BW');
assert.equal(formatSetLoad(0), 'BW');

assert.equal(formatTrackedLoad({ weight: 135 }), '135 lb');
assert.equal(formatTrackedLoad({ loadMode: null, weight: 0 }), 'BW');
assert.equal(formatTrackedLoad({ loadMode: 'bodyweight', weight: 0 }), 'BW');
assert.equal(formatTrackedLoad({ loadMode: 'added', weight: 10, weightUnit: 'lb' }), 'BW + 10 lb');
assert.equal(formatTrackedLoad({ loadMode: 'added', weight: 10, weightUnit: 'kg' }), 'BW + 10 kg');
assert.equal(
  formatTrackedLoad({ loadMode: 'assisted', assistance: 20, weight: null, weightUnit: 'lb' }),
  'Assisted 20 lb',
);
assert.equal(
  formatTrackedLoad({ loadMode: 'assisted', assistance: 20, weight: null, weightUnit: 'kg' }),
  'Assisted 20 kg',
);
assert.equal(formatTrackedLoad({ loadMode: null, weight: 25 }).includes('Assisted'), false);
assert.equal(formatTrackedLoad({ loadMode: null, weight: 25 }).includes('BW +'), false);
assert.equal(formatTrackedLoad({ loadMode: 'added', weight: '', weightUnit: 'lb' }), 'BW +');
assert.equal(formatTrackedLoad({ loadMode: 'added', weight: '0', weightUnit: 'kg' }), 'BW +');
assert.equal(formatTrackedLoad({ loadMode: 'added', weight: null, weightUnit: 'lb' }), 'BW +');
assert.equal(
  formatTrackedLoad({ loadMode: 'assisted', assistance: '', weight: null, weightUnit: 'lb' }),
  'Assisted',
);
assert.equal(
  formatTrackedLoad({ loadMode: 'assisted', assistance: 0, weight: null, weightUnit: 'kg' }),
  'Assisted',
);
assert.equal(
  formatTrackedLoad({ loadMode: 'assisted', assistance: null, weight: null }),
  'Assisted',
);
assert.equal(formatTrackedLoad({ loadMode: 'bodyweight', weight: '' }), 'BW');
assert.equal(formatTrackedLoad({ loadMode: null, weight: 0 }), 'BW');

assert.equal(formatHistorySetLine({ weight: 135, reps: 5 }), `135 lb ${times} 5`);
assert.equal(formatHistorySetLine({ weight: null, reps: 8 }), '8 reps');
assert.equal(formatHistorySetLine({ weight: 0, reps: 8 }), '8 reps');
assert.equal(formatHistorySetLine({ weight: '', reps: 8 }), '8 reps');
assert.equal(formatHistorySetLine({ weight: 135, reps: 5 }).includes('Assisted'), false);
assert.equal(formatHistorySetLine({ weight: 135, reps: 5 }).includes('BW +'), false);
const legacyHistory = historySetTracking({
  load_mode: null,
  assistance: null,
  weight_unit: null,
});
assert.equal(
  formatHistorySetLine({ weight: null, reps: 8, ...legacyHistory }),
  '8 reps',
);
const assistedHistory = historySetTracking({
  load_mode: 'assisted',
  assistance: '20',
  weight_unit: 'lb',
});
assert.equal(
  formatHistorySetLine({ weight: null, reps: 5, ...assistedHistory }),
  `Assisted 20 lb ${times} 5`,
);
assert.equal(
  historyTrackingColumnMissing({ code: 'PGRST204', message: 'Could not find load_mode' }),
  true,
);
assert.equal(
  historyTrackingColumnMissing({ code: '42501', message: 'permission denied for load_mode' }),
  false,
);
assert.equal(
  formatHistorySetLine({ weight: 10, reps: 5, loadMode: 'added', weightUnit: 'kg' }),
  `BW + 10 kg ${times} 5`,
);
assert.equal(
  formatHistorySetLine({
    weight: null,
    reps: 6,
    loadMode: 'assisted',
    assistance: 20,
    weightUnit: 'lb',
  }),
  `Assisted 20 lb ${times} 6`,
);

assert.equal(trackingModeLabel(null), TRACKING_MODE_LABELS.external);
assert.equal(trackingModeLabel('bodyweight'), 'Bodyweight');
assert.equal(trackingModeLabel('added'), 'Added weight');
assert.equal(trackingModeLabel('assisted'), 'Assisted');

const legacy = prepareTrackedWrite({ loadMode: null, weight: 135, assistance: null });
assert.equal(legacy.ok, true);
if (legacy.ok) {
  assert.equal(legacy.weight, 135);
  assert.deepEqual(legacy.extra, {});
}

const bodyweight = prepareTrackedWrite({
  loadMode: 'bodyweight',
  weight: 0,
  assistance: null,
  weightUnit: 'kg',
});
assert.equal(bodyweight.ok, true);
if (bodyweight.ok) {
  assert.equal(bodyweight.weight, null);
  assert.deepEqual(bodyweight.extra, {});
}

const bodyweightBlank = prepareTrackedWrite({ loadMode: 'bodyweight', weight: null });
assert.equal(bodyweightBlank.ok, true);
if (bodyweightBlank.ok) {
  assert.equal(bodyweightBlank.weight, null);
}

assert.deepEqual(
  prepareTrackedWrite({ loadMode: 'bodyweight', weight: -1 }),
  { ok: false, error: ASSISTANCE_SEPARATE_MESSAGE },
);
assert.deepEqual(
  prepareTrackedWrite({ loadMode: 'bodyweight', weight: 10 }),
  { ok: false, error: BODYWEIGHT_ZERO_MESSAGE },
);
assert.deepEqual(
  prepareTrackedWrite({ loadMode: 'bodyweight', weight: 0, assistance: 5 }),
  { ok: false, error: BODYWEIGHT_ZERO_MESSAGE },
);
assert.deepEqual(
  prepareTrackedWrite({ loadMode: 'added', weight: 0 }),
  { ok: false, error: ADDED_WEIGHT_MESSAGE },
);
assert.deepEqual(
  prepareTrackedWrite({ loadMode: 'added', weight: 10, assistance: 5 }),
  { ok: false, error: ADDED_WEIGHT_MESSAGE },
);
assert.deepEqual(
  prepareTrackedWrite({ loadMode: 'added', weight: 10, weightUnit: 'lb' }),
  { ok: false, error: LOAD_MODE_SAVE_BLOCKED_MESSAGE },
);
assert.deepEqual(
  prepareTrackedWrite({ loadMode: 'assisted', assistance: 20, weight: 10 }),
  { ok: false, error: ASSISTANCE_SEPARATE_MESSAGE },
);
assert.deepEqual(
  prepareTrackedWrite({ loadMode: 'assisted', assistance: 0, weight: null }),
  { ok: false, error: ASSISTANCE_SEPARATE_MESSAGE },
);
assert.deepEqual(
  prepareTrackedWrite({ loadMode: 'assisted', assistance: 20, weight: null, weightUnit: 'kg' }),
  { ok: false, error: LOAD_MODE_SAVE_BLOCKED_MESSAGE },
);
assert.deepEqual(
  prepareTrackedWrite({ loadMode: 'external' as 'added', weight: 10 }),
  { ok: false, error: LOAD_MODE_INVALID_MESSAGE },
);

const persistedAssisted = prepareTrackedWrite({
  loadMode: 'assisted',
  weight: null,
  assistance: 20,
  weightUnit: 'kg',
  persistLoadMode: true,
});
assert.equal(persistedAssisted.ok, true);
if (persistedAssisted.ok) {
  assert.equal(persistedAssisted.weight, null);
  assert.deepEqual(persistedAssisted.extra, {
    load_mode: 'assisted',
    assistance: 20,
    weight_unit: 'kg',
  });
}

const persistedAdded = prepareTrackedWrite({
  loadMode: 'added',
  weight: 10,
  assistance: null,
  weightUnit: 'lb',
  persistLoadMode: true,
});
assert.equal(persistedAdded.ok, true);
if (persistedAdded.ok) {
  assert.equal(persistedAdded.weight, 10);
  assert.equal(persistedAdded.extra.assistance, null);
  assert.equal(persistedAdded.extra.load_mode, 'added');
  assert.equal(persistedAdded.extra.weight_unit, 'lb');
}

assert.deepEqual(
  visibleProgramDays([
    { id: 1, archivedAt: null },
    { id: 2, archivedAt: '2026-01-01T00:00:00Z' },
    { id: 3, archivedAt: '' },
  ]).map((day) => day.id),
  [1, 3],
);
assert.equal(isActiveProgramDay(undefined), true);
assert.equal(isActiveProgramDay(null), true);
assert.equal(isActiveProgramDay(''), true);
assert.equal(isActiveProgramDay('2026-01-01T00:00:00Z'), false);

let review = createManualProgramReview();
review = applyManualEdit(review, { type: 'rename-program', name: 'Home' }).review;
review = applyManualEdit(review, { type: 'rename-day', dayIndex: 0, name: 'Pull' }).review;
review = applyManualEdit(review, { type: 'add-exercise', dayIndex: 0 }).review;
review = applyManualEdit(review, {
  type: 'choose-exercise',
  dayIndex: 0,
  exerciseIndex: 0,
  exerciseId: '4',
}).review;
review = applyManualEdit(review, {
  type: 'set-load-mode',
  dayIndex: 0,
  exerciseIndex: 0,
  loadMode: 'assisted',
}).review;
review.days[0].exercises[0].sets = { value: 3, acceptance: 'user_entered' };
review.days[0].exercises[0].repsMin = { value: 5, acceptance: 'user_entered' };
review.days[0].exercises[0].repsMax = { value: 8, acceptance: 'user_entered' };
assert.equal(review.days[0]?.exercises[0]?.loadMode, 'assisted');
assert.equal(validateManualRoutine(review).ok, true);
const previewText = JSON.stringify(toImportPreview(review));
assert.equal(previewText.includes('loadMode'), false);
assert.equal(previewText.includes('load_mode'), false);
assert.equal(previewText.includes('assistance'), false);

const builder = source('components/manual-program-builder.tsx');
const logger = source('app/workout/[sessionId].tsx');
const history = source('app/(tabs)/history/[sessionId].tsx');
const progression = source('lib/progression.ts');
const session = source('lib/workout-session.ts');
const programs = source('lib/programs.ts');
const previousStart = progression.indexOf('function formatPreviousSetLine');
const previousEnd = progression.indexOf('function isLowerBodyCompound');
const previousLine = progression.slice(previousStart, previousEnd);
assert.equal(previousStart > 0, true);
assert.equal(previousLine.includes('formatLegacyLoad'), false);
assert.equal(previousLine.includes('BW +'), false);
assert.equal(previousLine.includes('+${formatWeight(weight)} lb'), true);
assert.equal(previousLine.includes('`BW × ${set.reps}`'), true);
assert.equal(builder.includes('TRACKING_MODE_LABELS'), true);
assert.equal(builder.includes("type: 'set-load-mode'"), true);
assert.equal(logger.includes('TRACKING_MODE_LABELS'), true);
assert.equal(logger.includes('formatTrackedLoad'), true);
assert.equal(logger.includes('Number(values.weight) || 0'), false);
assert.equal(history.includes('historySetDisplayLine'), true);
assert.equal(source('lib/history-sets.ts').includes('formatHistorySetLine'), true);
assert.equal(history.includes('historySetTracking'), true);
assert.equal(history.includes('historyTrackingColumnMissing'), true);
assert.equal(history.includes('HISTORY_SET_SELECT_LEGACY'), true);
assert.equal(history.includes('historySetDisplayLine(set)'), true);
assert.equal(history.includes('loadMode: tracking.loadMode'), true);
assert.equal(history.includes('archived_at'), false);
assert.equal(source('lib/history-sets.ts').includes('load_mode'), true);
assert.equal(source('lib/history-sets.ts').includes('weight_unit'), true);
const historyIndex = source('app/(tabs)/history/index.tsx');
assert.equal(historyIndex.includes('archived_at'), false);
assert.equal(session.includes('prepareTrackedWrite'), true);
assert.equal(session.includes('PERSIST_LOAD_MODE'), true);
assert.equal(session.includes('load_mode'), false);
assert.equal(session.includes('archived_at'), true);
assert.equal(session.includes('isMissingColumnError'), true);
assert.equal(session.includes('ARCHIVED_DAY_MESSAGE'), true);
const sessionSelect = session.slice(
  session.indexOf('const SESSION_SELECT_WITH_OVERRIDES'),
  session.indexOf('async function fetchWorkoutSession'),
);
assert.equal(sessionSelect.includes('archived_at'), false);
const unfinished = session.slice(
  session.indexOf('export async function listUnfinishedSessions'),
  session.indexOf('function blockedStartResult'),
);
assert.equal(unfinished.includes('archived_at'), false);
assert.equal(programs.includes('archived_at'), true);
assert.equal(programs.includes('isMissingColumnError'), true);
assert.equal(programs.includes('ARCHIVED_DAY_MESSAGE'), true);
const programDay = source('app/(tabs)/program/[id].tsx');
assert.equal(programDay.includes('archived_at'), true);
assert.equal(programDay.includes('isMissingColumnError'), true);
assert.equal(programDay.includes('ARCHIVED_DAY_MESSAGE'), true);
const manualClient = source('lib/import/manual-program-client.ts');
assert.equal(manualClient.includes('archived_at'), true);
assert.equal(manualClient.includes('isMissingColumnError'), true);

const bannedCalls = [
  'update_owned_program',
  'save_manual_program',
  'record_tracked_set',
  'create_custom_exercise',
  'seed_standard_exercises',
];
const phonePaths = [
  'app/(tabs)/history/[sessionId].tsx',
  'app/(tabs)/program/build.tsx',
  'app/(tabs)/program/index.tsx',
  'app/workout/[sessionId].tsx',
  'components/manual-program-builder.tsx',
  'hooks/use-persisted-workout-sets.ts',
  'lib/workout-session.ts',
  'lib/programs.ts',
  'lib/import/manual-program.ts',
  'lib/import/manual-program-client.ts',
  'lib/load-mode.ts',
  'lib/progression.ts',
];
for (const path of phonePaths) {
  const text = source(path);
  for (const name of bannedCalls) {
    if (path === 'lib/import/manual-program-client.ts' && name === 'update_owned_program') {
      continue;
    }
    assert.equal(text.includes(name), false, `${path} mentions ${name}`);
  }
}
const editClient = source('lib/import/manual-program-client.ts');
assert.equal(editClient.includes('OWNED_PROGRAM_EDIT_ENABLED = RELEASE_CANDIDATE_FEATURES_ENABLED'), true);
assert.notEqual(process.env.EXPO_PUBLIC_SYNCSETREP_RC, '1');
assert.equal(
  editClient.includes('io?.rpc ?? (OWNED_PROGRAM_EDIT_ENABLED ? defaultEditRpc : undefined)'),
  true,
);
assert.equal(source('app/(tabs)/program/build.tsx').includes('update_owned_program'), false);
assert.equal(source('lib/import/custom-exercise.ts').includes("rpc('create_custom_exercise'"), true);
assert.equal(source('components/manual-program-builder.tsx').includes('create_custom_exercise'), false);

const sqlFiles = [
  'sql/load-mode.sql',
  'sql/load-mode-rollback.sql',
  'sql/program-day-archive.sql',
  'sql/program-day-archive-rollback.sql',
  'sql/exercise-ownership.sql',
  'sql/exercise-ownership-rollback.sql',
  'sql/routine-edit.sql',
  'sql/routine-edit-rollback.sql',
  'sql/routine-write-permission-precheck.sql',
  'sql/routine-write-step-precheck.sql',
  'sql/routine-write-baseline.sql',
  'sql/routine-write-enablement.sql',
  'sql/routine-write-enablement-rollback.sql',
];
for (const path of sqlFiles) {
  const text = source(path);
  assert.equal(text.startsWith('-- NOT APPLIED.'), true, path);
  assert.equal(/supabase\.co|postgres:\/\/|password\s*=/i.test(text), false, path);
}
for (const path of ['sql/load-mode.sql', 'sql/exercise-ownership.sql', 'sql/routine-edit.sql']) {
  assert.equal(/\bGRANT\s+EXECUTE\b/i.test(source(path)), false, path);
}
assert.match(source('sql/routine-write-permission-precheck.sql'), /routine_write_permissions_closed/);
assert.match(source('sql/routine-write-step-precheck.sql'), /routine_write_step_closed/);
assert.match(source('sql/routine-write-baseline.sql'), /routine_write_baseline_ready/);
assert.match(source('sql/routine-write-deployment.md'), /Failure-recovery matrix/);
assert.match(source('sql/routine-write-deployment.md'), /Do not execute the functions/);
assert.match(source('sql/routine-write-deployment.md'), /## Maintenance window/);
assert.match(source('sql/routine-write-deployment.md'), /## Backup verification/);
assert.match(source('sql/routine-write-deployment.md'), /## Unexpected counts and fingerprints/);
assert.match(source('sql/routine-write-deployment.md'), /pg_restore --list/);
assert.match(source('sql/routine-write-deployment.md'), /syncsetrep_restore_test/);
assert.match(source('sql/routine-write-deployment.md'), /127\.0\.0\.1/);
assert.equal(
  /pg_restore --clean` against it/.test(source('sql/routine-write-deployment.md')),
  true,
);
assert.equal(
  /SELECT\s+public\.record_tracked_set\s*\(/i.test(source('sql/routine-write-deployment.md')),
  false,
);
assert.match(source('sql/routine-write-enablement.sql'), /routine_write_permissions_enabled/);
assert.equal(
  /\bDROP\s+(FUNCTION|TABLE|COLUMN|POLICY)\b/i.test(source('sql/routine-write-enablement-rollback.sql')),
  false,
);
const routineSql = source('sql/routine-edit.sql');
assert.equal(/UPDATE\s+public\.workout_/i.test(routineSql), false);
assert.equal(/DELETE\s+FROM\s+public\.workout_/i.test(routineSql), false);
assert.equal(/INSERT\s+INTO\s+public\.workout_/i.test(routineSql), false);
const loadSql = source('sql/load-mode.sql');
assert.equal(loadSql.indexOf('history_locked') < loadSql.indexOf('UPDATE public.workout_sets'), true);
assert.equal(/UPDATE\s+public\.workout_sets\s+SET\s+weight/i.test(source('sql/load-mode-rollback.sql')), false);

console.log('load-mode checks passed');
