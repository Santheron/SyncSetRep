import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { IMPORT_ENABLED, PERSIST_REST_SECONDS, SUBTITLE_REQUIRED } from '../lib/import/flags.ts';
import {
  saveImportedProgram,
  saveImportedProgramForCurrentUser,
  IMPORT_SAVE_FAILED_MESSAGE,
  type ImportSaveRpc,
} from '../lib/import/save-imported-program.ts';
import {
  IMPORT_INVALID_EXERCISE_ID_MESSAGE,
  toSavePayload,
  type SaveImportedProgramPayload,
} from '../lib/import/save-payload.ts';
import {
  IMPORT_DUPLICATE_EXERCISE_MESSAGE,
  IMPORT_NO_ACTIVE_PROGRAM_MESSAGE,
  IMPORT_SIGN_IN_MESSAGE,
  IMPORT_UNRESOLVED_EXERCISE_MESSAGE,
  type ImportPreview,
  type ImportPreviewExercise,
} from '../lib/import/save-plan.ts';

const USER_ID = '11111111-1111-1111-1111-111111111111';

const originalFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error('fetch must not be called');
}) as typeof fetch;

function exercise(overrides: Partial<ImportPreviewExercise> = {}): ImportPreviewExercise {
  return {
    exerciseId: '2',
    matchStatus: 'matched',
    sets: { acceptance: 'extracted', value: 3, suggestion: null },
    repsMin: { acceptance: 'extracted', value: 8, suggestion: null },
    repsMax: { acceptance: 'extracted', value: 12, suggestion: null },
    restSeconds: { acceptance: 'extracted', value: 90, suggestion: 45 },
    notes: null,
    ...overrides,
  };
}

function preview(): ImportPreview {
  return {
    programName: ' Upper Lower ',
    days: [
      {
        name: ' Push ',
        subtitle: '   ',
        exercises: [],
      },
      {
        name: 'Push',
        subtitle: ' Monday ',
        exercises: [
          exercise({ exerciseId: '8', notes: '  Pause  ' }),
          exercise({
            exerciseId: 3,
            matchStatus: 'manual',
            sets: { acceptance: 'user_entered', value: 4, suggestion: null },
            repsMin: { acceptance: 'accepted_suggestion', value: 5, suggestion: 5 },
            repsMax: { acceptance: 'user_entered', value: 5, suggestion: null },
            notes: '   ',
          }),
        ],
      },
    ],
  };
}

function payloadOf(result: ReturnType<typeof toSavePayload>): SaveImportedProgramPayload {
  if (!result.ok) {
    assert.fail(result.errors.join('\n'));
  }
  assert.equal('errors' in result, false);
  return result.payload;
}

function errorsOf(result: ReturnType<typeof toSavePayload>): string[] {
  if (result.ok) {
    assert.fail('expected the payload to be refused');
  }
  assert.equal('payload' in result, false);
  return result.errors;
}

function assertExactKeys(value: object, keys: readonly string[]) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

const FORBIDDEN_PAYLOAD_KEYS = [
  'user_id',
  'slug',
  'is_active',
  'day_order',
  'program_id',
  'exercise_order',
  'rest_seconds',
  'suggestion',
  'matchStatus',
  'acceptance',
  'sourceName',
  'weight',
  'origin',
];

