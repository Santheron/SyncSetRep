import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { classifyExtractedPdf } from '../lib/import/pdf-text-policy.ts';

function read(name: string): string {
  return readFileSync(new URL(`./fixtures/workout-import/${name}`, import.meta.url), 'utf8');
}

function refused(text: string, pageCount: number, byteLength?: number) {
  const result = classifyExtractedPdf({ text, pageCount, byteLength });
  if (result.ok) {
    assert.fail(`expected ${text.length} characters on ${pageCount} pages to be refused`);
  }
  return result;
}

const empty = refused('', 1);
assert.equal(empty.code, 'scanned_pdf');
assert.equal(
  empty.message,
  'This PDF has no selectable text. Phase 1 cannot read scans or photos. Paste the routine as text.',
);

const emptyFile = refused(read('empty.txt'), 1);
assert.equal(emptyFile.code, 'scanned_pdf');

const thirtyNine = read('thirty-nine.txt');
assert.equal((thirtyNine.match(/[a-zA-Z0-9]/g) ?? []).length, 39);
assert.equal(refused(thirtyNine, 1).code, 'scanned_pdf');
assert.equal(refused(thirtyNine, 9).code, 'too_many_pages');

const program = read('program.txt');
const accepted = classifyExtractedPdf({ text: program, pageCount: 1 });
assert.equal(accepted.ok, true);
assert.equal(classifyExtractedPdf({ text: program, pageCount: 8 }).ok, true);

const pages = refused(program, 9);
assert.equal(pages.code, 'too_many_pages');
assert.equal(pages.message, 'This PDF has more than 8 pages. Paste a single week instead.');

const exactLimit = classifyExtractedPdf({ text: 'A'.repeat(20_000), pageCount: 1 });
assert.equal(exactLimit.ok, true);
const tooLong = refused('A'.repeat(20_001), 1);
assert.equal(tooLong.code, 'too_long');
assert.equal(
  tooLong.message,
  'This file is too long to import at once. Paste one week, up to 20,000 characters.',
);
assert.equal(refused('A'.repeat(20_001), 9).code, 'too_many_pages');

assert.equal(classifyExtractedPdf({ text: program, pageCount: 1, byteLength: 2_097_152 }).ok, true);
assert.equal(refused(program, 1, 2_097_153).code, 'too_long');

console.log('workout import pdf policy checks passed');
