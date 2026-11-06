import { PERSIST_PLANNED_WEIGHT, PERSIST_REST_SECONDS } from './flags.ts';
import { formatEquipmentTargetList } from './equipment-targets.ts';
import { formatPlannedWeightSentence, PLANNED_WEIGHT_STORED_MESSAGE } from './planned-weight.ts';
import {
  matchImportedExercises,
  type ImportCatalogExercise,
} from './match-exercises.ts';
import { toImportPreview, type ProgramReview, type ReviewExercise } from './review-editor.ts';
import type { PreviewMatchStatus } from './save-plan.ts';
import { toSavePayload } from './save-payload.ts';

export const IMPORT_REVIEW_NOTICE =
  'Review the draft before saving. Nothing is saved until you press Save imported routine.';

export const IMPORTED_NAME_NOTICE =
  'Imported exercise names stay on this draft. Saving stores the catalog exercise you choose.';

export const WEIGHT_VISIBLE_MESSAGE =
  'Imported weight stays on this screen and is not stored yet.';

export const REST_STORED_MESSAGE = 'Rest is stored when you save.';

export const REST_NOT_STORED_MESSAGE =
  'Rest stays on this screen. This build does not store rest yet.';

export const CATALOG_SEARCH_NOTE = 'Search the catalog to choose or change this match.';

export const CATALOG_UNAVAILABLE_NOTE =
  'The exercise catalog is not available, so this match cannot be changed yet.';

export const IMPORT_CATALOG_UNAVAILABLE_MESSAGE =
  'The exercise catalog could not be loaded, so every exercise stays unmatched. Nothing was saved.';

export const CATALOG_CHOICE_LIMIT = 12;

const MATCH_TEXT: Record<PreviewMatchStatus, string> = {
  matched: 'Matched to a catalog exercise.',
  ambiguous: 'Ambiguous. More than one catalog exercise fits.',
  unmatched: 'Unmatched. No catalog exercise was selected.',
  manual: 'Corrected to a chosen exercise.',
};

const SAVE_CHECK_USER = '11111111-1111-1111-1111-111111111111';

export function importDraftSummary(review: ProgramReview): string {
  const count = review.days.length;
  const name = review.programName.trim() || 'Imported routine';
  const days = count === 1 ? '1 day' : `${count} days`;
  return `${name} · ${days}. Workout history was not changed.`;
}

export function formatPrescription(exercise: ReviewExercise): string {
  const sets = exercise.sets.value;
  const min = exercise.repsMin.value;
  const max = exercise.repsMax.value;
  if (sets == null && min == null && max == null) {
    return 'Sets and reps were not in the draft.';
  }
  const reps =
    min == null && max == null
      ? 'reps missing'
      : min != null && max != null
        ? min === max
          ? String(min)
          : `${min}–${max}`
        : min != null
          ? String(min)
          : String(max);
  if (sets == null) {
    return `Sets missing × ${reps}`;
  }
  return `${sets} × ${reps}`;
}

export function restStorageMessage(): string {
  return PERSIST_REST_SECONDS ? REST_STORED_MESSAGE : REST_NOT_STORED_MESSAGE;
}

export function formatRest(exercise: ReviewExercise): string {
  const value = exercise.restSeconds.value;
  const shown = value == null ? 'No rest period was in the draft.' : `Rest ${value} seconds.`;
  return `${shown} ${restStorageMessage()}`;
}

export function formatWeight(exercise: ReviewExercise): string {
  const sentence = formatPlannedWeightSentence(exercise.weight?.value, exercise.plannedWeightUnit ?? null);
  const targets = formatEquipmentTargetList(exercise.equipmentTargets);
  const storage = PERSIST_PLANNED_WEIGHT ? PLANNED_WEIGHT_STORED_MESSAGE : WEIGHT_VISIBLE_MESSAGE;
  return targets === '' ? `${sentence} ${storage}` : `${sentence} ${targets} ${storage}`;
}

export function importRetentionNotes(review: ProgramReview): string[] {
  const notes: string[] = [IMPORTED_NAME_NOTICE];
  if (
    !PERSIST_PLANNED_WEIGHT &&
    review.days.some((day) => day.exercises.some((exercise) => exercise.weight?.value != null))
  ) {
    notes.push(WEIGHT_VISIBLE_MESSAGE);
  }
  if (
    !PERSIST_REST_SECONDS &&
    review.days.some((day) => day.exercises.some((exercise) => exercise.restSeconds.value != null))
  ) {
    notes.push(REST_NOT_STORED_MESSAGE);
  }
  if ((review.warnings ?? []).some((warning) => warning.trim() !== '')) {
    notes.push('Import notes stay on this screen and are not stored.');
  }
  return notes;
}

export function importSavedMessage(review: ProgramReview, programId: string): string {
  return [`Saved id ${programId}.`, ...importRetentionNotes(review), 'Workout history was not changed.'].join(
    ' ',
  );
}

