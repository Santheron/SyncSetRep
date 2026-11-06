import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from '@/components/screen';
import { Colors } from '@/constants/theme';
import {
  catalogChoices,
  CATALOG_CHOICE_LIMIT,
  describeImportReview,
  type DescribedImportExercise,
} from '@/lib/import/import-review-display';
import { DAY_NAME_MAX, PROGRAM_NAME_MAX, SOURCE_NAME_MAX, TEXT_FIELD_MAX, WEIGHT_MAX, WEIGHT_MIN } from '@/lib/import/limits';
import {
  applyManualEdit,
  applyManualNumber,
  dayNameLabel,
  daySubtitleLabel,
  notesLabel,
  repsMaxLabel,
  repsMinLabel,
  setsLabel,
} from '@/lib/import/manual-program';
import type { ImportCatalogExercise } from '@/lib/import/match-exercises';
import { parseEquipmentWeightText } from '@/lib/import/equipment-targets';
import { PLANNED_WEIGHT_RANGE_MESSAGE } from '@/lib/import/planned-weight';
import {
  chooseExercise,
  renameImportedExercise,
  setExerciseEquipmentText,
  setExercisePlannedUnit,
  setExercisePlannedWeight,
  setImportedExerciseNotes,
  type ProgramReview,
} from '@/lib/import/review-editor';

const palette = Colors.dark;

function plannedWeightInput(review: ProgramReview, dayIndex: number, exerciseIndex: number): string {
  const value = review.days[dayIndex]?.exercises[exerciseIndex]?.weight?.value;
  return value == null ? '' : String(value);
}

const MATCH_COLOR: Record<DescribedImportExercise['matchStatus'], string> = {
  matched: palette.accent,
  manual: palette.accent,
  ambiguous: '#F5C16C',
  unmatched: palette.muted,
};

type ImportReviewProps = {
  review: ProgramReview;
  catalog: readonly ImportCatalogExercise[];
  disabled?: boolean;
  onChange: (review: ProgramReview) => void;
  onDraftValid?: (valid: boolean) => void;
};

