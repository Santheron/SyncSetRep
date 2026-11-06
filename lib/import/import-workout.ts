import { IMPORT_ENABLED } from './flags.ts';
import { TEXT_MAX_CHARS } from './limits.ts';
import { matchImportedExercises, type ImportCatalogExercise } from './match-exercises.ts';
import { applySourceLineMachineNotes } from './planned-weight.ts';
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

export const IMPORT_UNAUTHORIZED_MESSAGE =
  'Sign in again before importing. Nothing was saved.';

export const IMPORT_UNCONFIGURED_MESSAGE =
  'Workout import is not configured. Nothing was saved.';

export const IMPORT_QUOTA_UNAVAILABLE_MESSAGE =
  'Import quota could not be checked. Nothing was saved.';

export const IMPORT_RATE_BURST_MESSAGE =
  'Too many imports in a short time. Nothing was saved.';

export const IMPORT_RATE_DAILY_MESSAGE =
  'The daily import limit was reached. Nothing was saved.';

export const IMPORT_UPSTREAM_AUTH_MESSAGE =
  'The model service rejected the importer credentials. Nothing was saved.';

export const IMPORT_UPSTREAM_BILLING_MESSAGE =
  'The model service has a billing or quota problem. Nothing was saved.';

export const IMPORT_UPSTREAM_REJECTED_MESSAGE =
  'The model service rejected the import request. Nothing was saved.';

export const IMPORT_UPSTREAM_RATE_MESSAGE =
  'The model service is rate limiting imports. Nothing was saved.';

export const IMPORT_UPSTREAM_TIMEOUT_MESSAGE =
  'The model service took too long. Nothing was saved.';

export const IMPORT_UPSTREAM_FAILED_MESSAGE =
  'The model service failed before a workout draft was returned. Nothing was saved.';

const FUNCTION_ERROR_MESSAGES: Record<string, string> = {
  unauthorized: IMPORT_UNAUTHORIZED_MESSAGE,
  import_unconfigured: IMPORT_UNCONFIGURED_MESSAGE,
  quota_unavailable: IMPORT_QUOTA_UNAVAILABLE_MESSAGE,
  rate_limited_burst: IMPORT_RATE_BURST_MESSAGE,
  rate_limited_daily: IMPORT_RATE_DAILY_MESSAGE,
  invalid_import: IMPORT_UNREADABLE_MESSAGE,
  import_failed: IMPORT_FAILED_MESSAGE,
  method_not_allowed: IMPORT_FAILED_MESSAGE,
  import_upstream_auth: IMPORT_UPSTREAM_AUTH_MESSAGE,
  import_upstream_billing: IMPORT_UPSTREAM_BILLING_MESSAGE,
  import_upstream_rejected: IMPORT_UPSTREAM_REJECTED_MESSAGE,
  import_upstream_rate_limited: IMPORT_UPSTREAM_RATE_MESSAGE,
  import_upstream_timeout: IMPORT_UPSTREAM_TIMEOUT_MESSAGE,
  import_upstream_failed: IMPORT_UPSTREAM_FAILED_MESSAGE,
};

export type ImportInvokeError = {
  message?: string | null;
  context?: unknown;
};

export type ImportWorkoutInvoke = (body: {
  source: string;
}) => Promise<{ data: unknown; error: ImportInvokeError | null }>;

export type ImportWorkoutResult =
  | { ok: true; review: ProgramReview }
  | { ok: false; errors: string[] };

const FAILURE_MESSAGES: Record<string, string> = {
  over_capacity: 'This import has more days or exercises than can be saved. Nothing was saved.',
  parse_empty: 'The import did not include a workout day. Nothing was saved.',
};

function reviewFromModel(
  data: unknown,
  catalog: readonly ImportCatalogExercise[],
  source?: string,
): ImportWorkoutResult {
  const schema = checkImportSchema(data);
  if (!schema.ok) {
    return { ok: false, errors: [IMPORT_UNREADABLE_MESSAGE] };
  }
  const validated = validateImportModelOutput(data);
  if (!validated.ok) {
    return { ok: false, errors: [FAILURE_MESSAGES[validated.code] ?? IMPORT_UNREADABLE_MESSAGE] };
  }
  const draft = source == null ? validated.data : applySourceLineMachineNotes(validated.data, source);
  const matches = draft.days.map((day) =>
    day.exercises.map((exercise) => {
      const match = matchImportedExercises(catalog, exercise.sourceName);
      return { status: match.status, selectedId: match.selectedId };
    }),
  );
  return { ok: true, review: programReviewFromImport(draft, matches) };
}

function knownFunctionError(value: unknown): string | null {
  if (typeof value !== 'string' || !Object.hasOwn(FUNCTION_ERROR_MESSAGES, value)) {
    return null;
  }
  return value;
}

function codeFromPayload(value: unknown): string | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return knownFunctionError((value as { error?: unknown }).error);
}

async function codeFromContext(context: unknown): Promise<string | null> {
  if (context == null || typeof context !== 'object') {
    return null;
  }
  let source: unknown = context;
  const clone = (context as { clone?: unknown }).clone;
  if (typeof clone === 'function') {
    try {
      source = (clone as () => unknown).call(context);
    } catch {
      source = context;
    }
  }
  if (source == null || typeof source !== 'object' || typeof (source as { text?: unknown }).text !== 'function') {
    return null;
  }
  try {
    const text = await (source as { text: () => Promise<string> }).text();
    if (typeof text !== 'string' || text.length === 0 || text.length > 4096) {
      return null;
    }
    return codeFromPayload(JSON.parse(text));
  } catch {
    return null;
  }
}

async function functionErrorCode(data: unknown, error: ImportInvokeError): Promise<string | null> {
  return codeFromPayload(data) ??
    codeFromPayload(error) ??
    knownFunctionError(error.message) ??
    await codeFromContext(error.context);
}

function messageForFunctionCode(code: string | null): string {
  if (code == null) {
    return IMPORT_FAILED_MESSAGE;
  }
  return FUNCTION_ERROR_MESSAGES[code] ?? IMPORT_FAILED_MESSAGE;
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
  let response: { data: unknown; error: ImportInvokeError | null };
  try {
    response = await invoke({ source: text });
  } catch {
    return { ok: false, errors: [IMPORT_FAILED_MESSAGE] };
  }
  if (response.error) {
    const code = await functionErrorCode(response.data, response.error);
    return { ok: false, errors: [messageForFunctionCode(code)] };
  }
  return reviewFromModel(response.data, options?.catalog ?? [], text);
}
