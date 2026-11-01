import {
  MAX_DAYS,
  MAX_EXERCISES,
  MAX_EXERCISES_PER_DAY,
  NOTE_EDIT_MAX,
  REPS_MAX,
  REPS_MIN,
  REST_MAX,
  REST_MIN,
  SETS_MAX,
  SETS_MIN,
  SOURCE_NAME_MAX,
  TEXT_FIELD_MAX,
  WARNING_MAX_CHARS,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_TEXT_MAX,
} from './limits.ts';

export type Origin = 'extracted' | 'missing';

export type IntField = {
  origin: Origin;
  value: number | null;
  suggestion: number | null;
};

export type WeightField = {
  origin: Origin;
  value: number | null;
  suggestion: null;
};

export type TextField = {
  origin: Origin;
  value: string | null;
};

export type ImportIssueCode =
  | 'weight_dropped'
  | 'rep_pair_split'
  | 'note_too_long'
  | 'empty_name'
  | 'empty_program_name';

export type ImportIssue = {
  path: string;
  code: ImportIssueCode;
  message: string;
};

export type ImportExerciseDraft = {
  sourceName: string;
  sets: IntField;
  repsMin: IntField;
  repsMax: IntField;
  restSeconds: IntField;
  weight: WeightField;
  notes: TextField;
};

export type ImportDayDraft = {
  name: TextField;
  subtitle: TextField;
  exercises: ImportExerciseDraft[];
};

export type ImportDraft = {
  programName: TextField;
  days: ImportDayDraft[];
  warnings: string[];
  issues: ImportIssue[];
};

export type ImportSchemaCheck = { ok: true } | { ok: false; reason: string };

export type ImportValidationResult =
  | { ok: true; data: ImportDraft }
  | { ok: false; code: 'over_capacity' | 'parse_empty' };

const ISSUE_MESSAGES: Record<ImportIssueCode, string> = {
  weight_dropped: 'Weight was not kept because it was not a number from 0 through 2000.',
  rep_pair_split: 'Rep min and max were not both taken from the source, so both were cleared.',
  note_too_long: 'Shorten this note to 280 characters or fewer before saving.',
  empty_name: 'A name from the source is empty.',
  empty_program_name: 'The program name is empty.',
};

type SchemaFailure = { ok: false; reason: string };

type ModelInt = {
  origin: Origin;
  value: number | null;
  suggestion: number | null;
};

type ModelText = {
  origin: Origin;
  value: string | null;
};

type ModelWeight = {
  origin: Origin;
  value: number | string | null;
  suggestion: unknown;
};

type ModelExercise = {
  sourceName: string;
  sets: ModelInt;
  repsMin: ModelInt;
  repsMax: ModelInt;
  restSeconds: ModelInt;
  weight: ModelWeight;
  notes: ModelText;
};

type ModelDay = {
  name: ModelText;
  subtitle: ModelText;
  exercises: ModelExercise[];
};

type ModelOutput = {
  programName: ModelText;
  days: ModelDay[];
  warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(reason: string): SchemaFailure {
  return { ok: false, reason };
}

function expectKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): SchemaFailure | null {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return failure(`${label} has unexpected key ${key}`);
    }
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return failure(`${label} is missing ${key}`);
    }
  }
  return null;
}

