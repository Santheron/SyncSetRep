export const UNSCHEDULED_PROGRAM_DAY_SUBTITLE = 'Not on the weekly schedule';

export function isUnscheduledProgramDay(subtitle: string | null | undefined): boolean {
  return subtitle === UNSCHEDULED_PROGRAM_DAY_SUBTITLE;
}

export function scheduledProgramDayCount(days: readonly { subtitle: string | null }[]): number {
  let count = 0;
  for (const day of days) {
    if (!isUnscheduledProgramDay(day.subtitle)) {
      count += 1;
    }
  }
  return count;
}

export function programDayIndexLabel(day: { subtitle: string | null; dayOrder: number }): string | null {
  if (isUnscheduledProgramDay(day.subtitle)) {
    return null;
  }
  return String(day.dayOrder);
}
