import { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { DAY_NAME_MAX, NOTE_EDIT_MAX, PROGRAM_NAME_MAX, TEXT_FIELD_MAX } from '@/lib/import/limits';
import {
  ADD_DAY_LABEL,
  ADD_EXERCISE_LABEL,
  CHOOSE_EXERCISE_LABEL,
  MANUAL_NO_ACTIVE_PROGRAM_MESSAGE,
  MANUAL_SAVED_INACTIVE_MESSAGE,
  PROGRAM_NAME_LABEL,
  SAVE_ROUTINE_LABEL,
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
import type { ProgramReview } from '@/lib/import/review-editor';

const palette = Colors.dark;

type ManualProgramBuilderProps = {
  review: ProgramReview;
  catalog: readonly CatalogExercise[];
  hasActiveProgram: boolean;
  isSaving: boolean;
  saveErrors: readonly string[];
  savedProgramId: string | null;
  onChange: (review: ProgramReview) => void;
  onSave: () => void;
};

function numberText(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

export function ManualProgramBuilder({
  review,
  catalog,
  hasActiveProgram,
  isSaving,
  saveErrors,
  savedProgramId,
  onChange,
  onSave,
}: ManualProgramBuilderProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ dayIndex: number; exerciseIndex: number } | null>(null);
  const [catalogQuery, setCatalogQuery] = useState('');

  function edit(next: ManualEdit) {
    const result = applyManualEdit(review, next);
    setFieldError(result.error);
    if (result.review !== review) {
      setDrafts({});
      onChange(result.review);
    }
  }

  function changeNumber(
    dayIndex: number,
    exerciseIndex: number,
    field: 'sets' | 'repsMin' | 'repsMax',
    raw: string,
  ) {
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

  const catalogMatches = filterCatalog(catalog, catalogQuery);

  return (
    <Screen keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Build a routine</Text>
      <Text style={styles.subtitle}>
        This creates a saved routine and leaves your current program and workout history unchanged.
      </Text>
      {hasActiveProgram ? null : (
        <Text accessibilityLabel={MANUAL_NO_ACTIVE_PROGRAM_MESSAGE} style={styles.notice}>
          {MANUAL_NO_ACTIVE_PROGRAM_MESSAGE}
        </Text>
      )}

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
          <Card key={`day-${dayIndex}`} style={styles.dayCard}>
            <Text style={styles.dayHeading}>Day {dayNumber}</Text>
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
                      setPicker({ dayIndex, exerciseIndex });
                    }}
                    style={({ pressed }) => [styles.choice, pressed && styles.pressed]}>
                    <Text style={styles.choiceLabel}>
                      {exerciseChoiceText(exercise.exerciseId, catalog)}
                    </Text>
                  </Pressable>
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
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
        <Text style={styles.secondaryButtonLabel}>{ADD_DAY_LABEL}</Text>
      </Pressable>

      {fieldError ? <Text style={styles.error}>{fieldError}</Text> : null}
      {saveErrors.map((error) => (
        <Text key={error} style={styles.error}>
          {error}
        </Text>
      ))}
      {savedProgramId ? (
        <Text style={styles.notice}>
          {MANUAL_SAVED_INACTIVE_MESSAGE} Saved id {savedProgramId}.
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={SAVE_ROUTINE_LABEL}
        disabled={isSaving}
        onPress={onSave}
        style={({ pressed }) => [styles.primaryButton, (pressed || isSaving) && styles.pressed]}>
        <Text style={styles.primaryButtonLabel}>{isSaving ? 'Saving...' : SAVE_ROUTINE_LABEL}</Text>
      </Pressable>

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
                    edit({
                      type: 'choose-exercise',
                      dayIndex: picker.dayIndex,
                      exerciseIndex: picker.exerciseIndex,
                      exerciseId: item.id,
                    });
                    setPicker(null);
                  }}
                  style={({ pressed }) => [styles.catalogRow, pressed && styles.pressed]}>
                  <Text style={styles.choiceLabel}>{item.name}</Text>
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
