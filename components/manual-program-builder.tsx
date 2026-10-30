import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Link } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { DAY_NAME_MAX, NOTE_EDIT_MAX, PROGRAM_NAME_MAX, TEXT_FIELD_MAX } from '@/lib/import/limits';
import {
  ADD_DAY_LABEL,
  ADD_EXERCISE_LABEL,
  CHOOSE_EXERCISE_LABEL,
  DAY_ADDED_LOCALLY_MESSAGE,
  EDIT_DRAFT_NOTICE,
  EDIT_SAVED_MESSAGE,
  FIRST_PROGRAM_NOTICE,
  LOCAL_DAY_NOTICE,
  MANUAL_SAVE_ONCE_MESSAGE,
  MANUAL_SAVED_CURRENT_MESSAGE,
  MANUAL_SAVED_INACTIVE_MESSAGE,
  PROGRAM_NAME_LABEL,
  SAVE_FIRST_ROUTINE_LABEL,
  SAVE_ROUTINE_LABEL,
  VIEW_SAVED_PROGRAMS_LABEL,
  mergeExerciseChoices,
  addExerciseLabel,
  applyManualEdit,
  applyManualNumber,
  chooseExerciseLabel,
  dayNameLabel,
  daySubtitleLabel,
  exerciseChoiceText,
  filterCatalog,
  moveDayLabel,
  moveExerciseLabel,
  notesLabel,
  removeDayLabel,
  removeExerciseLabel,
  repsMaxLabel,
  repsMinLabel,
  setsLabel,
  type CatalogExercise,
  type ManualEdit,
} from '@/lib/import/manual-program';
import {
  CUSTOM_EXERCISE_WRITES_ENABLED,
  EQUIPMENT_TYPES,
  MUSCLE_GROUPS,
  PLANNED_EXERCISES,
  normalizeExerciseName,
} from '@/lib/import/planned-exercises';
import { TRACKING_MODE_LABELS } from '@/lib/load-mode';
import type { ProgramReview } from '@/lib/import/review-editor';

const palette = Colors.dark;

type ManualProgramBuilderProps = {
  review: ProgramReview;
  catalog: readonly CatalogExercise[];
  hasActiveProgram: boolean;
  editing?: boolean;
  focusDayIndex?: number | null;
  isSaving: boolean;
  saveErrors: readonly string[];
  savedProgramId: string | null;
  onChange: (review: ProgramReview) => void;
  onSave: () => void;
  onSaveCustomExercise?: (name: string) => void;
};