try {
  assert.equal(IMPORT_ENABLED, false);
  assert.equal(PERSIST_REST_SECONDS, false);
  assert.equal(SUBTITLE_REQUIRED, false);

  const payload = payloadOf(toSavePayload(preview(), USER_ID, { hasActiveProgram: true }));
  assert.equal(payload.name, 'Upper Lower');
  assertExactKeys(payload, ['name', 'days']);
  assert.equal(payload.days.length, 2);
  assert.deepEqual(
    payload.days.map((day) => day.name),
    ['Push', 'Push'],
  );
  assert.equal(payload.days[0]?.subtitle, null);
  assert.deepEqual(payload.days[0]?.exercises, []);
  assertExactKeys(payload.days[0] ?? {}, ['name', 'subtitle', 'exercises']);
  assert.equal(payload.days[1]?.subtitle, 'Monday');
  assert.deepEqual(
    payload.days[1]?.exercises.map((row) => row.exercise_id),
    [8, 3],
  );
  const first = payload.days[1]?.exercises[0];
  const second = payload.days[1]?.exercises[1];
  if (!first || !second) {
    throw new Error('expected two exercises');
  }
  assertExactKeys(first, ['exercise_id', 'target_sets', 'min_reps', 'max_reps', 'notes']);
  assert.equal(first.notes, 'Pause');
  assert.equal(first.target_sets, 3);
  assert.equal(first.min_reps, 8);
  assert.equal(first.max_reps, 12);
  assert.equal(second.notes, null);
  assert.equal(second.target_sets, 4);
  assert.equal(second.min_reps, 5);
  assert.equal(second.max_reps, 5);
  assert.equal(typeof first.exercise_id, 'number');

  const encoded = JSON.stringify(payload);
  for (const key of FORBIDDEN_PAYLOAD_KEYS) {
    assert.equal(encoded.includes(`"${key}"`), false, key);
  }

  const withRest = payloadOf(
    toSavePayload(preview(), USER_ID, { hasActiveProgram: true, persistRestSeconds: true }),
  );
  assert.equal(JSON.stringify(withRest).includes('"rest_seconds"'), false);
  assert.deepEqual(withRest, payload);

  const invalidIds: Array<{ id: ImportPreviewExercise['exerciseId']; message: string }> = [
    { id: 0, message: IMPORT_INVALID_EXERCISE_ID_MESSAGE },
    { id: '0', message: IMPORT_INVALID_EXERCISE_ID_MESSAGE },
    { id: '01', message: IMPORT_INVALID_EXERCISE_ID_MESSAGE },
    { id: '-3', message: IMPORT_INVALID_EXERCISE_ID_MESSAGE },
    { id: '1.5', message: IMPORT_INVALID_EXERCISE_ID_MESSAGE },
    { id: ' 4 ', message: IMPORT_INVALID_EXERCISE_ID_MESSAGE },
    { id: '9223372036854775808', message: IMPORT_INVALID_EXERCISE_ID_MESSAGE },
    { id: '1000000000000000', message: IMPORT_INVALID_EXERCISE_ID_MESSAGE },
    { id: '', message: IMPORT_UNRESOLVED_EXERCISE_MESSAGE },
    { id: null, message: IMPORT_UNRESOLVED_EXERCISE_MESSAGE },
    { id: 1.5, message: IMPORT_UNRESOLVED_EXERCISE_MESSAGE },
  ];
  for (const { id, message } of invalidIds) {
    const invalid = preview();
    const row = invalid.days[1]?.exercises[0];
    if (!row) {
      throw new Error('preview exercise missing');
    }
    row.exerciseId = id;
    assert.deepEqual(errorsOf(toSavePayload(invalid, USER_ID, { hasActiveProgram: true })), [message], String(id));
  }

  const duplicate = preview();
  const duplicateRow = duplicate.days[1]?.exercises[1];
  if (!duplicateRow) {
    throw new Error('preview exercise missing');
  }
  duplicateRow.exerciseId = '8';
  assert.deepEqual(errorsOf(toSavePayload(duplicate, USER_ID, { hasActiveProgram: true })), [
    IMPORT_DUPLICATE_EXERCISE_MESSAGE,
  ]);

  const calls: SaveImportedProgramPayload[] = [];
  const rpc: ImportSaveRpc = async (name, args) => {
    assert.equal(name, 'save_imported_program');
    calls.push(args.p_program);
    return { data: 42, error: null };
  };
  const saved = await saveImportedProgram(preview(), {
    userId: USER_ID,
    hasActiveProgram: true,
    rpc,
  });
  assert.deepEqual(saved, { ok: true, programId: '42' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], payload);

  calls.length = 0;
  const refused = await saveImportedProgram(duplicate, {
    userId: USER_ID,
    hasActiveProgram: true,
    rpc,
  });
  assert.deepEqual(refused, { ok: false, errors: [IMPORT_DUPLICATE_EXERCISE_MESSAGE] });
  assert.equal(calls.length, 0);

  const unauthenticated = await saveImportedProgram(preview(), {
    userId: USER_ID,
    hasActiveProgram: true,
    rpc: async () => ({ data: null, error: { message: 'Not authenticated' } }),
  });
  assert.deepEqual(unauthenticated, { ok: false, errors: [IMPORT_SIGN_IN_MESSAGE] });

  const inactive = await saveImportedProgram(preview(), {
    userId: USER_ID,
    hasActiveProgram: true,
    rpc: async () => ({ data: null, error: { message: 'active_program_required' } }),
  });
  assert.deepEqual(inactive, { ok: false, errors: [IMPORT_NO_ACTIVE_PROGRAM_MESSAGE] });

  const unknown = await saveImportedProgram(preview(), {
    userId: USER_ID,
    hasActiveProgram: true,
    rpc: async () => ({
      data: null,
      error: { message: 'ERROR: invalid_import: unknown_exercise' },
    }),
  });
  assert.deepEqual(unknown, { ok: false, errors: [IMPORT_UNRESOLVED_EXERCISE_MESSAGE] });

  const missingId = await saveImportedProgram(preview(), {
    userId: USER_ID,
    hasActiveProgram: true,
    rpc: async () => ({ data: null, error: null }),
  });
  assert.deepEqual(missingId, { ok: false, errors: [IMPORT_SAVE_FAILED_MESSAGE] });

  const thrown = await saveImportedProgram(preview(), {
    userId: USER_ID,
    hasActiveProgram: true,
    rpc: async () => {
      throw new Error('network down');
    },
  });
  assert.deepEqual(thrown, { ok: false, errors: [IMPORT_SAVE_FAILED_MESSAGE] });

  let currentUserCalls = 0;
  const signedOut = await saveImportedProgramForCurrentUser(preview(), {
    hasActiveProgram: true,
    getUserId: async () => ({ ok: false, error: 'signed out' }),
    rpc: async () => {
      currentUserCalls += 1;
      return { data: 1, error: null };
    },
  });
  assert.deepEqual(signedOut, { ok: false, errors: [IMPORT_SIGN_IN_MESSAGE] });
  assert.equal(currentUserCalls, 0);

  const signedIn = await saveImportedProgramForCurrentUser(preview(), {
    hasActiveProgram: true,
    getUserId: async () => ({ ok: true, data: USER_ID }),
    rpc: async () => ({ data: '15', error: null }),
  });
  assert.deepEqual(signedIn, { ok: true, programId: '15' });

  const wrapperSource = readFileSync(
    new URL('../lib/import/save-imported-program.ts', import.meta.url),
    'utf8',
  );
  for (const line of wrapperSource.split('\n')) {
    if (line.startsWith('import ')) {
      assert.equal(line.includes('supabase'), false, line);
    }
  }
  assert.equal(wrapperSource.includes("import('../supabase.ts')"), true);
  assert.equal(wrapperSource.includes('ensureOwnProgram'), false);
  assert.equal(wrapperSource.includes('workout_sessions'), false);
  assert.equal(wrapperSource.includes('workout_sets'), false);

  const roots = ['app', 'components', 'hooks'].map((name) =>
    fileURLToPath(new URL(`../${name}/`, import.meta.url)),
  );
  for (const root of roots) {
    const pending = [root];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) {
        break;
      }
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
          pending.push(fullPath);
          continue;
        }
        if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) {
          continue;
        }
        const text = readFileSync(fullPath, 'utf8');
        assert.equal(text.includes('save-imported-program'), false, fullPath);
        assert.equal(text.includes('toSavePayload'), false, fullPath);
        assert.equal(text.includes('saveImportedProgram'), false, fullPath);
      }
    }
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('workout import save payload checks passed');