/** Draft fields that would make Save refuse. Account checks stay on the save press. */
export function importReviewSaveBlockers(review: ProgramReview): string[] {
  const preview = toImportPreview(review);
  const payload = toSavePayload({ ...preview, issues: [] }, SAVE_CHECK_USER, {
    hasActiveProgram: true,
  });
  return payload.ok ? [] : [...payload.errors];
}

export function catalogExercisesForMatch(
  rows: readonly { id: string | number; name: string; equipment?: string | null }[],
): ImportCatalogExercise[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    equipment_type: row.equipment ?? null,
  }));
}

export type ImportReviewChoice = {
  id: string;
  name: string;
  selected: boolean;
};

export function catalogChoices(
  catalog: readonly ImportCatalogExercise[],
  exercise: ReviewExercise,
  query: string,
): { choices: ImportReviewChoice[]; hiddenCount: number } {
  const selected =
    exercise.exerciseId == null || exercise.exerciseId === '' ? '' : String(exercise.exerciseId);
  const byId = new Map(
    catalog.map((row) => [String(row.id), row.name.trim() || `Exercise ${row.id}`]),
  );
  const needle = query.trim().toLowerCase();
  const ranked: { id: string; name: string }[] = [];
  const seen = new Set<string>();

  function add(id: string) {
    if (seen.has(id) || !byId.has(id)) {
      return;
    }
    const name = byId.get(id) ?? '';
    if (needle !== '' && !name.toLowerCase().includes(needle)) {
      return;
    }
    seen.add(id);
    ranked.push({ id, name });
  }

  if (needle === '') {
    if (selected !== '') {
      add(selected);
    }
    const sourceName = exercise.sourceName?.trim() ?? '';
    if (sourceName !== '') {
      for (const id of matchImportedExercises(catalog, sourceName).candidateIds) {
        add(id);
      }
    }
  }

  const remainder = [...byId.entries()]
    .filter(([id, name]) => !seen.has(id) && (needle === '' || name.toLowerCase().includes(needle)))
    .sort((left, right) => left[1].localeCompare(right[1]));
  for (const [id] of remainder) {
    add(id);
  }

  const visible = ranked.slice(0, CATALOG_CHOICE_LIMIT);
  return {
    choices: visible.map((row) => ({
      id: row.id,
      name: row.name,
      selected: row.id === selected,
    })),
    hiddenCount: ranked.length - visible.length,
  };
}

export type DescribedImportExercise = {
  dayIndex: number;
  exerciseIndex: number;
  dayNumber: number;
  exerciseNumber: number;
  name: string;
  matchStatus: PreviewMatchStatus;
  matchText: string;
  prescription: string;
  restText: string;
  rest: string;
  weightText: string;
  notes: string;
  sets: string;
  repsMin: string;
  repsMax: string;
  choices: ImportReviewChoice[];
  hiddenCount: number;
  catalogNote: string;
};

export type DescribedImportDay = {
  dayIndex: number;
  dayNumber: number;
  name: string;
  subtitle: string;
  emptyText: string | null;
  exercises: DescribedImportExercise[];
};

export type DescribedImportReview = {
  summary: string;
  notice: string;
  nameNotice: string;
  programName: string;
  issues: string[];
  warnings: string[];
  retained: string[];
  blockers: string[];
  days: DescribedImportDay[];
};

function numberText(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

export function describeImportReview(
  review: ProgramReview,
  catalog: readonly ImportCatalogExercise[] = [],
): DescribedImportReview {
  return {
    summary: importDraftSummary(review),
    notice: IMPORT_REVIEW_NOTICE,
    nameNotice: IMPORTED_NAME_NOTICE,
    programName: review.programName,
    issues: review.issues.map((issue) => issue.message?.trim() || issue.code),
    warnings: [...(review.warnings ?? [])],
    retained: importRetentionNotes(review),
    blockers: importReviewSaveBlockers(review),
    days: review.days.map((day, dayIndex) => ({
      dayIndex,
      dayNumber: dayIndex + 1,
      name: day.name,
      subtitle: day.subtitle ?? '',
      emptyText: day.exercises.length === 0 ? 'This day has no exercises.' : null,
      exercises: day.exercises.map((exercise, exerciseIndex) => {
        const listed = catalogChoices(catalog, exercise, '');
        return {
          dayIndex,
          exerciseIndex,
          dayNumber: dayIndex + 1,
          exerciseNumber: exerciseIndex + 1,
          name: exercise.sourceName ?? '',
          matchStatus: exercise.matchStatus,
          matchText: MATCH_TEXT[exercise.matchStatus],
          prescription: formatPrescription(exercise),
          restText: formatRest(exercise),
          rest: numberText(exercise.restSeconds.value),
          weightText: formatWeight(exercise),
          notes: exercise.notes ?? '',
          sets: numberText(exercise.sets.value),
          repsMin: numberText(exercise.repsMin.value),
          repsMax: numberText(exercise.repsMax.value),
          choices: listed.choices,
          hiddenCount: listed.hiddenCount,
          catalogNote: catalog.length === 0 ? CATALOG_UNAVAILABLE_NOTE : CATALOG_SEARCH_NOTE,
        };
      }),
    })),
  };
}
