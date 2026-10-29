import {
  createProgramReview,
  type ProgramReview,
  type ReviewExercise,
} from './review-editor.ts';
import type { PreviewNumber } from './save-plan.ts';
import type { ImportDraft, IntField } from './validate-draft.ts';

export type ReviewMatch = {
  status: 'matched' | 'ambiguous' | 'unmatched';
  selectedId: string | null;
};

type ReviewMatchStatus = ReviewExercise['matchStatus'];

function numberFromDraft(field: IntField): PreviewNumber {
  if (field.origin === 'extracted' && field.value != null) {
    return { acceptance: 'extracted', value: field.value, suggestion: null };
  }
  return {
    acceptance: 'missing',
    value: null,
    suggestion: field.suggestion,
  };
}

export function programReviewFromImport(
  draft: ImportDraft,
  matchesByDay: readonly (readonly ReviewMatch[])[],
): ProgramReview {
  return createProgramReview({
    origin: 'import',
    programName: draft.programName.value ?? '',
    issues: draft.issues,
    days: draft.days.map((day, dayIndex) => ({
      name: day.name.value ?? '',
      subtitle: day.subtitle.value,
      exercises: day.exercises.map((exercise, exerciseIndex) => {
        const match = matchesByDay[dayIndex]?.[exerciseIndex];
        const selected =
          match?.status === 'matched' && match.selectedId != null && match.selectedId !== ''
            ? match.selectedId
            : null;
        const matchStatus: ReviewMatchStatus =
          selected != null ? 'matched' : match?.status === 'ambiguous' ? 'ambiguous' : 'unmatched';
        return {
          source: 'imported',
          sourceName: exercise.sourceName,
          exerciseId: selected,
          matchStatus,
          sets: numberFromDraft(exercise.sets),
          repsMin: numberFromDraft(exercise.repsMin),
          repsMax: numberFromDraft(exercise.repsMax),
          restSeconds: numberFromDraft(exercise.restSeconds),
          notes: exercise.notes.value,
        };
      }),
    })),
  });
}
