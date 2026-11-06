import { OWNED_SAVE_MAX_DAYS, MAX_EXERCISES, DAY_NAME_MAX } from './limits.ts';
import { isRestDayLabel } from './one-tap-import.ts';
import { createProgramReview, type ProgramReview, type ReviewExercise } from './review-editor.ts';
import type { PreviewNumber } from './save-plan.ts';

// Local reading of a pasted week. This does not call a model or a database.
// A single exercise line is left for the model path. A week with sections is
// returned here, including movements that have no sets or reps.

export const STRUCTURED_PROGRAM_NAME = 'Imported routine';

export const UNASSIGNED_SECTION_SUBTITLE = 'Not on the weekly schedule';

type ParsedSection = {
  name: string;
  exercises: ReviewExercise[];
};

export function parseStructuredRoutine(source: string): ProgramReview | null {
  if (typeof source !== 'string' || source.trim() === '') {
    return null;
  }
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    blocks.push(current);
  }

  const sections: ParsedSection[] = [];
  let schedule: string[] | null = null;
  for (const block of blocks) {
    if (block.length === 1 && isScheduleLine(block[0] ?? '')) {
      schedule = schedule ?? splitSchedule(block[0] ?? '');
      continue;
    }
    const first = block[0] ?? '';
    if (!isExerciseLine(first) && block.length > 1) {
      const exercises = block.slice(1).flatMap((line) => {
        const exercise = parseExerciseLine(line);
        return exercise ? [exercise] : [];
      });
      if (exercises.length === 0) {
        continue;
      }
      sections.push({ name: first, exercises });
      continue;
    }
    if (!isExerciseLine(first) && isRestDayLabel(first)) {
      sections.push({ name: first, exercises: [] });
      continue;
    }
    const exercises = block.flatMap((line) => {
      const exercise = parseExerciseLine(line);
      return exercise ? [exercise] : [];
    });
    if (exercises.length >= 2) {
      sections.push({ name: 'Day 1', exercises });
    }
  }

  const exerciseCount = sections.reduce((total, section) => total + section.exercises.length, 0);
  if (exerciseCount === 0 || sections.length === 0) {
    return null;
  }
  const days = schedule ? daysFromSchedule(schedule, sections) : sections.map((section) => dayFromSection(section, null));
  if (days.length < 1 || days.length > OWNED_SAVE_MAX_DAYS || exerciseCount > MAX_EXERCISES) {
    return null;
  }
  if (days.some((day) => day.name.trim().length < 1 || day.name.trim().length > DAY_NAME_MAX)) {
    return null;
  }
  return createProgramReview({
    origin: 'import',
    programName: STRUCTURED_PROGRAM_NAME,
    days,
  });
}

function daysFromSchedule(schedule: readonly string[], sections: readonly ParsedSection[]) {
  const used = new Set<number>();
  const days = schedule.map((name) => {
    if (isRestDayLabel(name)) {
      return { name: name.trim(), subtitle: null, exercises: [] as ReviewExercise[] };
    }
    const index = sections.findIndex(
      (section, sectionIndex) => !used.has(sectionIndex) && sameLabel(section.name, name),
    );
    if (index < 0) {
      return { name: name.trim(), subtitle: null, exercises: [] as ReviewExercise[] };
    }
    used.add(index);
    return dayFromSection(sections[index] ?? { name, exercises: [] }, null);
  });
  sections.forEach((section, index) => {
    if (used.has(index)) {
      return;
    }
    if (isRestDayLabel(section.name) && section.exercises.length === 0) {
      return;
    }
    days.push(dayFromSection(section, UNASSIGNED_SECTION_SUBTITLE));
  });
  return days;
}

function dayFromSection(section: ParsedSection, subtitle: string | null) {
  return {
    name: section.name.trim(),
    subtitle,
    exercises: section.exercises,
  };
}

function sameLabel(left: string, right: string): boolean {
  return left.trim().toLowerCase().replace(/\s+/g, ' ') === right.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isScheduleLine(line: string): boolean {
  if (isExerciseLine(line)) {
    return false;
  }
  const parts = splitSchedule(line);
  return parts.length >= 3 && parts.every((part) => part.length <= DAY_NAME_MAX);
}

function splitSchedule(line: string): string[] {
  return line
    .split(' - ')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function isExerciseLine(line: string): boolean {
  return /^\s*\[[^\]]*\]/.test(line) || /\d+\s*x\s*\d+/i.test(line) || /\d+\s+reps?\b/i.test(line);
}

function parseExerciseLine(line: string): ReviewExercise | null {
  const body = line.replace(/^\s*\[[^\]]*\]\s*/, '').trim();
  if (body === '' || isScheduleLine(body)) {
    return null;
  }
  let remainder = body;
  let weight: number | null = null;
  let notes: string | null = null;
  const weightMatch = remainder.match(/^(.*?)(?:\s+-\s*|\s*-)(\d+(?:\.\d+)?)(\s*\([^)]{1,80}\))?\s*$/);
  if (weightMatch) {
    remainder = weightMatch[1]?.trim() ?? '';
    const parsedWeight = Number(weightMatch[2]);
    weight = Number.isFinite(parsedWeight) ? parsedWeight : null;
    const clause = weightMatch[3]?.trim() ?? '';
    if (weight != null && clause !== '') {
      notes = `${weightMatch[2]} ${clause}`.replace(/\s+/g, ' ').trim();
    }
  }
  let sets: number | null = null;
  let reps: number | null = null;
  const setsMatch = remainder.match(/^(.*?)(?:^|\s)(\d+)\s*x\s*(\d+)\s*$/i);
  if (setsMatch) {
    remainder = setsMatch[1]?.trim() ?? '';
    sets = Number(setsMatch[2]);
    reps = Number(setsMatch[3]);
  } else {
    const repsMatch = remainder.match(/^(.*?)(?:^|\s)(\d+)\s+reps?(?:\s+(each))?\s*$/i);
    if (repsMatch) {
      remainder = repsMatch[1]?.trim() ?? '';
      reps = Number(repsMatch[2]);
      if (repsMatch[3] && notes == null) {
        notes = 'each';
      }
    }
  }
  const name = remainder.trim();
  if (name === '') {
    return null;
  }
  const exercise: ReviewExercise = {
    source: 'imported',
    sourceName: name,
    exerciseId: null,
    matchStatus: 'unmatched',
    sets: extractedNumber(sets),
    repsMin: extractedNumber(reps),
    repsMax: extractedNumber(reps),
    restSeconds: { acceptance: 'missing', value: null },
    notes,
  };
  if (weight != null) {
    exercise.weight = { acceptance: 'extracted', value: weight, suggestion: null };
  }
  return exercise;
}

function extractedNumber(value: number | null): PreviewNumber {
  if (value == null || !Number.isInteger(value)) {
    return { acceptance: 'missing', value: null };
  }
  return { acceptance: 'extracted', value, suggestion: null };
}
