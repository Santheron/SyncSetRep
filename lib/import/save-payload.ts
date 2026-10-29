import {
  buildImportInsertPlan,
  type ImportInsertPlanOptions,
  type ImportPreview,
} from './save-plan.ts';

export const IMPORT_INVALID_EXERCISE_ID_MESSAGE =
  'Choose a catalog exercise id before saving. Nothing was saved.';

export type SaveImportedProgramExercise = {
  exercise_id: number;
  target_sets: number;
  min_reps: number;
  max_reps: number;
  notes: string | null;
};

export type SaveImportedProgramDay = {
  name: string;
  subtitle: string | null;
  exercises: SaveImportedProgramExercise[];
};

/** Keys allowed by save_imported_program. user id, order, slug, and rest stay out. */
export type SaveImportedProgramPayload = {
  name: string;
  days: SaveImportedProgramDay[];
};

export type SavePayloadResult =
  | { ok: true; payload: SaveImportedProgramPayload }
  | { ok: false; errors: string[] };

const BIGINT_MAX = '9223372036854775807';

function parseExerciseId(value: string): number | null {
  if (!/^[1-9][0-9]*$/.test(value)) {
    return null;
  }
  if (value.length > 19) {
    return null;
  }
  if (value.length === 19 && value > BIGINT_MAX) {
    return null;
  }
  if (value.length > 15) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

export function toSavePayload(
  edited: ImportPreview,
  userId: string,
  options: ImportInsertPlanOptions,
): SavePayloadResult {
  const plan = buildImportInsertPlan(edited, userId, options);
  if (!plan.ok) {
    return plan;
  }

  const days: SaveImportedProgramDay[] = [];
  for (const day of plan.plan.days) {
    const exercises: SaveImportedProgramExercise[] = [];
    for (const exercise of day.program_exercises) {
      const exerciseId = parseExerciseId(exercise.exercise_id);
      if (exerciseId == null) {
        return { ok: false, errors: [IMPORT_INVALID_EXERCISE_ID_MESSAGE] };
      }
      exercises.push({
        exercise_id: exerciseId,
        target_sets: exercise.target_sets,
        min_reps: exercise.min_reps,
        max_reps: exercise.max_reps,
        notes: exercise.notes,
      });
    }
    days.push({
      name: day.name,
      subtitle: day.subtitle,
      exercises,
    });
  }

  return {
    ok: true,
    payload: {
      name: plan.plan.program.name,
      days,
    },
  };
}
