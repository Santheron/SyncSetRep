import {
  equipmentKindFromName,
  equipmentKindFromType,
  exerciseBaseName,
  type EquipmentKind,
} from './import/equipment-targets.ts';
import {
  suggestLinkedEquipmentProgress,
  type LinkedHistorySession,
  type LinkedSuggestion,
} from './equipment-progression.ts';
import type { FinishedSetHistory, WorkoutExercise } from './workout-session.ts';

// Reads completed sets for linked exercise names. A failed read returns no suggestion.

export type EquipmentSuggestionRequest = {
  slotId: string;
  name: string;
  equipmentType: string | null;
  targetSets: number;
  category: string | null;
  exerciseType: string | null;
  weightIncrement: number | null;
};

export async function loadEquipmentSuggestions(
  requests: readonly EquipmentSuggestionRequest[],
  excludeSessionId?: string,
  io?: {
    listExercises?: () => Promise<{ ok: true; data: WorkoutExercise[] } | { ok: false; error: string }>;
    loadSets?: (
      exerciseIds: string[],
    ) => Promise<{ ok: true; data: FinishedSetHistory[] } | { ok: false; error: string }>;
  },
): Promise<Record<string, LinkedSuggestion>> {
  if (requests.length === 0) {
    return {};
  }
  const listExercises = io?.listExercises ?? (async () => {
    const { listExercisesForPicker } = await import('./workout-session.ts');
    return listExercisesForPicker();
  });
  const loadSets = io?.loadSets ?? (async (ids: string[]) => {
    const { fetchFinishedSetsForExercises } = await import('./workout-session.ts');
    return fetchFinishedSetsForExercises(ids, excludeSessionId);
  });
  let catalog: WorkoutExercise[];
  try {
    const listed = await listExercises();
    if (!listed.ok) {
      return {};
    }
    catalog = listed.data;
  } catch {
    return {};
  }

  const idsByBase = new Map<string, Map<string, EquipmentKind>>();
  for (const request of requests) {
    const base = exerciseBaseName(request.name).toLowerCase();
    const ids = idsByBase.get(base) ?? new Map<string, EquipmentKind>();
    for (const exercise of catalog) {
      if (exerciseBaseName(exercise.name).toLowerCase() !== base) {
        continue;
      }
      const equipment = equipmentKindFromName(exercise.name) ?? equipmentKindFromType(exercise.equipmentType);
      if (!equipment) {
        continue;
      }
      ids.set(exercise.id, equipment);
    }
    idsByBase.set(base, ids);
  }
  const allIds = [...new Set([...idsByBase.values()].flatMap((ids) => [...ids.keys()]))];
  if (allIds.length === 0) {
    return {};
  }

  let sets: FinishedSetHistory[];
  try {
    const loaded = await loadSets(allIds);
    if (!loaded.ok) {
      return {};
    }
    sets = loaded.data;
  } catch {
    return {};
  }

  const historyByBase = new Map<string, LinkedHistorySession[]>();
  for (const [base, ids] of idsByBase) {
    const sessionsByEquipment = new Map<string, Map<string, LinkedHistorySession>>();
    for (const set of sets) {
      const equipment = ids.get(set.exerciseId);
      if (!equipment) {
        continue;
      }
      const bySession = sessionsByEquipment.get(equipment) ?? new Map<string, LinkedHistorySession>();
      const session = bySession.get(set.sessionId) ?? {
        equipment,
        finishedAt: set.finishedAt,
        sets: [],
      };
      session.sets = [
        ...session.sets,
        {
          setNumber: set.setNumber,
          weight: set.weight,
          reps: set.reps,
          isCompleted: set.isCompleted,
        },
      ];
      bySession.set(set.sessionId, session);
      sessionsByEquipment.set(equipment, bySession);
    }
    historyByBase.set(
      base,
      [...sessionsByEquipment.values()].flatMap((sessions) => [...sessions.values()]),
    );
  }

  const suggestions: Record<string, LinkedSuggestion> = {};
  for (const request of requests) {
    const selected =
      equipmentKindFromName(request.name) ?? equipmentKindFromType(request.equipmentType) ?? 'barbell';
    const suggestion = suggestLinkedEquipmentProgress({
      exerciseName: request.name,
      selectedEquipment: selected,
      targetSets: request.targetSets,
      category: request.category,
      exerciseType: request.exerciseType,
      incrementLb: request.weightIncrement,
      history: historyByBase.get(exerciseBaseName(request.name).toLowerCase()) ?? [],
    });
    if (suggestion.suggestedWeight != null || suggestion.reason !== '') {
      suggestions[request.slotId] = suggestion;
    }
  }
  return suggestions;
}
