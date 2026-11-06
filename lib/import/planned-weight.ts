import { NOTE_EDIT_MAX, WEIGHT_MAX, WEIGHT_MIN } from './limits.ts';

// Classifies a model weight string into a planned number, a unit, and machine notes.
// It does not call a model, a database, or a save RPC.

export const PLANNED_WEIGHT_RANGE_MESSAGE =
  'Enter a planned weight from 0 through 2000, or leave it blank.';

export const PLANNED_WEIGHT_STORED_MESSAGE = 'Planned weight is stored when you save.';

export const NOTE_TOO_LONG_ISSUE_MESSAGE =
  'Shorten this note to 280 characters or fewer before saving.';

const MACHINE_WORD = /\b(stack|pin|plate|lever|setting|notch)\b/i;

export type PlannedWeightUnit = 'lb' | 'kg';

export type ClassifiedWeight = {
  weight: number | null;
  unit: PlannedWeightUnit | null;
  notes: string | null;
  dropped: boolean;
};

type NoteIssue = {
  path: string;
  code: string;
  message: string;
};

type SourceExercise = {
  sourceName: string;
  notes: { value: string | null };
};

type SourceDraft = {
  days: Array<{ exercises: SourceExercise[] }>;
  issues: NoteIssue[];
};

export function formatPlannedWeightValue(value: number): string {
  if (!Number.isFinite(value)) {
    return '';
  }
  const text = String(value);
  if (!text.includes('.')) {
    return text;
  }
  return text.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function formatPlannedWeightSentence(
  weight: number | null | undefined,
  unit: PlannedWeightUnit | null | undefined,
): string {
  if (weight == null || !Number.isFinite(weight)) {
    return 'No planned weight.';
  }
  const shown = formatPlannedWeightValue(weight);
  if (unit === 'lb') {
    return `Weight ${shown} lb.`;
  }
  if (unit === 'kg') {
    return `Weight ${shown} kg.`;
  }
  return `Weight ${shown}. Unit not specified.`;
}

export function classifyImportedWeight(value: unknown, notes: string | null): ClassifiedWeight {
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value >= WEIGHT_MIN && value <= WEIGHT_MAX) {
      return { weight: value, unit: null, notes, dropped: false };
    }
    return { weight: null, unit: null, notes, dropped: true };
  }
  if (typeof value !== 'string') {
    return { weight: null, unit: null, notes, dropped: value != null };
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return { weight: null, unit: null, notes, dropped: true };
  }
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed) && parsed >= WEIGHT_MIN && parsed <= WEIGHT_MAX) {
      return { weight: parsed, unit: null, notes, dropped: false };
    }
    return { weight: null, unit: null, notes, dropped: true };
  }

  const loads = unitLoads(trimmed);
  const inRange = loads.filter((load) => load.value >= WEIGHT_MIN && load.value <= WEIGHT_MAX);
  const distinct = new Set(inRange.map((load) => `${load.value}:${load.unit}`));
  const chosen = loads.length > 0 && loads.length === inRange.length && distinct.size === 1 ? inRange[0] : null;
  const machineAt = machineIndex(trimmed);
  const clause = machineAt == null ? null : trimmed.slice(machineAt).trim();
  if (chosen && clause == null) {
    return { weight: chosen.value, unit: chosen.unit, notes, dropped: false };
  }
  if (chosen && clause != null) {
    return {
      weight: chosen.value,
      unit: chosen.unit,
      notes: appendMachineClause(notes, clause),
      dropped: false,
    };
  }
  if (clause != null) {
    return { weight: null, unit: null, notes: appendMachineClause(notes, clause), dropped: false };
  }
  return { weight: null, unit: null, notes, dropped: true };
}

export function appendMachineClause(notes: string | null, clause: string): string | null {
  const text = clause.trim();
  if (text === '') {
    return notes;
  }
  if (notes != null && notes.toLowerCase().includes(text.toLowerCase())) {
    return notes;
  }
  const current = notes?.trim() ?? '';
  return current === '' ? text : `${current}. ${text}`;
}

export function applySourceLineMachineNotes<T extends SourceDraft>(draft: T, source: string): T {
  const lines = source.split(/\r?\n/);
  const issues = draft.issues.map((issue) => ({ ...issue }));
  const days = draft.days.map((day, dayIndex) => ({
    ...day,
    exercises: day.exercises.map((exercise, exerciseIndex) => {
      const name = exercise.sourceName.trim();
      if (name.length < 3) {
        return exercise;
      }
      const needle = name.toLowerCase();
      const matches = lines.filter((line) => line.toLowerCase().includes(needle));
      if (matches.length !== 1) {
        return exercise;
      }
      const line = matches[0] ?? '';
      const at = machineIndex(line);
      if (at == null) {
        return exercise;
      }
      const notes = appendMachineClause(exercise.notes.value, line.slice(at).trim());
      const path = `days[${dayIndex}].exercises[${exerciseIndex}].notes`;
      if (notes != null && notes.length > NOTE_EDIT_MAX && !issues.some((issue) => issue.path === path && issue.code === 'note_too_long')) {
        issues.push({ path, code: 'note_too_long', message: NOTE_TOO_LONG_ISSUE_MESSAGE });
      }
      return {
        ...exercise,
        notes: { ...exercise.notes, value: notes },
      };
    }),
  }));
  return { ...draft, days, issues };
}

export function noteExceedsEditLimit(notes: string | null | undefined): boolean {
  return typeof notes === 'string' && notes.length > NOTE_EDIT_MAX;
}

function unitLoads(value: string): Array<{ value: number; unit: PlannedWeightUnit }> {
  const pattern = /(\d+(?:\.\d+)?)\s*(lb|lbs|kg|kgs)|(lb|lbs|kg|kgs)\s*(\d+(?:\.\d+)?)/gi;
  const loads: Array<{ value: number; unit: PlannedWeightUnit }> = [];
  for (const match of value.matchAll(pattern)) {
    const numberText = match[1] ?? match[4];
    const unitText = (match[2] ?? match[3] ?? '').toLowerCase();
    if (!numberText) {
      continue;
    }
    const parsed = Number(numberText);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    const unit: PlannedWeightUnit | null = unitText === 'lb' || unitText === 'lbs' ? 'lb' : unitText === 'kg' || unitText === 'kgs' ? 'kg' : null;
    if (unit) {
      loads.push({ value: parsed, unit });
    }
  }
  return loads;
}

function machineIndex(value: string): number | null {
  const match = MACHINE_WORD.exec(value);
  MACHINE_WORD.lastIndex = 0;
  return match?.index ?? null;
}
