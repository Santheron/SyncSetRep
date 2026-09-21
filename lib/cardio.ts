import { supabase } from '@/lib/supabase';

export const CARDIO_ACTIVITY_TYPES = [
  'Incline Walk',
  'Treadmill Run',
  'Outdoor Walk',
  'Outdoor Run',
  'Cycling',
  'Rowing',
  'Stair Climber',
  'Elliptical',
  'Other',
] as const;

export type CardioActivityType = (typeof CARDIO_ACTIVITY_TYPES)[number];

const TREADMILL_ACTIVITY_TYPES = new Set<string>(['Incline Walk', 'Treadmill Run']);

export type CardioSession = {
  id: string;
  activity_type: string;
  started_at: string;
  duration_minutes: number;
  distance: number | null;
  incline_percent: number | null;
  speed: number | null;
  calories: number | null;
  notes: string | null;
};

export function isCardioActivityType(value: string): value is CardioActivityType {
  return (CARDIO_ACTIVITY_TYPES as readonly string[]).includes(value);
}

export function showsTreadmillFields(activityType: string): boolean {
  return TREADMILL_ACTIVITY_TYPES.has(activityType);
}

export type ParsedOptionalNumber =
  | { ok: true; value: number | null }
  | { ok: false };

export function parseOptionalNumber(value: string): ParsedOptionalNumber {
  const trimmed = value.trim();

  if (!trimmed) {
    return { ok: true, value: null };
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    return { ok: false };
  }

  return { ok: true, value: parsed };
}

export function formatCardioNumber(value: number | string | null): string | null {
  if (value === null || value === '') {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return Number.isInteger(numericValue)
    ? String(numericValue)
    : String(Number(numericValue.toFixed(2)));
}

export function formatCardioSummary(session: CardioSession): string {
  const parts = [`${formatCardioNumber(session.duration_minutes) ?? session.duration_minutes} min`];
  const distance = formatCardioNumber(session.distance);
  const calories = formatCardioNumber(session.calories);
  const speed = formatCardioNumber(session.speed);
  const incline = formatCardioNumber(session.incline_percent);

  if (distance) {
    parts.push(`${distance} mi`);
  }

  if (calories) {
    parts.push(`${calories} cal`);
  }

  if (speed) {
    parts.push(`${speed} mph`);
  }

  if (incline) {
    parts.push(`${incline}% incline`);
  }

  return parts.join(' · ');
}

let saveNotice: string | null = null;

export function setCardioSaveNotice() {
  saveNotice = 'Cardio session saved.';
}

export function consumeCardioSaveNotice(): string | null {
  const notice = saveNotice;
  saveNotice = null;
  return notice;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type CardioSessionInput = {
  activity_type: string;
  started_at: string;
  duration_minutes: number;
  distance: number | null;
  incline_percent: number | null;
  speed: number | null;
  calories: number | null;
  notes: string | null;
};

type CardioRow = Record<string, unknown> & {
  id?: string | number;
};

function toFiniteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = typeof value === 'bigint' ? Number(value) : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstNumber(row: CardioRow, keys: string[]): number | null {
  for (const key of keys) {
    if (key in row) {
      return toFiniteNumber(row[key]);
    }
  }

  return null;
}

function mapCardioRow(row: CardioRow): CardioSession {
  return {
    id: String(row.id),
    activity_type: String(row.activity_type ?? ''),
    started_at: String(row.started_at ?? ''),
    duration_minutes: toFiniteNumber(row.duration_minutes) ?? 0,
    distance: firstNumber(row, ['distance', 'distance_km', 'distance_mi']),
    incline_percent: firstNumber(row, ['incline_percent', 'incline']),
    speed: firstNumber(row, ['speed', 'speed_kmh', 'speed_mph']),
    calories: toFiniteNumber(row.calories),
    notes: row.notes == null ? null : String(row.notes),
  };
}

function formatSupabaseError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}): string {
  return [
    error.code,
    error.message,
    error.details,
    error.hint,
  ]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .join(' | ');
}

function isUndefinedColumnError(error: { code?: string | null; message?: string | null }): boolean {
  return error.code === 'PGRST204' || error.code === '42703';
}

function logCardioSaveError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}) {
  console.log('[CardioSave] error', {
    code: error.code ?? null,
    message: error.message ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  });
}

function buildInsertRows(input: CardioSessionInput): Record<string, unknown>[] {
  const shared = {
    activity_type: input.activity_type,
    started_at: input.started_at,
    duration_minutes: input.duration_minutes,
    calories: input.calories,
    notes: input.notes,
  };

  return [
    {
      ...shared,
      distance_km: input.distance,
      incline_percent: input.incline_percent,
      speed_kmh: input.speed,
    },
    {
      ...shared,
      distance: input.distance,
      incline: input.incline_percent,
      speed: input.speed,
      source: 'manual',
    },
    {
      ...shared,
      distance: input.distance,
      incline_percent: input.incline_percent,
      speed: input.speed,
    },
  ];
}

export async function listCardioSessions(): Promise<Result<CardioSession[]>> {
  const { data, error } = await supabase
    .from('cardio_sessions')
    .select('*')
    .order('started_at', { ascending: false });

  if (error) {
    return { ok: false, error: formatSupabaseError(error) };
  }

  return {
    ok: true,
    data: ((data ?? []) as CardioRow[]).map(mapCardioRow),
  };
}

export async function insertCardioSession(
  input: CardioSessionInput,
): Promise<Result<{ id: string }>> {
  const sanitized: CardioSessionInput = {
    activity_type: input.activity_type,
    started_at: input.started_at,
    duration_minutes: input.duration_minutes,
    distance: input.distance,
    incline_percent: input.incline_percent,
    speed: input.speed,
    calories: input.calories,
    notes: input.notes,
  };

  console.log('[CardioSave] submit', sanitized);

  let lastError: {
    code?: string | null;
    message?: string | null;
    details?: string | null;
    hint?: string | null;
  } | null = null;

  for (const row of buildInsertRows(sanitized)) {
    const { data, error } = await supabase
      .from('cardio_sessions')
      .insert(row)
      .select('id')
      .maybeSingle();

    if (!error) {
      const id = data?.id != null ? String(data.id) : 'saved';
      console.log('[CardioSave] success', { id });
      return { ok: true, data: { id } };
    }

    lastError = error;
    logCardioSaveError(error);

    if (!isUndefinedColumnError(error)) {
      break;
    }
  }

  return {
    ok: false,
    error: lastError
      ? formatSupabaseError(lastError)
      : 'Could not save cardio session.',
  };
}
