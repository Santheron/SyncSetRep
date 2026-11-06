import { getDocumentAsync, type DocumentPickerAsset } from 'expo-document-picker';
import { File } from 'expo-file-system';

import { TXT_MAX_BYTES } from './limits.ts';
import {
  TXT_FILE_TOO_LARGE_MESSAGE,
  TXT_FILE_UNREADABLE_MESSAGE,
  inspectTextFile,
  readWorkoutTextFile,
  type TextFileReadResult,
} from './text-file.ts';

export type PickedWorkoutText =
  | { canceled: true }
  | { canceled: false; result: TextFileReadResult };

class TextFileTooLargeError extends Error {}

function unreadable(): TextFileReadResult {
  return { ok: false, code: 'unreadable', message: TXT_FILE_UNREADABLE_MESSAGE };
}

function tooLarge(): TextFileReadResult {
  return { ok: false, code: 'too_large', message: TXT_FILE_TOO_LARGE_MESSAGE };
}

function releasePickerCache(uri: string): void {
  if (uri.startsWith('blob:')) {
    if (typeof URL !== 'undefined') {
      URL.revokeObjectURL(uri);
    }
    return;
  }
  // Only the picker copy lives under this directory. The original document does not.
  if (!uri.includes('/DocumentPicker/')) {
    return;
  }
  try {
    const copy = new File(uri);
    if (copy.exists) {
      copy.delete();
    }
  } catch {
    return;
  }
}

async function readPickedBytes(asset: DocumentPickerAsset): Promise<Uint8Array> {
  if (asset.file != null) {
    if (asset.file.size > TXT_MAX_BYTES) {
      throw new TextFileTooLargeError();
    }
    const bytes = new Uint8Array(await asset.file.arrayBuffer());
    if (bytes.byteLength > TXT_MAX_BYTES) {
      throw new TextFileTooLargeError();
    }
    return bytes;
  }
  const file = new File(asset.uri);
  if (!file.exists || file.size > TXT_MAX_BYTES) {
    if (file.exists && file.size > TXT_MAX_BYTES) {
      throw new TextFileTooLargeError();
    }
    throw new Error('unreadable');
  }
  const bytes = await file.bytes();
  if (bytes.byteLength > TXT_MAX_BYTES) {
    throw new TextFileTooLargeError();
  }
  return bytes;
}

export async function pickAndReadWorkoutTextFile(): Promise<PickedWorkoutText> {
  let uri: string | null = null;
  try {
    // A single '*/*' type becomes an open-document intent with no MIME list.
    // A text/plain-only filter hides .txt files labeled application/octet-stream.
    const picked = await getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: false,
      base64: false,
    });
    if (picked.canceled || picked.assets == null) {
      return { canceled: true };
    }
    const asset = picked.assets.length === 1 ? picked.assets[0] : undefined;
    if (asset == null || typeof asset.uri !== 'string') {
      return { canceled: false, result: unreadable() };
    }
    uri = asset.uri;
    const format = inspectTextFile({ name: asset.name, mimeType: asset.mimeType });
    if (!format.ok) {
      return { canceled: false, result: format };
    }
    if (typeof asset.size === 'number' && asset.size > TXT_MAX_BYTES) {
      return { canceled: false, result: tooLarge() };
    }
    const bytes = await readPickedBytes(asset);
    return {
      canceled: false,
      result: readWorkoutTextFile({
        name: asset.name,
        mimeType: asset.mimeType,
        bytes,
      }),
    };
  } catch (error) {
    if (error instanceof TextFileTooLargeError) {
      return { canceled: false, result: tooLarge() };
    }
    return { canceled: false, result: unreadable() };
  } finally {
    if (uri != null) {
      releasePickerCache(uri);
    }
  }
}
