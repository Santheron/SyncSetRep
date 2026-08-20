export const CARDIO_ACTIVITY_TYPES = [
  'Walking',
  'Incline Walk',
  'Running',
  'Cycling',
  'Swimming',
  'Elliptical',
  'Other',
] as const;

export type CardioActivityType = (typeof CARDIO_ACTIVITY_TYPES)[number];

export type CardioLog = {
  id: string;
  activityType: CardioActivityType;
  durationMinutes: number;
  distance: string | null;
  speed: string | null;
  incline: string | null;
  calories: string | null;
  notes: string | null;
  loggedAt: string;
};

export type CardioLogInput = Omit<CardioLog, 'id' | 'loggedAt'>;

const placeholderLogs: CardioLog[] = [
  {
    id: 'placeholder-1',
    activityType: 'Incline Walk',
    durationMinutes: 32,
    distance: '1.6',
    speed: null,
    incline: '8',
    calories: '214',
    notes: null,
    loggedAt: '2026-08-19T18:10:00.000Z',
  },
  {
    id: 'placeholder-2',
    activityType: 'Walking',
    durationMinutes: 24,
    distance: '1.1',
    speed: '2.8',
    incline: null,
    calories: null,
    notes: null,
    loggedAt: '2026-08-18T12:40:00.000Z',
  },
  {
    id: 'placeholder-3',
    activityType: 'Cycling',
    durationMinutes: 45,
    distance: '10.2',
    speed: '13.6',
    incline: null,
    calories: '380',
    notes: 'Easy spin',
    loggedAt: '2026-08-16T09:05:00.000Z',
  },
];

let cardioLogs: CardioLog[] = [...placeholderLogs];

export function getCardioLogs(): CardioLog[] {
  return cardioLogs;
}

export function addCardioLog(input: CardioLogInput): CardioLog {
  const nextLog: CardioLog = {
    ...input,
    id: `local-${Date.now()}`,
    loggedAt: new Date().toISOString(),
  };

  cardioLogs = [nextLog, ...cardioLogs];
  return nextLog;
}

export function formatCardioSummary(log: CardioLog): string {
  const parts = [`${log.durationMinutes} min`];

  if (log.distance) {
    parts.push(`${log.distance} mi`);
  }

  if (log.speed) {
    parts.push(`${log.speed} mph`);
  }

  if (log.incline) {
    parts.push(`${log.incline}% incline`);
  }

  if (log.calories) {
    parts.push(`${log.calories} cal`);
  }

  return parts.join(' · ');
}
