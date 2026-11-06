import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { IMPORT_DISABLED_MESSAGE, IMPORT_FAILED_MESSAGE } from '../lib/import/import-workout.ts';
import { TEXT_MAX_CHARS, TXT_MAX_BYTES } from '../lib/import/limits.ts';
import { classifyExtractedPdf } from '../lib/import/pdf-text-policy.ts';
import {
  TXT_FILE_EMPTY_MESSAGE,
  TXT_FILE_INVALID_UTF8_MESSAGE,
  TXT_FILE_TOO_LARGE_MESSAGE,
  TXT_FILE_TOO_LONG_MESSAGE,
  TXT_FILE_UNSUPPORTED_MESSAGE,
  importWorkoutTextFile,
  readWorkoutTextFile,
} from '../lib/import/text-file.ts';

const encoder = new TextEncoder();

function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/workout-import/${name}`, import.meta.url), 'utf8');
}

function refused(input: { name: string; mimeType?: string | null; bytes: Uint8Array }) {
  const result = readWorkoutTextFile(input);
  if (result.ok) {
    assert.fail(`${input.name} was accepted`);
  }
  return result;
}

async function send(input: { name: string; mimeType?: string | null; bytes: Uint8Array }) {
  const calls: { source: string }[] = [];
  const result = await importWorkoutTextFile(input, {
    enabled: true,
    invoke: async (body) => {
      calls.push(body);
      return { data: null, error: { message: 'stopped before the model' } };
    },
  });
  return { result, calls };
}

const week = 'Day 1\nCafé squat 3×8\nBench press 3 x 8';
const valid = await send({
  name: 'week.TXT',
  mimeType: 'text/plain; charset=utf-8',
  bytes: utf8(`\uFEFF${week}\n`),
});
assert.equal(valid.calls.length, 1);
assert.equal(valid.calls[0]?.source, week);
assert.equal(valid.result.ok, false);
if (valid.result.ok) {
  assert.fail('the local invoke stops before a review');
}
assert.deepEqual(valid.result.errors, [IMPORT_FAILED_MESSAGE]);
const payload = JSON.parse(JSON.stringify({ source: valid.calls[0]?.source })) as { source: string };
assert.equal(payload.source, week);
assert.equal(payload.source.includes('\uFEFF'), false);

const octet = await send({
  name: 'notes.txt',
  mimeType: 'application/octet-stream',
  bytes: utf8(week),
});
assert.equal(octet.calls[0]?.source, week);

const missingMime = await send({
  name: 'C:\\workouts\\notes.txt',
  bytes: utf8(week),
});
assert.equal(missingMime.calls[0]?.source, week);

const exact = await send({
  name: 'exact.txt',
  mimeType: 'text/plain',
  bytes: utf8('A'.repeat(TEXT_MAX_CHARS)),
});
assert.equal(exact.calls.length, 1);
assert.equal(exact.calls[0]?.source.length, TEXT_MAX_CHARS);

const blocked = await importWorkoutTextFile({
  name: 'week.txt',
  mimeType: 'text/plain',
  bytes: utf8(week),
});
assert.equal(blocked.ok, false);
if (blocked.ok) {
  assert.fail('import stays off unless the test injects invoke');
}
assert.deepEqual(blocked.errors, [IMPORT_DISABLED_MESSAGE]);

const emptyFile = await send({
  name: 'empty.txt',
  mimeType: 'text/plain',
  bytes: utf8(fixture('empty.txt')),
});
assert.equal(emptyFile.calls.length, 0);
assert.equal(emptyFile.result.ok, false);
if (emptyFile.result.ok) {
  assert.fail('empty txt was accepted');
}
assert.deepEqual(emptyFile.result.errors, [TXT_FILE_EMPTY_MESSAGE]);
assert.equal(refused({ name: 'blank.txt', mimeType: 'text/plain', bytes: utf8(' \r\n\t') }).code, 'empty');
assert.equal(refused({ name: 'bom.txt', mimeType: 'text/plain', bytes: Uint8Array.of(0xef, 0xbb, 0xbf) }).code, 'empty');

const oversized = await send({
  name: 'huge.txt',
  mimeType: 'text/plain',
  bytes: new Uint8Array(TXT_MAX_BYTES + 1),
});
assert.equal(oversized.calls.length, 0);
assert.equal(oversized.result.ok, false);
if (oversized.result.ok) {
  assert.fail('oversized txt was accepted');
}
assert.deepEqual(oversized.result.errors, [TXT_FILE_TOO_LARGE_MESSAGE]);
assert.equal(readWorkoutTextFile({
  name: 'huge.txt',
  mimeType: 'text/plain',
  bytes: new Uint8Array(TXT_MAX_BYTES + 1),
}).ok, false);

const tooLong = await send({
  name: 'long.txt',
  mimeType: 'text/plain',
  bytes: utf8('A'.repeat(TEXT_MAX_CHARS + 1)),
});
assert.equal(tooLong.calls.length, 0);
assert.equal(tooLong.result.ok, false);
if (tooLong.result.ok) {
  assert.fail('a file over 20,000 characters was accepted');
}
assert.deepEqual(tooLong.result.errors, [TXT_FILE_TOO_LONG_MESSAGE]);
assert.equal(utf8('A'.repeat(TEXT_MAX_CHARS + 1)).byteLength < TXT_MAX_BYTES, true);

const unsupported = [
  { name: 'week.pdf', mimeType: 'application/pdf' },
  { name: 'week.json', mimeType: 'application/json' },
  {
    name: 'week.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  { name: 'week.md', mimeType: 'text/markdown' },
  { name: 'week', mimeType: 'text/plain' },
  { name: 'week.txt', mimeType: 'application/pdf' },
  { name: 'week.txt.exe', mimeType: 'application/octet-stream' },
];
for (const file of unsupported) {
  const result = await send({ ...file, bytes: utf8(week) });
  assert.equal(result.calls.length, 0, file.name);
  assert.equal(result.result.ok, false, file.name);
  if (result.result.ok) {
    assert.fail(`${file.name} was accepted`);
  }
  assert.deepEqual(result.result.errors, [TXT_FILE_UNSUPPORTED_MESSAGE]);
}

const invalid = await send({
  name: 'utf16.txt',
  mimeType: 'text/plain',
  bytes: Uint8Array.of(0xff, 0xfe, 0x42, 0x00),
});
assert.equal(invalid.calls.length, 0);
assert.equal(invalid.result.ok, false);
if (invalid.result.ok) {
  assert.fail('invalid UTF-8 was accepted');
}
assert.deepEqual(invalid.result.errors, [TXT_FILE_INVALID_UTF8_MESSAGE]);
assert.equal(
  refused({ name: 'bad.txt', mimeType: 'text/plain; charset=utf-16', bytes: utf8(week) }).code,
  'invalid_utf8',
);
assert.equal(
  refused({ name: 'nul.txt', mimeType: 'text/plain', bytes: Uint8Array.of(0x41, 0x00, 0x42) }).code,
  'invalid_utf8',
);

const program = fixture('program.txt');
const pdfPolicy = classifyExtractedPdf({ text: program, pageCount: 1 });
assert.equal(pdfPolicy.ok, true);
const pdfUpload = await send({
  name: 'program.pdf',
  mimeType: 'application/pdf',
  bytes: utf8(program),
});
assert.equal(pdfUpload.calls.length, 0);
const txtUpload = await send({
  name: 'program.txt',
  mimeType: 'text/plain',
  bytes: utf8(program),
});
assert.equal(txtUpload.calls[0]?.source, program.trim());

const picker = readFileSync(new URL('../lib/import/pick-text-file.ts', import.meta.url), 'utf8');
assert.equal(picker.includes("type: '*/*'"), true);
assert.equal(picker.includes('copyToCacheDirectory: true'), true);
assert.equal(picker.includes('multiple: false'), true);
assert.equal(picker.includes("type: 'text/plain'"), false);
assert.equal(picker.includes('supabase'), false);

const textFile = readFileSync(new URL('../lib/import/text-file.ts', import.meta.url), 'utf8');
assert.equal(textFile.includes('pdf-text-policy'), false);
assert.equal(textFile.includes('supabase'), false);

const screen = readFileSync(new URL('../app/(tabs)/program/import.tsx', import.meta.url), 'utf8');
assert.equal(screen.includes('importWorkoutDraft(source, { catalog: prepared.catalog })'), true);
assert.equal(screen.includes('importWorkoutDraft(picked.result.text, { catalog: prepared.catalog })'), false);
assert.equal(screen.includes('setSource(picked.result.text)'), true);
assert.equal(screen.includes('picked.result.message'), true);
assert.equal(screen.includes('Choose a .txt file'), true);
assert.equal(screen.includes('pdf-text-policy'), false);
assert.equal(screen.includes('OPENAI_API_KEY'), false);
assert.equal(screen.includes('api.openai.com'), false);

console.log('workout import txt checks passed');
