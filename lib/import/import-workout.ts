import { IMPORT_ENABLED } from './flags.ts';
import { TEXT_MAX_CHARS } from './limits.ts';
import { matchImportedExercises, type ImportCatalogExercise } from './match-exercises.ts';
import { programReviewFromImport } from './review-from-import.ts';
import type { ProgramReview } from './review-editor.ts';
import { checkImportSchema, validateImportModelOutput } from './validate-draft.ts';

export const IMPORT_DISABLED_MESSAGE =
  'Workout import stays off in this build. Nothing was saved.';

export const IMPORT_EMPTY_SOURCE_MESSAGE =
  'Paste a workout before importing. Nothing was saved.';

export const IMPORT_SOURCE_TOO_LONG_MESSAGE =
  'Paste one week, up to 20,000 characters. Nothing was saved.';

export const IMPORT_UNREADABLE_MESSAGE =
  'The import could not be read. Nothing was saved.';

export const IMPORT_FAILED_MESSAGE = 'Could not import this workout. Nothing was saved.';

export type ImportWorkoutInvoke = (body: {
  source: string;
}) => Promise<{ data: unknown; error: { message?: string | null } | null }>;

export type ImportWorkoutResult =
  | { ok: true; review: ProgramReview }
  | { ok: false; errors: string[] };

const FAILURE_MESSAGES: Record<string, string> = {
  over_capacity: 'This import has more days or exercises than can be saved. Nothing was saved.',
  parse_empty: 'The import did not include a workout day. Nothing was saved.',
};

function reviewFromModel(data: unknown, catalog: readonly ImportCatalogExercise[]): ImportWorkoutResult {
  const schema = checkImportSchema(data);
  if (!schema.ok) {
    return { ok: false, errors: [IMPORT_UNREADABLE_MESSAGE] };
  }
  const validated = validateImportModelOutput(data);
  if (!validated.ok) {
    return { ok: false, errors: [FAILURE_MESSAGES[validated.code] ?? IMPORT_UNREADABLE_MESSAGE] };
  }
  const matches = validated.data.days.map((day) =>
    day.exercises.map((exercise) => {
      const match = matchImportedExercises(catalog, exercise.sourceName);
      return { status: match.status, selectedId: match.selectedId };
    }),
  );
  return { ok: true, review: programReviewFromImport(validated.data, matches) };
}

async function defaultInvoke(body: { source: string }) {
  const { supabase } = await import('../supabase.ts');
  const result = await supabase.functions.invoke('import-workout', { body });
  return { data: result.data, error: result.error };
}

export async function importWorkoutDraft(
  source: string,
  options?: {
    enabled?: boolean;
    catalog?: readonly ImportCatalogExercise[];
    invoke?: ImportWorkoutInvoke;
  },
): Promise<ImportWorkoutResult> {
  const text = typeof source === 'string' ? source.trim() : '';
  if (text.length === 0) {
    return { ok: false, errors: [IMPORT_EMPTY_SOURCE_MESSAGE] };
  }
  if (text.length > TEXT_MAX_CHARS) {
    return { ok: false, errors: [IMPORT_SOURCE_TOO_LONG_MESSAGE] };
  }
  const enabled = options?.enabled ?? IMPORT_ENABLED;
  const invoke = options?.invoke ?? (enabled ? defaultInvoke : undefined);
  if (!invoke) {
    return { ok: false, errors: [IMPORT_DISABLED_MESSAGE] };
  }
  let response: { data: unknown; error: { message?: string | null } | null };
  try {
    response = await invoke({ source: text });
  } catch {
    return { ok: false, errors: [IMPORT_FAILED_MESSAGE] };
  }
  if (response.error) {
    return { ok: false, errors: [IMPORT_FAILED_MESSAGE] };
  }
  return reviewFromModel(response.data, options?.catalog ?? []);
}
