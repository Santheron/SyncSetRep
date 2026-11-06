import { Directory, File, Paths } from 'expo-file-system';

import {
  ROUTINE_DRAFT_MAX_CHARS,
  routineDraftFileName,
  type RoutineDraftStore,
} from './routine-draft.ts';

// Durable on-device copies. This module does not call Supabase or a save RPC.
// Paths.document is the installed expo-file-system v19 directory that the OS keeps.

const DIRECTORY_NAME = 'routine-drafts';

export function documentRoutineDraftStore(): RoutineDraftStore {
  return {
    read(key) {
      try {
        const file = existingDraftFile(key);
        if (!file) {
          return null;
        }
        const text = file.textSync();
        return text.length <= ROUTINE_DRAFT_MAX_CHARS ? text : null;
      } catch {
        return null;
      }
    },
    write(key, value) {
      const name = routineDraftFileName(key);
      if (!name || value.length > ROUTINE_DRAFT_MAX_CHARS) {
        throw new Error('routine draft rejected');
      }
      const directory = draftDirectory();
      if (!directory.exists) {
        directory.create({ intermediates: true, idempotent: true });
      }
      const file = new File(directory, name);
      if (!file.exists) {
        file.create();
      }
      file.write(value);
    },
    delete(key) {
      const file = existingDraftFile(key);
      if (!file) {
        return;
      }
      file.delete();
    },
  };
}

function draftDirectory(): Directory {
  return new Directory(Paths.document, DIRECTORY_NAME);
}

function existingDraftFile(key: string): File | null {
  const name = routineDraftFileName(key);
  if (!name) {
    return null;
  }
  const directory = draftDirectory();
  if (!directory.exists) {
    return null;
  }
  const file = new File(directory, name);
  return file.exists ? file : null;
}