function isOrigin(value: unknown): value is Origin {
  return value === 'extracted' || value === 'missing';
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function checkTextField(value: unknown, label: string): SchemaFailure | null {
  if (!isRecord(value)) {
    return failure(`${label} must be an object`);
  }
  const keys = expectKeys(value, ['origin', 'value'], label);
  if (keys) {
    return keys;
  }
  if (!isOrigin(value.origin)) {
    return failure(`${label}.origin is invalid`);
  }
  if (value.value === null) {
    return null;
  }
  if (typeof value.value !== 'string' || value.value.length > TEXT_FIELD_MAX) {
    return failure(`${label}.value is invalid`);
  }
  return null;
}

function checkIntField(value: unknown, label: string, min: number, max: number): SchemaFailure | null {
  if (!isRecord(value)) {
    return failure(`${label} must be an object`);
  }
  const keys = expectKeys(value, ['origin', 'value', 'suggestion'], label);
  if (keys) {
    return keys;
  }
  if (!isOrigin(value.origin)) {
    return failure(`${label}.origin is invalid`);
  }
  const suggestionOk =
    value.origin === 'extracted'
      ? value.suggestion === null
      : value.suggestion === null || isIntegerInRange(value.suggestion, min, max);
  if (!suggestionOk) {
    return failure(`${label}.suggestion is invalid`);
  }
  if (value.value === null || isIntegerInRange(value.value, min, max)) {
    if (value.origin === 'extracted' && !isIntegerInRange(value.value, min, max)) {
      return failure(`${label}.value is invalid`);
    }
    return null;
  }
  return failure(`${label}.value is invalid`);
}

function checkWeightField(value: unknown, label: string): SchemaFailure | null {
  if (!isRecord(value)) {
    return failure(`${label} must be an object`);
  }
  const keys = expectKeys(value, ['origin', 'value', 'suggestion'], label);
  if (keys) {
    return keys;
  }
  if (!isOrigin(value.origin)) {
    return failure(`${label}.origin is invalid`);
  }
  if (value.value === null || typeof value.value === 'number') {
    return null;
  }
  if (typeof value.value === 'string' && value.value.length <= WEIGHT_TEXT_MAX) {
    return null;
  }
  return failure(`${label}.value is invalid`);
}

function checkExercise(value: unknown, label: string): SchemaFailure | null {
  if (!isRecord(value)) {
    return failure(`${label} must be an object`);
  }
  const keys = expectKeys(
    value,
    ['sourceName', 'sets', 'repsMin', 'repsMax', 'restSeconds', 'weight', 'notes'],
    label,
  );
  if (keys) {
    return keys;
  }
  if (typeof value.sourceName !== 'string' || value.sourceName.length > SOURCE_NAME_MAX) {
    return failure(`${label}.sourceName is invalid`);
  }
  return (
    checkIntField(value.sets, `${label}.sets`, SETS_MIN, SETS_MAX) ??
    checkIntField(value.repsMin, `${label}.repsMin`, REPS_MIN, REPS_MAX) ??
    checkIntField(value.repsMax, `${label}.repsMax`, REPS_MIN, REPS_MAX) ??
    checkIntField(value.restSeconds, `${label}.restSeconds`, REST_MIN, REST_MAX) ??
    checkWeightField(value.weight, `${label}.weight`) ??
    checkTextField(value.notes, `${label}.notes`)
  );
}

function checkDay(value: unknown, label: string): SchemaFailure | null {
  if (!isRecord(value)) {
    return failure(`${label} must be an object`);
  }
  const keys = expectKeys(value, ['name', 'subtitle', 'exercises'], label);
  if (keys) {
    return keys;
  }
  const name = checkTextField(value.name, `${label}.name`);
  if (name) {
    return name;
  }
  const subtitle = checkTextField(value.subtitle, `${label}.subtitle`);
  if (subtitle) {
    return subtitle;
  }
  if (!Array.isArray(value.exercises)) {
    return failure(`${label}.exercises must be an array`);
  }
  for (let index = 0; index < value.exercises.length; index += 1) {
    const exercise = checkExercise(value.exercises[index], `${label}.exercises[${index}]`);
    if (exercise) {
      return exercise;
    }
  }
  return null;
}

function checkRoot(value: unknown): SchemaFailure | null {
  if (!isRecord(value)) {
    return failure('Draft must be an object');
  }
  const keys = expectKeys(value, ['programName', 'days', 'warnings'], 'Draft');
  if (keys) {
    return keys;
  }
  const programName = checkTextField(value.programName, 'programName');
  if (programName) {
    return programName;
  }
  if (!Array.isArray(value.days)) {
    return failure('days must be an array');
  }
  for (let index = 0; index < value.days.length; index += 1) {
    const day = checkDay(value.days[index], `days[${index}]`);
    if (day) {
      return day;
    }
  }
  if (!Array.isArray(value.warnings)) {
    return failure('warnings must be an array');
  }
  for (let index = 0; index < value.warnings.length; index += 1) {
    const warning = value.warnings[index];
    if (typeof warning !== 'string' || warning.length > WARNING_MAX_CHARS) {
      return failure(`warnings[${index}] is invalid`);
    }
  }
  return null;
}

export function checkImportSchema(input: unknown): ImportSchemaCheck {
  // Day and exercise maxItems, the rep anyOf, a non-null weight suggestion, and a
  // non-null value on origin "missing" stay out of this check. The validator repairs them.
  return checkRoot(input) ?? { ok: true };
}

function issue(path: string, code: ImportIssueCode): ImportIssue {
  return { path, code, message: ISSUE_MESSAGES[code] };
}

function isBlank(value: string | null): boolean {
  return value == null || value.trim() === '';
}

function repairText(value: unknown, label: string): TextField {
  if (!isRecord(value) || !isOrigin(value.origin)) {
    throw new Error(`${label} was not accepted by checkImportSchema`);
  }
  if (value.origin === 'missing') {
    return { origin: 'missing', value: null };
  }
  return { origin: 'extracted', value: typeof value.value === 'string' ? value.value : null };
}

function keptInteger(value: unknown, min: number, max: number): number | null {
  return isIntegerInRange(value, min, max) ? value : null;
}

function repairInt(value: unknown, label: string, min: number, max: number): IntField {
  if (!isRecord(value) || !isOrigin(value.origin)) {
    throw new Error(`${label} was not accepted by checkImportSchema`);
  }
  if (value.origin === 'missing') {
    return {
      origin: 'missing',
      value: null,
      suggestion: keptInteger(value.suggestion, min, max),
    };
  }
  const extracted = keptInteger(value.value, min, max);
  if (extracted == null) {
    throw new Error(`${label} was not accepted by checkImportSchema`);
  }
  return { origin: 'extracted', value: extracted, suggestion: null };
}

function numericWeight(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < WEIGHT_MIN || value > WEIGHT_MAX) {
      return null;
    }
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < WEIGHT_MIN || parsed > WEIGHT_MAX) {
    return null;
  }
  return parsed;
}

