import { importWorkoutDraft, type ImportWorkoutResult } from './import-workout.ts';
import { TEXT_MAX_CHARS, TXT_MAX_BYTES } from './limits.ts';

export const TXT_FILE_UNSUPPORTED_MESSAGE =
  'Choose a .txt file. Other formats, including PDF, are not read as plain text. Nothing was saved.';

export const TXT_FILE_TOO_LARGE_MESSAGE =
  'This text file is too large. Choose one week, up to 20,000 characters. Nothing was saved.';

export const TXT_FILE_TOO_LONG_MESSAGE =
  'This text file is longer than 20,000 characters. Paste or choose one week. Nothing was saved.';

export const TXT_FILE_EMPTY_MESSAGE = 'This text file is empty. Nothing was saved.';

export const TXT_FILE_INVALID_UTF8_MESSAGE =
  'This text file is not valid UTF-8. Save it as UTF-8 and try again. Nothing was saved.';

export const TXT_FILE_UNREADABLE_MESSAGE = 'This text file could not be read. Nothing was saved.';

export type TextFileCode =
  | 'unsupported_format'
  | 'too_large'
  | 'too_long'
  | 'empty'
  | 'invalid_utf8'
  | 'unreadable';

export type TextFileFailure = { ok: false; code: TextFileCode; message: string };

export type TextFileReadResult = { ok: true; text: string } | TextFileFailure;

const MESSAGES: Record<TextFileCode, string> = {
  unsupported_format: TXT_FILE_UNSUPPORTED_MESSAGE,
  too_large: TXT_FILE_TOO_LARGE_MESSAGE,
  too_long: TXT_FILE_TOO_LONG_MESSAGE,
  empty: TXT_FILE_EMPTY_MESSAGE,
  invalid_utf8: TXT_FILE_INVALID_UTF8_MESSAGE,
  unreadable: TXT_FILE_UNREADABLE_MESSAGE,
};

function fail(code: TextFileCode): TextFileFailure {
  return { ok: false, code, message: MESSAGES[code] };
}

function extensionOf(name: string): string {
  const base = name.trim().split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) {
    return '';
  }
  return base.slice(dot + 1).toLowerCase();
}

function mimeKind(mimeType: string | null | undefined): 'ok' | 'not_utf8' | 'other' {
  if (mimeType == null) {
    return 'ok';
  }
  if (typeof mimeType !== 'string') {
    return 'other';
  }
  const mime = mimeType.trim().toLowerCase();
  if (mime === '' || mime === 'application/octet-stream') {
    return 'ok';
  }
  const [type, ...params] = mime.split(';').map((part) => part.trim()).filter(Boolean);
  if (type !== 'text/plain') {
    return 'other';
  }
  for (const param of params) {
    const separator = param.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = param.slice(0, separator).trim();
    const value = param.slice(separator + 1).trim().replace(/^"|"$/g, '');
    if (key === 'charset' && value !== 'utf-8' && value !== 'us-ascii') {
      return 'not_utf8';
    }
  }
  return 'ok';
}

export function inspectTextFile(input: {
  name: string;
  mimeType?: string | null;
}): { ok: true } | TextFileFailure {
  if (typeof input.name !== 'string' || extensionOf(input.name) !== 'txt') {
    return fail('unsupported_format');
  }
  const mime = mimeKind(input.mimeType);
  if (mime === 'other') {
    return fail('unsupported_format');
  }
  if (mime === 'not_utf8') {
    return fail('invalid_utf8');
  }
  return { ok: true };
}

export function readWorkoutTextFile(input: {
  name: string;
  mimeType?: string | null;
  bytes: Uint8Array;
}): TextFileReadResult {
  const format = inspectTextFile(input);
  if (!format.ok) {
    return format;
  }
  if (!(input.bytes instanceof Uint8Array)) {
    return fail('unreadable');
  }
  if (input.bytes.byteLength > TXT_MAX_BYTES) {
    return fail('too_large');
  }
  let text = '';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(input.bytes);
  } catch {
    return fail('invalid_utf8');
  }
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  if (text.includes('\0')) {
    return fail('invalid_utf8');
  }
  text = text.trim();
  if (text.length === 0) {
    return fail('empty');
  }
  if (text.length > TEXT_MAX_CHARS) {
    return fail('too_long');
  }
  return { ok: true, text };
}

export async function importWorkoutTextFile(
  input: {
    name: string;
    mimeType?: string | null;
    bytes: Uint8Array;
  },
  options?: Parameters<typeof importWorkoutDraft>[1],
): Promise<ImportWorkoutResult> {
  const decoded = readWorkoutTextFile(input);
  if (!decoded.ok) {
    return { ok: false, errors: [decoded.message] };
  }
  return importWorkoutDraft(decoded.text, options);
}
