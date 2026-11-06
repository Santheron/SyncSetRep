import { Directory, File, Paths } from 'expo-file-system';

import type { TodayTargetStore } from './workout-today.ts';

// On-device copy of today's set and rep plan. It does not write the routine.

const DIRECTORY_NAME = 'workout-today';

export function documentWorkoutTodayStore(): TodayTargetStore {
  return {
    read(sessionId) {
      try {
        const file = existingFile(sessionId);
        if (!file) {
          return null;
        }
        const text = file.textSync();
        return text.length <= 20_000 ? text : null;
      } catch {
        return null;
      }
    },
    write(sessionId, value) {
      if (!/^[1-9][0-9]{0,18}$/.test(sessionId) || value.length > 20_000) {
        return;
      }
      const directory = todayDirectory();
      if (!directory.exists) {
        directory.create({ intermediates: true, idempotent: true });
      }
      const file = new File(directory, `${sessionId}.json`);
      if (!file.exists) {
        file.create();
      }
      file.write(value);
    },
  };
}

function todayDirectory(): Directory {
  return new Directory(Paths.document, DIRECTORY_NAME);
}

function existingFile(sessionId: string): File | null {
  if (!/^[1-9][0-9]{0,18}$/.test(sessionId)) {
    return null;
  }
  const directory = todayDirectory();
  if (!directory.exists) {
    return null;
  }
  const file = new File(directory, `${sessionId}.json`);
  return file.exists ? file : null;
}