function repairWeight(value: unknown, path: string, issues: ImportIssue[]): WeightField {
  if (!isRecord(value) || !isOrigin(value.origin)) {
    throw new Error(`${path} was not accepted by checkImportSchema`);
  }
  const kept = value.value == null ? null : numericWeight(value.value);
  const dropped = value.value != null && kept == null;
  if (dropped) {
    issues.push(issue(path, 'weight_dropped'));
  }
  if (value.origin === 'missing' || kept == null) {
    return { origin: 'missing', value: null, suggestion: null };
  }
  return { origin: 'extracted', value: kept, suggestion: null };
}

function repairExercise(value: unknown, path: string, issues: ImportIssue[]): ImportExerciseDraft {
  if (!isRecord(value) || typeof value.sourceName !== 'string') {
    throw new Error(`${path} was not accepted by checkImportSchema`);
  }
  if (value.sourceName.trim() === '') {
    issues.push(issue(`${path}.sourceName`, 'empty_name'));
  }

  const repsMinRecord = isRecord(value.repsMin) ? value.repsMin : null;
  const repsMaxRecord = isRecord(value.repsMax) ? value.repsMax : null;
  if (!repsMinRecord || !repsMaxRecord) {
    throw new Error(`${path} reps were not accepted by checkImportSchema`);
  }
  let repsMin: IntField;
  let repsMax: IntField;
  if (repsMinRecord.origin !== repsMaxRecord.origin) {
    issues.push(issue(`${path}.repsMin`, 'rep_pair_split'));
    repsMin = { origin: 'missing', value: null, suggestion: null };
    repsMax = { origin: 'missing', value: null, suggestion: null };
  } else {
    repsMin = repairInt(value.repsMin, `${path}.repsMin`, REPS_MIN, REPS_MAX);
    repsMax = repairInt(value.repsMax, `${path}.repsMax`, REPS_MIN, REPS_MAX);
  }

  const notes = repairText(value.notes, `${path}.notes`);
  if (notes.value != null && notes.value.length > NOTE_EDIT_MAX) {
    issues.push(issue(`${path}.notes`, 'note_too_long'));
  }

  return {
    sourceName: value.sourceName,
    sets: repairInt(value.sets, `${path}.sets`, SETS_MIN, SETS_MAX),
    repsMin,
    repsMax,
    restSeconds: repairInt(value.restSeconds, `${path}.restSeconds`, REST_MIN, REST_MAX),
    weight: repairWeight(value.weight, `${path}.weight`, issues),
    notes,
  };
}

function assertModel(input: unknown): ModelOutput {
  if (!isRecord(input) || !Array.isArray(input.days) || !Array.isArray(input.warnings)) {
    throw new Error('validateImportModelOutput received a draft that failed checkImportSchema');
  }
  return input as ModelOutput;
}

export function validateImportModelOutput(input: unknown): ImportValidationResult {
  const schema = checkImportSchema(input);
  if (!schema.ok) {
    throw new Error(
      `validateImportModelOutput received a draft that failed checkImportSchema: ${schema.reason}`,
    );
  }

  const model = assertModel(input);
  if (model.days.length === 0) {
    return { ok: false, code: 'parse_empty' };
  }

  let total = 0;
  for (const day of model.days) {
    if (!isRecord(day) || !Array.isArray(day.exercises)) {
      throw new Error('validateImportModelOutput received a draft that failed checkImportSchema');
    }
    if (day.exercises.length > MAX_EXERCISES_PER_DAY) {
      return { ok: false, code: 'over_capacity' };
    }
    total += day.exercises.length;
  }
  if (model.days.length > MAX_DAYS || total > MAX_EXERCISES) {
    return { ok: false, code: 'over_capacity' };
  }

  const issues: ImportIssue[] = [];
  const programName = repairText(model.programName, 'programName');
  if (isBlank(programName.value)) {
    issues.push(issue('programName', 'empty_program_name'));
  }

  const days = model.days.map((day, dayIndex) => {
    const name = repairText(day.name, `days[${dayIndex}].name`);
    if (isBlank(name.value)) {
      issues.push(issue(`days[${dayIndex}].name`, 'empty_name'));
    }
    const exercises = day.exercises.map((exercise, exerciseIndex) =>
      repairExercise(exercise, `days[${dayIndex}].exercises[${exerciseIndex}]`, issues),
    );
    return {
      name,
      subtitle: repairText(day.subtitle, `days[${dayIndex}].subtitle`),
      exercises,
    };
  });

  return {
    ok: true,
    data: {
      programName,
      days,
      warnings: [...model.warnings],
      issues,
    },
  };
}
