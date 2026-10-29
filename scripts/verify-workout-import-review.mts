import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IMPORT_ENABLED } from '../lib/import/flags.ts';
import {
  acceptSuggestion,
  addDay,
  addManualExercise,
  chooseExercise,
  createManualProgramReview,
  moveExercise,
  renameDay,
  renameProgram,
  setExerciseNotes,
  setUserNumber,
  toImportPreview,
} from '../lib/import/review-editor.ts';
import { programReviewFromImport } from '../lib/import/review-from-import.ts';
import { toSavePayload } from '../lib/import/save-payload.ts';
import type { ImportDraft } from '../lib/import/validate-draft.ts';

const USER_ID = '11111111-1111-1111-1111-111111111111';

const originalFetch = globalThis.fetch;
globalThis.fetch = (() => {
  throw new Error('fetch must not be called');
}) as typeof fetch;

function draft(): ImportDraft {
  return {
    programName: { origin: 'extracted', value: ' Manual Free ' },
    warnings: [],
    issues: [],
    days: [
      {
        name: { origin: 'extracted', value: 'Push' },
        subtitle: { origin: 'missing', value: null },
        exercises: [],
      },
      {
        name: { origin: 'extracted', value: 'Push' },
        subtitle: { origin: 'extracted', value: '  ' },
        exercises: [
          {
            sourceName: 'Bench Press',
            sets: { origin: 'extracted', value: 3, suggestion: null },
            repsMin: { origin: 'missing', value: null, suggestion: 8 },
            repsMax: { origin: 'missing', value: null, suggestion: 12 },
            restSeconds: { origin: 'extracted', value: 90, suggestion: null },
            weight: { origin: 'missing', value: null, suggestion: null },
            notes: { origin: 'extracted', value: '  Pause  ' },
          },
        ],
      },
    ],
  };
}

try {
  assert.equal(IMPORT_ENABLED, false);

  let manual = createManualProgramReview();
  assert.equal(manual.origin, 'manual');
  assert.equal(manual.days.length, 1);
  assert.deepEqual(manual.days[0]?.exercises, []);
  manual = renameProgram(manual, ' Home Program ');
  manual = renameDay(manual, 0, 'Push');
  manual = addManualExercise(manual, 0);
  manual = chooseExercise(manual, 0, 0, '6');
  manual = setUserNumber(manual, 0, 0, 'sets', 3);
  manual = setUserNumber(manual, 0, 0, 'repsMin', 5);
  manual = setUserNumber(manual, 0, 0, 'repsMax', 5);
  manual = setUserNumber(manual, 0, 0, 'sets', 0);
  assert.equal(manual.days[0]?.exercises[0]?.sets.value, 3);
  manual = setExerciseNotes(manual, 0, 0, '  Tempo  ');
  manual = addManualExercise(manual, 0);
  manual = chooseExercise(manual, 0, 1, 9);
  manual = setUserNumber(manual, 0, 1, 'sets', 4);
  manual = setUserNumber(manual, 0, 1, 'repsMin', 8);
  manual = setUserNumber(manual, 0, 1, 'repsMax', 10);
  manual = moveExercise(manual, 0, 1, 0);
  manual = addDay(manual);
  manual = renameDay(manual, 1, 'Push');

  const manualPayload = toSavePayload(toImportPreview(manual), USER_ID, { hasActiveProgram: true });
  if (!manualPayload.ok) {
    assert.fail(manualPayload.errors.join('\n'));
  }
  assert.equal(manualPayload.payload.name, 'Home Program');
  assert.deepEqual(
    manualPayload.payload.days.map((day) => day.name),
    ['Push', 'Push'],
  );
  assert.deepEqual(manualPayload.payload.days[1]?.exercises, []);
  assert.deepEqual(
    manualPayload.payload.days[0]?.exercises.map((row) => row.exercise_id),
    [9, 6],
  );
  assert.equal(manualPayload.payload.days[0]?.exercises[1]?.notes, 'Tempo');
  assert.equal(JSON.stringify(manualPayload.payload).includes('"rest_seconds"'), false);
  assert.equal(manual.days[0]?.exercises[0]?.source, 'manual');
  assert.equal(manual.days[0]?.exercises[0]?.sourceName, null);

  const imported = programReviewFromImport(draft(), [
    [],
    [{ status: 'ambiguous', selectedId: null }],
  ]);
  assert.equal(imported.origin, 'import');
  assert.equal(imported.days[1]?.exercises[0]?.matchStatus, 'ambiguous');
  assert.equal(imported.days[1]?.exercises[0]?.exerciseId, null);
  assert.equal(imported.days[1]?.exercises[0]?.sourceName, 'Bench Press');
  let resolved = acceptSuggestion(imported, 1, 0, 'repsMin');
  resolved = acceptSuggestion(resolved, 1, 0, 'repsMax');
  resolved = chooseExercise(resolved, 1, 0, '4');
  assert.equal(resolved.days[1]?.exercises[0]?.matchStatus, 'manual');
  assert.equal(resolved.days[1]?.exercises[0]?.repsMin.acceptance, 'accepted_suggestion');
  const importedPayload = toSavePayload(toImportPreview(resolved), USER_ID, {
    hasActiveProgram: true,
    persistRestSeconds: true,
  });
  if (!importedPayload.ok) {
    assert.fail(importedPayload.errors.join('\n'));
  }
  assert.equal(importedPayload.payload.name, 'Manual Free');
  assert.deepEqual(importedPayload.payload.days[0]?.exercises, []);
  assert.equal(importedPayload.payload.days[0]?.name, 'Push');
  assert.equal(importedPayload.payload.days[1]?.name, 'Push');
  assert.equal(importedPayload.payload.days[1]?.exercises[0]?.exercise_id, 4);
  assert.equal(importedPayload.payload.days[1]?.exercises[0]?.notes, 'Pause');
  assert.equal(importedPayload.payload.days[1]?.exercises[0]?.min_reps, 8);
  assert.equal(importedPayload.payload.days[1]?.exercises[0]?.max_reps, 12);
  assert.equal(JSON.stringify(importedPayload.payload).includes('"rest_seconds"'), false);
  assert.equal(JSON.stringify(importedPayload.payload).includes('"suggestion"'), false);

  let capped = createManualProgramReview();
  for (let index = 0; index < 8; index += 1) {
    capped = addDay(capped);
  }
  assert.equal(capped.days.length, 7);

  const editorSource = readFileSync(new URL('../lib/import/review-editor.ts', import.meta.url), 'utf8');
  for (const token of ['grok', 'api.x.ai', 'supabase', 'XAI_API_KEY', 'validate-draft', 'pdf-text', 'ensureOwnProgram']) {
    assert.equal(editorSource.includes(token), false, token);
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log('workout import review checks passed');
