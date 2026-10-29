import { AUTO_EXERCISE_ALIASES, SUGGEST_EXERCISE_ALIASES } from './exercise-aliases.ts';
import { normExerciseName } from './normalize-exercise-name.ts';

export type ImportEquipmentFamily =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'bodyweight'
  | 'cable'
  | 'kettlebell';

export type ImportCatalogExercise = {
  id: number | string;
  name: string;
  equipment_type?: string | null;
};

export type ImportMatch = {
  status: 'matched' | 'ambiguous' | 'unmatched';
  selectedId: string | null;
  candidateIds: string[];
  method: 'exact' | 'alias' | 'subset' | 'alias-suggestion' | 'none';
};

const FAMILY_BY_TOKEN: Readonly<Record<string, ImportEquipmentFamily>> = {
  barbell: 'barbell',
  bb: 'barbell',
  olympic: 'barbell',
  dumbbell: 'dumbbell',
  db: 'dumbbell',
  machine: 'machine',
  smith: 'machine',
  selector: 'machine',
  selectorized: 'machine',
  paramount: 'machine',
  bodyweight: 'bodyweight',
  bw: 'bodyweight',
  assisted: 'bodyweight',
  cable: 'cable',
  kettlebell: 'kettlebell',
  kb: 'kettlebell',
};

type TokenSets = {
  families: Set<ImportEquipmentFamily>;
  content: Set<string>;
};

type PreparedRow = {
  id: string;
  nameKey: string;
  families: Set<ImportEquipmentFamily>;
  content: Set<string>;
};

function unmatched(): ImportMatch {
  return { status: 'unmatched', selectedId: null, candidateIds: [], method: 'none' };
}

function analyze(normalized: string): TokenSets {
  const families = new Set<ImportEquipmentFamily>();
  const content = new Set<string>();
  if (!normalized) {
    return { families, content };
  }

  const tokens = normalized.split(' ');
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (!token) {
      continue;
    }
    if (token === 'body' && tokens[index + 1] === 'weight') {
      families.add('bodyweight');
      index += 1;
      continue;
    }
    const family = FAMILY_BY_TOKEN[token];
    if (family) {
      families.add(family);
      continue;
    }
    content.add(token);
  }

  return { families, content };
}

function setsEqual(left: Set<ImportEquipmentFamily>, right: Set<ImportEquipmentFamily>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const family of left) {
    if (!right.has(family)) {
      return false;
    }
  }
  return true;
}

function intersects(left: Set<ImportEquipmentFamily>, right: Set<ImportEquipmentFamily>): boolean {
  for (const family of left) {
    if (right.has(family)) {
      return true;
    }
  }
  return false;
}

function compatible(row: PreparedRow, sourceFamilies: Set<ImportEquipmentFamily>): boolean {
  if (sourceFamilies.size !== 1 || row.families.size !== 1) {
    return false;
  }
  return setsEqual(row.families, sourceFamilies);
}

function contentSubset(source: Set<string>, row: Set<string>): boolean {
  if (source.size === 0 || row.size === 0) {
    return false;
  }
  for (const token of source) {
    if (!row.has(token)) {
      return false;
    }
  }
  return true;
}

function idsOf(rows: readonly PreparedRow[]): string[] {
  return rows.map((row) => row.id);
}

function oneMatch(rows: readonly PreparedRow[], method: ImportMatch['method']): ImportMatch | null {
  if (rows.length === 1) {
    const id = rows[0]?.id ?? null;
    return { status: 'matched', selectedId: id, candidateIds: idsOf(rows), method };
  }
  if (rows.length > 1) {
    return { status: 'ambiguous', selectedId: null, candidateIds: idsOf(rows), method };
  }
  return null;
}

function prepare(catalog: readonly ImportCatalogExercise[]): PreparedRow[] {
  return catalog.map((row) => {
    const nameKey = normExerciseName(typeof row.name === 'string' ? row.name : '');
    const name = analyze(nameKey);
    const equipment = analyze(
      normExerciseName(typeof row.equipment_type === 'string' ? row.equipment_type : ''),
    );
    const families = new Set<ImportEquipmentFamily>([...name.families, ...equipment.families]);
    return {
      id: String(row.id),
      nameKey,
      families,
      content: name.content,
    };
  });
}

function filterFamily(
  rows: readonly PreparedRow[],
  sourceFamilies: Set<ImportEquipmentFamily>,
): PreparedRow[] {
  if (sourceFamilies.size !== 1) {
    return [...rows];
  }
  return rows.filter((row) => compatible(row, sourceFamilies));
}

export function matchImportedExercises(
  catalog: readonly ImportCatalogExercise[],
  sourceName: string,
): ImportMatch {
  const prepared = prepare(catalog);
  const sourceKey = normExerciseName(sourceName);
  if (!sourceKey) {
    return unmatched();
  }

  const source = analyze(sourceKey);
  if (source.families.size >= 2) {
    const hits = prepared.filter((row) => intersects(row.families, source.families));
    if (hits.length === 0) {
      return unmatched();
    }
    return { status: 'ambiguous', selectedId: null, candidateIds: idsOf(hits), method: 'none' };
  }

  const exact = oneMatch(
    filterFamily(
      prepared.filter((row) => row.nameKey === sourceKey),
      source.families,
    ),
    'exact',
  );
  if (exact) {
    return exact;
  }

  const canonical = AUTO_EXERCISE_ALIASES[sourceKey];
  if (canonical) {
    const alias = oneMatch(
      filterFamily(
        prepared.filter((row) => row.nameKey === canonical),
        source.families,
      ),
      'alias',
    );
    if (alias) {
      return alias;
    }
  }

  const suggested = SUGGEST_EXERCISE_ALIASES[sourceKey];
  if (suggested) {
    const hits = prepared.filter((row) => row.nameKey === suggested);
    if (hits.length > 0) {
      return {
        status: 'ambiguous',
        selectedId: null,
        candidateIds: idsOf(hits),
        method: 'alias-suggestion',
      };
    }
  }

  if (source.content.size === 0) {
    return unmatched();
  }

  const subset = prepared.filter((row) => {
    if (!contentSubset(source.content, row.content)) {
      return false;
    }
    if (source.families.size === 1 && !compatible(row, source.families)) {
      return false;
    }
    return true;
  });
  if (subset.length === 0) {
    return unmatched();
  }
  if (subset.length > 1) {
    return { status: 'ambiguous', selectedId: null, candidateIds: idsOf(subset), method: 'subset' };
  }

  const row = subset[0];
  if (!row) {
    return unmatched();
  }
  if (source.families.size === 1 || row.families.size === 0) {
    return { status: 'matched', selectedId: row.id, candidateIds: [row.id], method: 'subset' };
  }
  return { status: 'ambiguous', selectedId: null, candidateIds: [row.id], method: 'subset' };
}
