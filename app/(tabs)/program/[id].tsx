import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { Link, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { saveEquipmentTargetRow } from '@/lib/import/equipment-target-save';
import {
  formatEquipmentTargetList,
  parseEquipmentWeightText,
  replaceEquipmentWeight,
  sanitizeEquipmentTargets,
  type EquipmentTarget,
} from '@/lib/import/equipment-targets';
import { PERSIST_PLANNED_WEIGHT } from '@/lib/import/flags';
import { EDIT_DAY_LABEL } from '@/lib/import/manual-program';
import { formatPlannedWeightSentence } from '@/lib/import/planned-weight';
import { isActiveProgramDay } from '@/lib/load-mode';
import { isMissingColumnError } from '@/lib/postgrest';
import { ARCHIVED_DAY_MESSAGE, loadActiveProgram } from '@/lib/programs';
import { supabase } from '@/lib/supabase';
import { buttonPaletteForSurface } from '@/lib/ui/button-contrast';

const palette = Colors.dark;
const primaryButton = buttonPaletteForSurface('dark');

type ProgramDay = {
  id: string;
  name: string;
  subtitle: string;
};

type Exercise = {
  id: string;
  name: string;
  category: string;
  exercise_type: string;
};

type ProgramExerciseRow = {
  id: string;
  exercise_order: number;
  target_sets: number | null;
  min_reps: number | null;
  max_reps: number | null;
  notes: string | null;
  planned_weight?: number | string | null;
  planned_weight_unit?: string | null;
  equipment_targets?: unknown;
  exercise: Exercise | Exercise[] | null;
};

type ProgramExercise = {
  id: string;
  exercise_order: number;
  target_sets: number | null;
  min_reps: number | null;
  max_reps: number | null;
  notes: string | null;
  planned_weight?: number | string | null;
  planned_weight_unit?: string | null;
  equipment_targets?: EquipmentTarget[] | null;
  exercise: Exercise | null;
};

const EXERCISE_COLUMNS = `
            id,
            exercise_order,
            target_sets,
            min_reps,
            max_reps,
            notes,
`;

const EXERCISE_EMBED = `
            exercise:exercises (
              id,
              name,
              category,
              exercise_type
            )
`;

function exerciseSelect(includePlan: boolean): string {
  return includePlan
    ? `${EXERCISE_COLUMNS} planned_weight, planned_weight_unit, equipment_targets, ${EXERCISE_EMBED}`
    : `${EXERCISE_COLUMNS} ${EXERCISE_EMBED}`;
}

function plannedUnit(value: string | null | undefined): 'lb' | 'kg' | null {
  return value === 'lb' || value === 'kg' ? value : null;
}

function loadProgramExercises(programDayId: string) {
  const plannedSelect = exerciseSelect(true);
  const selected = supabase
    .from('program_exercises')
    .select(PERSIST_PLANNED_WEIGHT ? plannedSelect : exerciseSelect(false))
    .eq('program_day_id', programDayId)
    .order('exercise_order', { ascending: true });
  return selected.then(async (result) => {
    if (!PERSIST_PLANNED_WEIGHT || !result.error) {
      return result;
    }
    const missingTargetsOnly =
      isMissingColumnError(result.error, 'equipment_targets') &&
      !isMissingColumnError(result.error, 'planned_weight');
    const plannedOnly = missingTargetsOnly
      ? await supabase
          .from('program_exercises')
          .select(plannedSelect.replace('equipment_targets,', ''))
          .eq('program_day_id', programDayId)
          .order('exercise_order', { ascending: true })
      : result;
    if (
      plannedOnly.error &&
      (isMissingColumnError(plannedOnly.error, 'planned_weight') ||
        isMissingColumnError(plannedOnly.error, 'planned_weight_unit') ||
        isMissingColumnError(plannedOnly.error, 'equipment_targets'))
    ) {
      return supabase
        .from('program_exercises')
        .select(exerciseSelect(false))
        .eq('program_day_id', programDayId)
        .order('exercise_order', { ascending: true });
    }
    return plannedOnly;
  });
}

function unwrapExercise(value: Exercise | Exercise[] | null): Exercise | null {
  if (!value) {
    return null;
  }

  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default function ProgramDayScreen() {
  const { id } = useLocalSearchParams<{ id: string | string[] }>();
  const programDayId = Array.isArray(id) ? id[0] : id;

  const [programDay, setProgramDay] = useState<ProgramDay | null>(null);
  const [exercises, setExercises] = useState<ProgramExercise[]>([]);
  const [targetDrafts, setTargetDrafts] = useState<Record<string, string>>({});
  const [targetNotes, setTargetNotes] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
    if (!programDayId) {
      setIsLoading(false);
      setErrorMessage('Missing program day.');
      return;
    }

    let isMounted = true;

    async function loadProgramDay() {
      const programResult = await loadActiveProgram();

      if (!isMounted) {
        return;
      }

      if (!programResult.ok) {
        setErrorMessage(programResult.error);
        setProgramDay(null);
        setExercises([]);
        setIsLoading(false);
        return;
      }

      const dayWithArchive = await supabase
        .from('program_days')
        .select('id, name, subtitle, archived_at')
        .eq('id', programDayId)
        .eq('program_id', programResult.data)
        .maybeSingle();
      const dayQuery =
        dayWithArchive.error && isMissingColumnError(dayWithArchive.error, 'archived_at')
          ? supabase
              .from('program_days')
              .select('id, name, subtitle')
              .eq('id', programDayId)
              .eq('program_id', programResult.data)
              .maybeSingle()
          : Promise.resolve(dayWithArchive);
      const [dayResult, exercisesResult] = await Promise.all([
        dayQuery,
        loadProgramExercises(programDayId),
      ]);

      if (!isMounted) {
        return;
      }

      if (dayResult.error) {
        console.error('[ProgramDays] query error', {
          code: dayResult.error.code,
          message: dayResult.error.message,
          details: dayResult.error.details,
          hint: dayResult.error.hint,
        });
        setErrorMessage(
          [dayResult.error.code, dayResult.error.message, dayResult.error.details, dayResult.error.hint]
            .filter(Boolean)
            .join(' | '),
        );
        setProgramDay(null);
        setExercises([]);
        setIsLoading(false);
        return;
      }

      if (exercisesResult.error) {
        console.error('[ProgramExercises] query error', {
          code: exercisesResult.error.code,
          message: exercisesResult.error.message,
          details: exercisesResult.error.details,
          hint: exercisesResult.error.hint,
        });
        setErrorMessage(
          [
            exercisesResult.error.code,
            exercisesResult.error.message,
            exercisesResult.error.details,
            exercisesResult.error.hint,
          ]
            .filter(Boolean)
            .join(' | '),
        );
        setProgramDay(dayResult.data);
        setExercises([]);
        setIsLoading(false);
        return;
      }

      const archivedAt = (dayResult.data as { archived_at?: string | null } | null)?.archived_at;
      if (dayResult.data && !isActiveProgramDay(archivedAt)) {
        setErrorMessage(ARCHIVED_DAY_MESSAGE);
        setProgramDay(null);
        setExercises([]);
        setIsLoading(false);
        return;
      }

      const rows = (exercisesResult.data ?? []) as unknown as ProgramExerciseRow[];

      setErrorMessage(null);
      setProgramDay(dayResult.data);
      setExercises(
        rows.map((row) => ({
          ...row,
          exercise: unwrapExercise(row.exercise),
          equipment_targets: sanitizeEquipmentTargets(row.equipment_targets),
        })),
      );
      setIsLoading(false);
    }

    void loadProgramDay();

    return () => {
      isMounted = false;
    };
  }, [programDayId]));

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: programDay?.name ?? 'Workout Day',
          headerBackTitle: 'Program',
        }}
      />

      <Text style={styles.title}>{programDay?.name ?? 'Workout Day'}</Text>
      <Text style={styles.subtitle}>
        {isLoading
          ? 'Loading workout day...'
          : errorMessage
            ? 'Could not load workout day'
            : programDay?.subtitle}
      </Text>

      {!isLoading && !errorMessage && programDay ? (
        <Link
          href={{ pathname: '/program/build', params: { dayId: programDay.id } }}
          asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${EDIT_DAY_LABEL}. ${programDay.name}`}
            android_ripple={{ color: 'rgba(17, 17, 17, 0.18)' }}
            style={styles.editButton}>
            {({ pressed }) => (
              <Text style={[styles.editLabel, pressed && styles.pressed]}>{EDIT_DAY_LABEL}</Text>
            )}
          </Pressable>
        </Link>
      ) : null}

      {isLoading ? (
        <Text style={styles.status}>Loading exercises...</Text>
      ) : errorMessage ? (
        <Text style={styles.error}>
          Could not load this workout day. {errorMessage}
        </Text>
      ) : (
        exercises.map((item) => {
          const notes = item.notes?.trim();

          return (
            <Card key={item.id} style={styles.exerciseCard}>
              <Text style={styles.exerciseName}>
                {item.exercise?.name ?? 'Unknown exercise'}
              </Text>
              {item.exercise?.category ? (
                <Text style={styles.exerciseCategory}>{item.exercise.category}</Text>
              ) : null}
              <Text style={styles.exerciseDetail}>
                {item.target_sets == null ? 'Sets not set' : `${item.target_sets} sets`}
                {' · '}
                {item.min_reps == null || item.max_reps == null
                  ? 'Reps not set'
                  : `${item.min_reps}–${item.max_reps} reps`}
              </Text>
              {item.planned_weight != null ? (
                <Text style={styles.exerciseDetail}>
                  {formatPlannedWeightSentence(Number(item.planned_weight), plannedUnit(item.planned_weight_unit))}
                </Text>
              ) : null}
              {notes ? <Text style={styles.exerciseNotes}>{notes}</Text> : null}
              {PERSIST_PLANNED_WEIGHT ? (
                <>
                  <Text style={styles.exerciseDetail}>
                    Future planned weight. {formatEquipmentTargetList(item.equipment_targets) || 'No equipment targets yet.'}
                  </Text>
                  <TextInput
                    accessibilityLabel={`Future planned weights for ${item.exercise?.name ?? 'exercise'}`}
                    onChangeText={(value) =>
                      setTargetDrafts((current) => ({ ...current, [item.id]: value }))
                    }
                    placeholder="155 (80 machine)"
                    placeholderTextColor={palette.muted}
                    style={styles.targetInput}
                    value={targetDrafts[item.id] ?? ''}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Save future weights for ${item.exercise?.name ?? 'exercise'}`}
                    onPress={() => {
                      void (async () => {
                        const parsed = parseEquipmentWeightText(targetDrafts[item.id] ?? '');
                        if (!parsed.ok || !parsed.targets) {
                          setTargetNotes((current) => ({
                            ...current,
                            [item.id]: parsed.ok
                              ? 'Name the equipment, such as 155 (80 machine). Today\'s logged sets were not changed.'
                              : parsed.error,
                          }));
                          return;
                        }
                        let targets = item.equipment_targets ?? [];
                        for (const target of parsed.targets) {
                          if (target.weight == null) {
                            continue;
                          }
                          targets = replaceEquipmentWeight(targets, target.equipment, target.weight, target.unit);
                        }
                        const saved = await saveEquipmentTargetRow(item.id, targets);
                        setTargetNotes((current) => ({
                          ...current,
                          [item.id]: saved.ok
                            ? 'Future planned weights were saved. Today\'s logged sets were not changed.'
                            : saved.error,
                        }));
                      })();
                    }}
                    style={styles.editButton}>
                    <Text style={styles.editLabel}>Save future weights</Text>
                  </Pressable>
                  {targetNotes[item.id] ? <Text style={styles.exerciseNotes}>{targetNotes[item.id]}</Text> : null}
                </>
              ) : null}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: palette.text,
    fontSize: 32,
    fontWeight: '800',
  },
  subtitle: {
    color: palette.muted,
    fontSize: 16,
    marginBottom: 4,
  },
  status: {
    color: palette.muted,
    fontSize: 16,
  },
  error: {
    color: palette.text,
    fontSize: 16,
  },
  editButton: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: primaryButton.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  editLabel: {
    color: primaryButton.label,
    fontSize: 16,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
  exerciseCard: {
    minHeight: 72,
    justifyContent: 'center',
    gap: 4,
  },
  exerciseName: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  exerciseCategory: {
    color: palette.muted,
    fontSize: 16,
  },
  exerciseDetail: {
    color: palette.muted,
    fontSize: 16,
  },
  exerciseNotes: {
    color: palette.muted,
    fontSize: 16,
  },
  targetInput: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
  },
});