function numberText(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

export function ManualProgramBuilder({
  review,
  catalog,
  hasActiveProgram,
  editing = false,
  focusDayIndex = null,
  isSaving,
  saveErrors,
  savedProgramId,
  onChange,
  onSave,
  onSaveCustomExercise,
}: ManualProgramBuilderProps) {
  const scrollRef = useRef<ScrollView>(null);
  const dayOffsets = useRef<Record<number, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState<string | null>(null);
  const [pendingScrollDay, setPendingScrollDay] = useState<number | null>(focusDayIndex);
  const [picker, setPicker] = useState<{ dayIndex: number; exerciseIndex: number } | null>(null);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [muscleFilter, setMuscleFilter] = useState<string | null>(null);
  const [equipmentFilter, setEquipmentFilter] = useState<string | null>(null);

  function edit(next: ManualEdit) {
    if (savedProgramId != null) {
      return;
    }
    const result = applyManualEdit(review, next);
    setFieldError(result.error);
    if (result.error) {
      return;
    }
    if (next.type === 'add-day') {
      setLocalStatus(DAY_ADDED_LOCALLY_MESSAGE);
      setPendingScrollDay(result.review.days.length - 1);
    } else if (next.type === 'remove-day' || next.type === 'move-day' || next.type === 'rename-day') {
      setLocalStatus(null);
    }
    if (result.review !== review) {
      setDrafts({});
      onChange(result.review);
    }
  }

  useEffect(() => {
    if (pendingScrollDay == null) {
      return;
    }
    const y = dayOffsets.current[pendingScrollDay];
    if (y == null) {
      return;
    }
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
  }, [pendingScrollDay, review.days.length]);

  function changeNumber(
    dayIndex: number,
    exerciseIndex: number,
    field: 'sets' | 'repsMin' | 'repsMax',
    raw: string,
  ) {
    if (savedProgramId != null) {
      return;
    }
    const key = `${dayIndex}:${exerciseIndex}:${field}`;
    const result = applyManualNumber(review, { dayIndex, exerciseIndex, field, raw });
    setFieldError(result.error);
    if (result.error) {
      setDrafts((current) => ({ ...current, [key]: raw }));
      return;
    }
    setDrafts((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (result.review !== review) {
      onChange(result.review);
    }
  }

  const choices = mergeExerciseChoices(catalog, PLANNED_EXERCISES);
  const catalogMatches = filterCatalog(choices, catalogQuery, {
    muscle: muscleFilter,
    equipment: equipmentFilter,
  });
  const customName = catalogQuery.trim();
  const customKey = normalizeExerciseName(customName);
  const customReady =
    customName.length >= 1 &&
    customName.length <= PROGRAM_NAME_MAX &&
    customKey !== '' &&
    !choices.some((exercise) => normalizeExerciseName(exercise.name) === customKey);
  const saveLabel = editing || hasActiveProgram ? SAVE_ROUTINE_LABEL : SAVE_FIRST_ROUTINE_LABEL;
  const savedMessage = editing
    ? EDIT_SAVED_MESSAGE
    : hasActiveProgram
      ? MANUAL_SAVED_INACTIVE_MESSAGE
      : MANUAL_SAVED_CURRENT_MESSAGE;

  return (
    <Screen ref={scrollRef} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{editing ? 'Edit routine' : 'Build a routine'}</Text>
      <Text accessibilityLabel={LOCAL_DAY_NOTICE} style={styles.subtitle}>
        {LOCAL_DAY_NOTICE}
      </Text>
      <Text style={styles.subtitle}>
        {editing
          ? EDIT_DRAFT_NOTICE
          : hasActiveProgram
            ? 'This creates a saved routine and leaves your current program and workout history unchanged.'
            : 'This routine would become your current program. Workout history stays unchanged.'}
      </Text>
      {editing || hasActiveProgram ? null : (
        <Text accessibilityLabel={FIRST_PROGRAM_NOTICE} style={styles.notice}>
          {FIRST_PROGRAM_NOTICE}
        </Text>
      )}

      <View pointerEvents={savedProgramId == null ? 'auto' : 'none'}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Program name</Text>
        <TextInput
          accessibilityLabel={PROGRAM_NAME_LABEL}
          maxLength={PROGRAM_NAME_MAX}
          onChangeText={(name) => edit({ type: 'rename-program', name })}
          placeholder="Routine name"
          placeholderTextColor={palette.muted}
          style={styles.input}
          value={review.programName}
        />
      </View>

      {review.days.map((day, dayIndex) => {
        const dayNumber = dayIndex + 1;
        return (
          <Card
            key={`day-${dayIndex}`}
            onLayout={(event) => {
              const y = event.nativeEvent.layout.y;
              dayOffsets.current[dayIndex] = y;
              if (pendingScrollDay === dayIndex) {
                scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
              }
            }}
            style={styles.dayCard}>
            <Text style={styles.dayHeading}>Day {dayNumber}</Text>
            <Text style={styles.fieldLabel}>Day name</Text>
            <TextInput
              accessibilityLabel={dayNameLabel(dayNumber)}
              maxLength={DAY_NAME_MAX}
              onChangeText={(name) => edit({ type: 'rename-day', dayIndex, name })}
              placeholder="Day name"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={day.name}
            />
            <TextInput
              accessibilityLabel={daySubtitleLabel(dayNumber)}
              maxLength={TEXT_FIELD_MAX}
              onChangeText={(subtitle) => edit({ type: 'set-subtitle', dayIndex, subtitle })}
              placeholder="Subtitle, optional"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={day.subtitle ?? ''}
            />
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={moveDayLabel(dayNumber, 'up')}
                disabled={dayIndex === 0}
                onPress={() => edit({ type: 'move-day', dayIndex, direction: 'up' })}
                style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
                <Text style={styles.smallButtonLabel}>Up</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={moveDayLabel(dayNumber, 'down')}
                disabled={dayIndex === review.days.length - 1}
                onPress={() => edit({ type: 'move-day', dayIndex, direction: 'down' })}
                style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
                <Text style={styles.smallButtonLabel}>Down</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={removeDayLabel(dayNumber)}
                onPress={() => edit({ type: 'remove-day', dayIndex })}
                style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
                <Text style={styles.smallButtonLabel}>Remove</Text>
              </Pressable>
            </View>

            {day.exercises.map((exercise, exerciseIndex) => {
              const exerciseNumber = exerciseIndex + 1;
              const setsKey = `${dayIndex}:${exerciseIndex}:sets`;
              const minKey = `${dayIndex}:${exerciseIndex}:repsMin`;
              const maxKey = `${dayIndex}:${exerciseIndex}:repsMax`;
              return (
                <View key={`exercise-${dayNumber}-${exerciseNumber}`} style={styles.exercise}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={chooseExerciseLabel(dayNumber, exerciseNumber)}
                    onPress={() => {
                      setCatalogQuery('');
                      setMuscleFilter(null);
                      setEquipmentFilter(null);
                      setPicker({ dayIndex, exerciseIndex });
                    }}
                    style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
                    <Text style={styles.choiceLabel}>
                      {exerciseChoiceText(exercise.exerciseId, choices, exercise.sourceName)}
                    </Text>
                  </Pressable>
                  <View style={styles.filterWrap}>
                    {([
                      ['external', null],
                      ['bodyweight', 'bodyweight'],
                      ['added', 'added'],
                      ['assisted', 'assisted'],
                    ] as const).map(([key, mode]) => (
                      <Pressable
                        key={key}
                        accessibilityRole="button"
                        accessibilityLabel={`${TRACKING_MODE_LABELS[key]} tracking`}
                        accessibilityState={{ selected: (exercise.loadMode ?? null) === mode }}
                        onPress={() =>
                          edit({
                            type: 'set-load-mode',
                            dayIndex,
                            exerciseIndex,
                            loadMode: mode,
                          })
                        }
                        style={[
                          styles.filterChip,
                          (exercise.loadMode ?? null) === mode && styles.filterChipSelected,
                        ]}>
                        <Text
                          style={[
                            styles.filterChipLabel,
                            (exercise.loadMode ?? null) === mode && styles.filterChipLabelSelected,
                          ]}>
                          {TRACKING_MODE_LABELS[key]}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.row}>
                    <TextInput
                      accessibilityLabel={setsLabel(dayNumber, exerciseNumber)}
                      keyboardType="number-pad"
                      maxLength={2}
                      onChangeText={(raw) => changeNumber(dayIndex, exerciseIndex, 'sets', raw)}
                      placeholder="Sets"
                      placeholderTextColor={palette.muted}
                      style={[styles.input, styles.numberInput]}
                      value={drafts[setsKey] ?? numberText(exercise.sets.value)}
                    />
                    <TextInput
                      accessibilityLabel={repsMinLabel(dayNumber, exerciseNumber)}
                      keyboardType="number-pad"
                      maxLength={3}
                      onChangeText={(raw) => changeNumber(dayIndex, exerciseIndex, 'repsMin', raw)}
                      placeholder="Min"
                      placeholderTextColor={palette.muted}
                      style={[styles.input, styles.numberInput]}
                      value={drafts[minKey] ?? numberText(exercise.repsMin.value)}
                    />
                    <TextInput
                      accessibilityLabel={repsMaxLabel(dayNumber, exerciseNumber)}
                      keyboardType="number-pad"
                      maxLength={3}
                      onChangeText={(raw) => changeNumber(dayIndex, exerciseIndex, 'repsMax', raw)}
                      placeholder="Max"
                      placeholderTextColor={palette.muted}
                      style={[styles.input, styles.numberInput]}
                      value={drafts[maxKey] ?? numberText(exercise.repsMax.value)}
                    />
                  </View>
                  <TextInput
                    accessibilityLabel={notesLabel(dayNumber, exerciseNumber)}
                    maxLength={NOTE_EDIT_MAX}
                    onChangeText={(notes) =>
                      edit({ type: 'set-notes', dayIndex, exerciseIndex, notes })
                    }
                    placeholder="Notes, optional"
                    placeholderTextColor={palette.muted}
                    style={styles.input}
                    value={exercise.notes ?? ''}
                  />
                  <View style={styles.row}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={moveExerciseLabel(dayNumber, exerciseNumber, 'up')}
                      disabled={exerciseIndex === 0}
                      onPress={() =>
                        edit({
                          type: 'move-exercise',
                          dayIndex,
                          exerciseIndex,
                          direction: 'up',
                        })
                      }
                      style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
                      <Text style={styles.smallButtonLabel}>Up</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={moveExerciseLabel(dayNumber, exerciseNumber, 'down')}
                      disabled={exerciseIndex === day.exercises.length - 1}
                      onPress={() =>
                        edit({
                          type: 'move-exercise',
                          dayIndex,
                          exerciseIndex,
                          direction: 'down',
                        })
                      }
                      style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
                      <Text style={styles.smallButtonLabel}>Down</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={removeExerciseLabel(dayNumber, exerciseNumber)}
                      onPress={() => edit({ type: 'remove-exercise', dayIndex, exerciseIndex })}
                      style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}>
                      <Text style={styles.smallButtonLabel}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={addExerciseLabel(dayNumber)}
              onPress={() => edit({ type: 'add-exercise', dayIndex })}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonLabel}>{ADD_EXERCISE_LABEL}</Text>
            </Pressable>
          </Card>
        );
      })}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ADD_DAY_LABEL}
        onPress={() => edit({ type: 'add-day' })}
        style={({ pressed }) => [styles.addDayButton, pressed && styles.pressed]}>
        <MaterialIcons color={palette.accent} name="add" size={22} />
        <Text style={styles.addDayLabel}>{ADD_DAY_LABEL}</Text>
      </Pressable>
      {localStatus ? <Text style={styles.notice}>{localStatus}</Text> : null}
      </View>

      {fieldError ? <Text style={styles.error}>{fieldError}</Text> : null}
      {saveErrors.map((error) => (
        <Text key={error} style={styles.error}>
          {error}
        </Text>
      ))}
      {savedProgramId ? (
        <Text accessibilityLabel={savedMessage} style={styles.notice}>
          {savedMessage} Saved id {savedProgramId}. {MANUAL_SAVE_ONCE_MESSAGE}
        </Text>
      ) : null}

      {savedProgramId == null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={saveLabel}
          disabled={isSaving}
          onPress={onSave}
          style={({ pressed }) => [styles.primaryButton, (pressed || isSaving) && styles.pressed]}>
          <Text style={styles.primaryButtonLabel}>{isSaving ? 'Saving...' : saveLabel}</Text>
        </Pressable>
      ) : (
        <Link href="/program/saved" asChild>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={VIEW_SAVED_PROGRAMS_LABEL}
            style={styles.primaryButton}>
            {({ pressed }) => (
              <Text style={[styles.primaryButtonLabel, pressed && styles.pressed]}>
                {VIEW_SAVED_PROGRAMS_LABEL}
              </Text>
            )}
          </Pressable>
        </Link>
      )}

      <Modal
        animationType="slide"
        onRequestClose={() => setPicker(null)}
        transparent
        visible={picker != null}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.dayHeading}>{CHOOSE_EXERCISE_LABEL}</Text>
            <TextInput
              accessibilityLabel="Filter exercises"
              onChangeText={setCatalogQuery}
              placeholder="Search exercises"
              placeholderTextColor={palette.muted}
              style={styles.input}
              value={catalogQuery}
            />
            <View style={styles.filterWrap}>
              <FilterChip
                label="All muscles"
                selected={muscleFilter == null}
                onPress={() => setMuscleFilter(null)}
              />
              {MUSCLE_GROUPS.map((muscle) => (
                <FilterChip
                  key={muscle}
                  label={muscle}
                  selected={muscleFilter === muscle}
                  onPress={() => setMuscleFilter(muscle)}
                />
              ))}
            </View>
            <View style={styles.filterWrap}>
              <FilterChip
                label="All equipment"
                selected={equipmentFilter == null}
                onPress={() => setEquipmentFilter(null)}
              />
              {EQUIPMENT_TYPES.map((equipment) => (
                <FilterChip
                  key={equipment}
                  label={equipment}
                  selected={equipmentFilter === equipment}
                  onPress={() => setEquipmentFilter(equipment)}
                />
              ))}
            </View>
            <Text style={styles.filterCount}>{catalogMatches.length} exercises</Text>
            {customReady ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Use ${customName}`}
                onPress={() => {
                  if (!picker) {
                    return;
                  }
                  edit({
                    type: 'preview-exercise',
                    dayIndex: picker.dayIndex,
                    exerciseIndex: picker.exerciseIndex,
                    name: customName,
                  });
                  setPicker(null);
                }}
                style={styles.catalogRow}>
                <Text style={styles.choiceLabel}>Use "{customName}"</Text>
                <Text style={styles.catalogMeta}>Your exercise · Not saved to the library yet</Text>
              </Pressable>
            ) : null}
            {CUSTOM_EXERCISE_WRITES_ENABLED && customReady ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Save ${customName} to your library`}
                onPress={() => onSaveCustomExercise?.(customName)}
                style={styles.catalogRow}>
                <Text style={styles.choiceLabel}>Save "{customName}" to your library</Text>
              </Pressable>
            ) : null}
            <FlatList
              data={catalogMatches}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${item.name}`}
                  onPress={() => {
                    if (!picker) {
                      return;
                    }
                    if (item.saved === false) {
                      edit({
                        type: 'preview-exercise',
                        dayIndex: picker.dayIndex,
                        exerciseIndex: picker.exerciseIndex,
                        name: item.name,
                      });
                    } else {
                      edit({
                        type: 'choose-exercise',
                        dayIndex: picker.dayIndex,
                        exerciseIndex: picker.exerciseIndex,
                        exerciseId: item.id,
                      });
                    }
                    setPicker(null);
                  }}
                  style={({ pressed }) => [styles.catalogRow, pressed && styles.pressed]}>
                  <Text style={styles.choiceLabel}>{item.name}</Text>
                  <Text style={styles.catalogMeta}>
                    {[item.muscle, item.equipment].filter(Boolean).join(' · ')}
                    {item.saved === false ? ' · Not in the saved library yet' : ''}
                  </Text>
                </Pressable>
              )}
              style={styles.catalogList}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close exercise list"
              onPress={() => setPicker(null)}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonLabel}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        selected && styles.filterChipSelected,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.filterChipLabel, selected && styles.filterChipLabelSelected]}>{label}</Text>
    </Pressable>
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
  },
  dayCard: {
    gap: 12,
  },
  notice: {
    color: palette.text,
    fontSize: 16,
  },
  error: {
    color: palette.text,
    fontSize: 16,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  dayHeading: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 12,
  },
  numberInput: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  exercise: {
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  choice: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  choiceLabel: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '600',
  },
  smallButton: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonLabel: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonLabel: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  addDayButton: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
  },
  addDayLabel: {
    color: palette.accent,
    fontSize: 16,
    fontWeight: '800',
  },
  filterWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipSelected: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  filterChipLabel: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  filterChipLabelSelected: {
    color: palette.accentText,
  },
  filterCount: {
    color: palette.muted,
    fontSize: 14,
  },
  catalogMeta: {
    color: palette.muted,
    fontSize: 13,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonLabel: {
    color: palette.accentText,
    fontSize: 16,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '80%',
    backgroundColor: palette.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 12,
  },
  catalogList: {
    flexGrow: 0,
  },
  catalogRow: {
    minHeight: 48,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
});
