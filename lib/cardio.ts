export const CARDIO_ACTIVITY_TYPES = [
  'Incline Walk',
  'Treadmill Walk',
  'Outdoor Walk',
  'Running',
  'Cycling',
  'Swimming',
  'Stair Climber',
  'Elliptical',
  'Other',
] as const;

export type CardioActivityType = (typeof CARDIO_ACTIVITY_TYPES)[number];

export type CardioSession = {
  id: string;
  activity_type: string;
  started_at: string;
  duration_minutes: number;
  distance_km: number | null;
  incline_percent: number | null;
  speed_kmh: number | null;
  calories: number | null;
  notes: string | null;
};

export function isCardioActivityType(value: string): value is CardioActivityType {
  return (CARDIO_ACTIVITY_TYPES as readonly string[]).includes(value);
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
  const distance = formatCardioNumber(session.distance_km);
  const incline = formatCardioNumber(session.incline_percent);
  const speed = formatCardioNumber(session.speed_kmh);
  const calories = formatCardioNumber(session.calories);

  if (distance) {
    parts.push(`${distance} km`);
  }

  if (incline) {
    parts.push(`${incline}% incline`);
  }

  if (speed) {
    parts.push(`${speed} km/h`);
  }

  if (calories) {
    parts.push(`${calories} cal`);
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
