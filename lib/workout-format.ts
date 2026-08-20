import { formatWeight } from '@/lib/warmup';

export function formatWorkoutDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatWorkoutDuration(
  startedAt: string,
  finishedAt: string | null,
): string | null {
  if (!finishedAt) {
    return null;
  }

  const milliseconds =
    new Date(finishedAt).getTime() - new Date(startedAt).getTime();

  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return null;
  }

  const totalMinutes = Math.round(milliseconds / 60000);

  if (totalMinutes < 1) {
    return '< 1 min';
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

export function formatSetLoad(weight: number | string | null): string {
  if (weight === null || weight === '') {
    return 'BW';
  }

  const numericWeight = Number(weight);

  if (!Number.isFinite(numericWeight) || numericWeight === 0) {
    return 'BW';
  }

  return `${formatWeight(numericWeight)} lb`;
}

export function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}