export function ImportReview({
  review,
  catalog,
  disabled = false,
  onChange,
  onDraftValid,
}: ImportReviewProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const described = describeImportReview(review, catalog);
  const reviewRef = useRef(review);
  const echoedRef = useRef(review);
  const errorsRef = useRef(fieldErrors);
  if (review !== echoedRef.current) {
    echoedRef.current = review;
    reviewRef.current = review;
  }

  function setFieldError(key: string, error: string | null) {
    const next = { ...errorsRef.current };
    if (error) {
      next[key] = error;
    } else {
      delete next[key];
    }
    errorsRef.current = next;
    setFieldErrors(next);
    onDraftValid?.(Object.keys(next).length === 0);
  }

  function editReview(next: ProgramReview) {
    if (next === reviewRef.current) {
      return;
    }
    reviewRef.current = next;
    onChange(next);
  }

  function changeNumber(
    dayIndex: number,
    exerciseIndex: number,
    field: 'sets' | 'repsMin' | 'repsMax' | 'restSeconds',
    raw: string,
  ) {
    if (disabled) {
      return;
    }
    const key = `${dayIndex}:${exerciseIndex}:${field}`;
    const result = applyManualNumber(reviewRef.current, { dayIndex, exerciseIndex, field, raw });
    if (result.error) {
      setFieldError(key, result.error);
      setDrafts((current) => ({ ...current, [key]: raw }));
      return;
    }
    setFieldError(key, null);
    setDrafts((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    editReview(result.review);
  }

  function changePlannedWeight(dayIndex: number, exerciseIndex: number, raw: string) {
    if (disabled) {
      return;
    }
    const key = `${dayIndex}:${exerciseIndex}:weight`;
    const trimmed = raw.trim();
    if (trimmed === '') {
      setFieldError(key, null);
      setDrafts((current) => {
        if (!(key in current)) {
          return current;
        }
        const next = { ...current };
        delete next[key];
        return next;
      });
      editReview(setExercisePlannedWeight(reviewRef.current, dayIndex, exerciseIndex, null));
      return;
    }
    if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
      setFieldError(key, PLANNED_WEIGHT_RANGE_MESSAGE);
      setDrafts((current) => ({ ...current, [key]: raw }));
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < WEIGHT_MIN || value > WEIGHT_MAX) {
      setFieldError(key, PLANNED_WEIGHT_RANGE_MESSAGE);
      setDrafts((current) => ({ ...current, [key]: raw }));
      return;
    }
    setFieldError(key, null);
    setDrafts((current) => {
      if (!(key in current)) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    editReview(setExercisePlannedWeight(reviewRef.current, dayIndex, exerciseIndex, value));
  }

  function changeEquipmentText(dayIndex: number, exerciseIndex: number, raw: string) {
    if (disabled) {
      return;
    }
    const key = `${dayIndex}:${exerciseIndex}:equipment`;
    const parsed = parseEquipmentWeightText(raw);
    setDrafts((current) => ({ ...current, [key]: raw }));
    if (!parsed.ok) {
      setFieldError(key, parsed.error);
      return;
    }
    setFieldError(key, null);
    editReview(setExerciseEquipmentText(reviewRef.current, dayIndex, exerciseIndex, raw));
  }

  return (
    <View accessibilityLabel="Import review">
      <Text accessibilityLabel="Import draft summary" style={styles.summary}>
        {described.summary}
      </Text>
      <Text style={styles.body}>{described.notice}</Text>
      <Text style={styles.body}>{described.nameNotice}</Text>
      {described.retained.map((note) => (
        <Text key={note} style={styles.locked}>
          {note}
        </Text>
      ))}
      <Text style={styles.fieldLabel}>Program name</Text>
      <TextInput
        accessibilityLabel="Imported program name"
        editable={!disabled}
        maxLength={PROGRAM_NAME_MAX}
        onChangeText={(name) => {
          if (disabled) {
            return;
          }
          const result = applyManualEdit(reviewRef.current, { type: 'rename-program', name });
          editReview(result.review);
        }}
        placeholder="Routine name"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={review.programName}
      />
      {described.warnings.map((warning) => (
        <Text key={warning} style={styles.body}>
          {warning}
        </Text>
      ))}
      {described.issues.map((issue) => (
        <Text key={issue} style={styles.body}>
          {issue}
        </Text>
      ))}
      {described.blockers.map((blocker) => (
        <Text key={blocker} accessibilityLabel="Import save requirements" style={styles.body}>
          {blocker}
        </Text>
      ))}
      {Object.entries(fieldErrors).map(([key, message]) => (
        <Text key={key} style={styles.body}>
          {message}
        </Text>
      ))}
      {described.days.map((day) => (
        <Card key={`import-day-${day.dayNumber}`} style={styles.dayCard}>
          <Text style={styles.dayHeading}>Day {day.dayNumber}</Text>
          <Text style={styles.fieldLabel}>Day name</Text>
          <TextInput
            accessibilityLabel={dayNameLabel(day.dayNumber)}
            editable={!disabled}
            maxLength={DAY_NAME_MAX}
            onChangeText={(name) => {
              if (disabled) {
                return;
              }
              const result = applyManualEdit(reviewRef.current, {
                type: 'rename-day',
                dayIndex: day.dayIndex,
                name,
              });
              editReview(result.review);
            }}
            placeholder="Day name"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={day.name}
          />
          <Text style={styles.fieldLabel}>Day subtitle</Text>
          <TextInput
            accessibilityLabel={daySubtitleLabel(day.dayNumber)}
            editable={!disabled}
            maxLength={TEXT_FIELD_MAX}
            onChangeText={(subtitle) => {
              if (disabled) {
                return;
              }
              const result = applyManualEdit(reviewRef.current, {
                type: 'set-subtitle',
                dayIndex: day.dayIndex,
                subtitle,
              });
              editReview(result.review);
            }}
            placeholder="Subtitle, optional"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={day.subtitle}
          />
          {day.emptyText ? <Text style={styles.body}>{day.emptyText}</Text> : null}
          {day.exercises.map((exercise) => {
            const live = review.days[exercise.dayIndex]?.exercises[exercise.exerciseIndex];
            const queryKey = `${exercise.dayIndex}:${exercise.exerciseIndex}`;
            const listed = live
              ? catalogChoices(catalog, live, queries[queryKey] ?? '')
              : { choices: exercise.choices, hiddenCount: exercise.hiddenCount };
            const setsKey = `${exercise.dayIndex}:${exercise.exerciseIndex}:sets`;
            const minKey = `${exercise.dayIndex}:${exercise.exerciseIndex}:repsMin`;
            const maxKey = `${exercise.dayIndex}:${exercise.exerciseIndex}:repsMax`;
            const restKey = `${exercise.dayIndex}:${exercise.exerciseIndex}:restSeconds`;
            return (
              <View key={`import-exercise-${exercise.dayNumber}-${exercise.exerciseNumber}`} style={styles.exercise}>
                <Text style={styles.fieldLabel}>Imported exercise name</Text>
                <TextInput
                  accessibilityLabel={`Imported name for exercise ${exercise.exerciseNumber} on day ${exercise.dayNumber}`}
                  editable={!disabled}
                  maxLength={SOURCE_NAME_MAX}
                  onChangeText={(name) => {
                    if (disabled) {
                      return;
                    }
                    editReview(
                      renameImportedExercise(reviewRef.current, exercise.dayIndex, exercise.exerciseIndex, name),
                    );
                  }}
                  placeholder="Exercise name"
                  placeholderTextColor={palette.muted}
                  style={styles.input}
                  value={exercise.name}
                />
                <Text
                  accessibilityLabel={`Match for exercise ${exercise.exerciseNumber} on day ${exercise.dayNumber}`}
                  style={[styles.match, { color: MATCH_COLOR[exercise.matchStatus] }]}>
                  {exercise.matchText}
                </Text>
                <Text style={styles.locked}>{exercise.catalogNote}</Text>
                <TextInput
                  accessibilityLabel={`Catalog search for exercise ${exercise.exerciseNumber} on day ${exercise.dayNumber}`}
                  editable={!disabled && catalog.length > 0}
                  onChangeText={(query) => {
                    setQueries((current) => ({ ...current, [queryKey]: query }));
                  }}
                  placeholder="Search catalog exercises"
                  placeholderTextColor={palette.muted}
                  style={styles.input}
                  value={queries[queryKey] ?? ''}
                />
                {listed.choices.map((choice) => (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Choose ${choice.name} for exercise ${exercise.exerciseNumber} on day ${exercise.dayNumber}`}
                    accessibilityState={{ selected: choice.selected }}
                    disabled={disabled || choice.selected}
                    key={choice.id}
                    onPress={() => {
                      if (disabled) {
                        return;
                      }
                      editReview(
                        chooseExercise(reviewRef.current, exercise.dayIndex, exercise.exerciseIndex, choice.id),
                      );
                    }}
                    style={styles.choice}>
                    <Text style={styles.choiceLabel}>
                      {choice.selected ? `Selected ${choice.name}` : `Choose ${choice.name}`}
                    </Text>
                  </Pressable>
                ))}
                {listed.hiddenCount > 0 ? (
                  <Text style={styles.locked}>
                    {`Showing ${CATALOG_CHOICE_LIMIT} catalog exercises. Keep typing to see the other ${listed.hiddenCount}.`}
                  </Text>
                ) : null}
                {live?.exerciseId != null && live.exerciseId !== '' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Clear catalog match for exercise ${exercise.exerciseNumber} on day ${exercise.dayNumber}`}
                    disabled={disabled}
                    onPress={() => {
                      if (disabled) {
                        return;
                      }
                      editReview(chooseExercise(reviewRef.current, exercise.dayIndex, exercise.exerciseIndex, null));
                    }}
                    style={styles.choice}>
                    <Text style={styles.choiceLabel}>Clear catalog match</Text>
                  </Pressable>
                ) : null}
                <Text
                  accessibilityLabel={`Sets and reps for exercise ${exercise.exerciseNumber} on day ${exercise.dayNumber}`}
                  style={styles.prescription}>
                  {exercise.prescription}
                </Text>
                <View style={styles.row}>
                  <TextInput
                    accessibilityLabel={setsLabel(exercise.dayNumber, exercise.exerciseNumber)}
                    editable={!disabled}
                    keyboardType="number-pad"
                    maxLength={2}
                    onChangeText={(raw) =>
                      changeNumber(exercise.dayIndex, exercise.exerciseIndex, 'sets', raw)
                    }
                    placeholder="Sets"
                    placeholderTextColor={palette.muted}
                    style={[styles.input, styles.numberInput]}
                    value={drafts[setsKey] ?? exercise.sets}
                  />
                  <TextInput
                    accessibilityLabel={repsMinLabel(exercise.dayNumber, exercise.exerciseNumber)}
                    editable={!disabled}
                    keyboardType="number-pad"
                    maxLength={3}
                    onChangeText={(raw) =>
                      changeNumber(exercise.dayIndex, exercise.exerciseIndex, 'repsMin', raw)
                    }
                    placeholder="Min reps"
                    placeholderTextColor={palette.muted}
                    style={[styles.input, styles.numberInput]}
                    value={drafts[minKey] ?? exercise.repsMin}
                  />
                  <TextInput
                    accessibilityLabel={repsMaxLabel(exercise.dayNumber, exercise.exerciseNumber)}
                    editable={!disabled}
                    keyboardType="number-pad"
                    maxLength={3}
                    onChangeText={(raw) =>
                      changeNumber(exercise.dayIndex, exercise.exerciseIndex, 'repsMax', raw)
                    }
                    placeholder="Max reps"
                    placeholderTextColor={palette.muted}
                    style={[styles.input, styles.numberInput]}
                    value={drafts[maxKey] ?? exercise.repsMax}
                  />
                </View>
                <Text style={styles.fieldLabel}>Rest seconds</Text>
                <TextInput
                  accessibilityLabel={`Rest for exercise ${exercise.exerciseNumber} on day ${exercise.dayNumber}`}
                  editable={!disabled}
                  keyboardType="number-pad"
                  maxLength={3}
                  onChangeText={(raw) =>
                    changeNumber(exercise.dayIndex, exercise.exerciseIndex, 'restSeconds', raw)
                  }
                  placeholder="Rest"
                  placeholderTextColor={palette.muted}
                  style={styles.input}
                  value={drafts[restKey] ?? exercise.rest}
                />
                <Text style={styles.body}>{exercise.restText}</Text>
                <Text style={styles.fieldLabel}>Planned weight</Text>
                <TextInput
                  accessibilityLabel={`Planned weight for exercise ${exercise.exerciseNumber} on day ${exercise.dayNumber}`}
                  editable={!disabled}
                  keyboardType="decimal-pad"
                  onChangeText={(raw) =>
                    changePlannedWeight(exercise.dayIndex, exercise.exerciseIndex, raw)
                  }
                  placeholder="Weight"
                  placeholderTextColor={palette.muted}
                  style={styles.input}
                  value={
                    drafts[`${exercise.dayIndex}:${exercise.exerciseIndex}:weight`] ??
                    plannedWeightInput(review, exercise.dayIndex, exercise.exerciseIndex)
                  }
                />
                <View style={styles.row}>
                  {(['lb', 'kg', null] as const).map((unit) => {
                    const current = review.days[exercise.dayIndex]?.exercises[exercise.exerciseIndex];
                    const selected = (current?.plannedWeightUnit ?? null) === unit;
                    const label = unit == null ? 'Not specified' : unit;
                    return (
                      <Pressable
                        key={label}
                        accessibilityRole="button"
                        accessibilityLabel={`Planned weight unit ${label} for exercise ${exercise.exerciseNumber} on day ${exercise.dayNumber}`}
                        accessibilityState={{ selected }}
                        disabled={disabled}
                        onPress={() => {
                          if (disabled) {
                            return;
                          }
                          editReview(
                            setExercisePlannedUnit(
                              reviewRef.current,
                              exercise.dayIndex,
                              exercise.exerciseIndex,
                              unit,
                            ),
                          );
                        }}
                        style={styles.choice}>
                        <Text style={styles.choiceLabel}>{label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text
                  accessibilityLabel={`Weight for exercise ${exercise.exerciseNumber} on day ${exercise.dayNumber}`}
                  style={styles.body}>
                  {exercise.weightText}
                </Text>
                <Text style={styles.fieldLabel}>Equipment weights</Text>
                <TextInput
                  accessibilityLabel={`Equipment weights for exercise ${exercise.exerciseNumber} on day ${exercise.dayNumber}`}
                  editable={!disabled}
                  onChangeText={(raw) => changeEquipmentText(exercise.dayIndex, exercise.exerciseIndex, raw)}
                  placeholder="155 (80 machine)"
                  placeholderTextColor={palette.muted}
                  style={styles.input}
                  value={drafts[`${exercise.dayIndex}:${exercise.exerciseIndex}:equipment`] ?? ''}
                />
                <TextInput
                  accessibilityLabel={notesLabel(exercise.dayNumber, exercise.exerciseNumber)}
                  editable={!disabled}
                  onChangeText={(notes) => {
                    if (disabled) {
                      return;
                    }
                    editReview(
                      setImportedExerciseNotes(
                        reviewRef.current,
                        exercise.dayIndex,
                        exercise.exerciseIndex,
                        notes,
                      ),
                    );
                  }}
                  placeholder="Notes, optional"
                  placeholderTextColor={palette.muted}
                  style={styles.input}
                  value={exercise.notes}
                />
              </View>
            );
          })}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dayCard: {
    gap: 12,
  },
  summary: {
    color: palette.text,
    fontSize: 18,
    fontWeight: '800',
  },
  dayHeading: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '800',
  },
  prescription: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  match: {
    fontSize: 16,
    fontWeight: '700',
  },
  body: {
    color: palette.text,
    fontSize: 16,
  },
  locked: {
    color: palette.muted,
    fontSize: 14,
  },
  fieldLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  exercise: {
    gap: 8,
    paddingTop: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  numberInput: {
    flex: 1,
  },
  choice: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  choiceLabel: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '700',
  },
});
