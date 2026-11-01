import { PDF_MAX_BYTES, PDF_MAX_PAGES, PDF_MIN_ALNUM, TEXT_MAX_CHARS } from './limits.ts';

export type PdfPolicyCode = 'too_many_pages' | 'scanned_pdf' | 'too_long';

export type PdfPolicyResult =
  | { ok: true }
  | { ok: false; code: PdfPolicyCode; message: string };

const PDF_POLICY_MESSAGES: Record<PdfPolicyCode, string> = {
  too_many_pages: 'This PDF has more than 8 pages. Paste a single week instead.',
  scanned_pdf:
    'This PDF has no selectable text. Phase 1 cannot read scans or photos. Paste the routine as text.',
  too_long: 'This file is too long to import at once. Paste one week, up to 20,000 characters.',
};

function reject(code: PdfPolicyCode): PdfPolicyResult {
  return { ok: false, code, message: PDF_POLICY_MESSAGES[code] };
}

export function classifyExtractedPdf(input: {
  text: string;
  pageCount: number;
  byteLength?: number;
}): PdfPolicyResult {
  if (typeof input.byteLength === 'number' && input.byteLength > PDF_MAX_BYTES) {
    return reject('too_long');
  }

  // Pages, then the text layer, then character length.
  if (input.pageCount > PDF_MAX_PAGES) {
    return reject('too_many_pages');
  }

  const alphanumeric = input.text.match(/[a-zA-Z0-9]/g);
  if ((alphanumeric?.length ?? 0) < PDF_MIN_ALNUM) {
    return reject('scanned_pdf');
  }

  if (input.text.length > TEXT_MAX_CHARS) {
    return reject('too_long');
  }

  return { ok: true };
}
