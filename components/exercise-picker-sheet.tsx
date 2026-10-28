import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors } from '@/constants/theme';
import {
  exercisesForPicker,
  matchCatalogExercise,
  PRIVATE_EXERCISE_UNAVAILABLE,
} from '@/lib/exercise-swap';
import type { WorkoutExercise } from '@/lib/workout-session';

const palette = Colors.dark;

const EQUIPMENT_FILTERS = [
  'All',
  'Barbell',
  'Dumbbell',
  'Machine',
  'Cable',
  'Bodyweight',
] as const;

type EquipmentFilter = (typeof EQUIPMENT_FILTERS)[number];

type ExercisePickerSheetProps = {
  visible: boolean;
  currentExerciseId: string;
  currentName: string;
  currentCategory: string;
  currentEquipmentType: string | null;
  canReplaceInProgram: boolean;
  exercises: WorkoutExercise[];
  isLoading: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: (exercise: WorkoutExercise, scope: 'session' | 'program') => void;
};

export function ExercisePickerSheet({
  visible,
  currentExerciseId,
  currentName,
  currentCategory,
  currentEquipmentType,
  canReplaceInProgram,
  exercises,
  isLoading,
  isSubmitting,
  errorMessage,
  onClose,
  onConfirm,
}: ExercisePickerSheetProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<EquipmentFilter>('All');
  const [selected, setSelected] = useState<WorkoutExercise | null>(null);
  const [customName, setCustomName] = useState('');
  const [customMessage, setCustomMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setFilter('All');
      setSelected(null);
      setCustomName('');
      setCustomMessage(null);
    }
  }, [visible]);

  const filtered = useMemo(
    () =>
      exercisesForPicker({
        exercises,
        current: {
          id: currentExerciseId,
          name: currentName,
          category: currentCategory,
          equipmentType: currentEquipmentType,
        },
        query,
        equipmentFilter: filter,
      }),
    [currentCategory, currentEquipmentType, currentExerciseId, currentName, exercises, filter, query],
  );

  function resetAndClose() {
    if (isSubmitting) {
      return;
    }

    setQuery('');
    setFilter('All');
    setSelected(null);
    setCustomName('');
    setCustomMessage(null);
    onClose();
  }

  function useCustomName() {
    const match = matchCatalogExercise(exercises, customName);

    if (!match) {
      setCustomMessage(PRIVATE_EXERCISE_UNAVAILABLE);
      return;
    }

    if (match.id === currentExerciseId) {
      setCustomMessage('That is already the exercise in this slot. The workout was not changed.');
      return;
    }

    setCustomMessage(null);
    setSelected(match);
  }

  return (
    <Modal
      animationType="slide"
      onRequestClose={resetAndClose}
      transparent
      visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close exercise picker"
          onPress={resetAndClose}
          style={styles.backdrop}
        />
        <View style={styles.sheet}>
          {selected ? (
            <>
              <Text style={styles.kicker}>Replace exercise</Text>
              <Text style={styles.title}>
                Replace {currentName}
                {'\n'}with {selected.name}?
              </Text>
              {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Swap for this workout only"
                disabled={isSubmitting}
                onPress={() => onConfirm(selected, 'session')}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pressed || isSubmitting) && styles.pressed,
                ]}>
                <Text style={styles.primaryButtonLabel}>
                  {isSubmitting ? 'Swapping...' : 'Swap for this workout only'}
                </Text>
              </Pressable>
              {canReplaceInProgram ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Replace the exercise in my program"
                  disabled={isSubmitting}
                  onPress={() => onConfirm(selected, 'program')}
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    (pressed || isSubmitting) && styles.pressed,
                  ]}>
                  <Text style={styles.secondaryButtonLabel}>Replace in my program</Text>
                </Pressable>
              ) : (
                <Text style={styles.status}>This slot can be swapped for this workout only.</Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel replace"
                disabled={isSubmitting}
                onPress={() => setSelected(null)}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
                <Text style={styles.cancelButtonLabel}>Cancel</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.kicker}>Swap Exercise</Text>
              <Text style={styles.title}>Replace {currentName}</Text>
              <TextInput
                accessibilityLabel="Search exercises"
                autoFocus
                onChangeText={setQuery}
                placeholder="Search exercises..."
                placeholderTextColor={palette.muted}
                style={styles.search}
                value={query}
              />
              <View style={styles.filters}>
                {EQUIPMENT_FILTERS.map((item) => {
                  const isSelected = item === filter;

                  return (
                    <Pressable
                      key={item}
                      accessibilityRole="button"
                      accessibilityLabel={`Filter ${item}`}
                      onPress={() => setFilter(item)}
                      style={({ pressed }) => [
                        styles.filterChip,
                        isSelected && styles.filterChipSelected,
                        pressed && styles.pressed,
                      ]}>
                      <Text
                        style={[
                          styles.filterChipLabel,
                          isSelected && styles.filterChipLabelSelected,
                        ]}>
                        {item}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {isLoading ? (
                <Text style={styles.status}>Loading exercises...</Text>
              ) : errorMessage ? (
                <Text style={styles.error}>{errorMessage}</Text>
              ) : (
                <FlatList
                  data={filtered.exercises}
                  keyExtractor={(item) => item.id}
                  keyboardShouldPersistTaps="handled"
                  style={styles.list}
                  ListHeaderComponent={
                    filtered.showingSuggestions ? (
                      <Text style={styles.status}>
                        Matches for this muscle group. Search to see the full catalog.
                      </Text>
                    ) : null
                  }
                  ListEmptyComponent={
                    <Text style={styles.status}>No matching exercises.</Text>
                  }
                  renderItem={({ item }) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={item.name}
                      onPress={() => setSelected(item)}
                      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                      <Text style={styles.rowName}>{item.name}</Text>
                      <Text style={styles.rowMeta}>
                        {[item.category, item.equipmentType].filter(Boolean).join(' · ')}
                      </Text>
                    </Pressable>
                  )}
                />
              )}
              <Text style={styles.fieldLabel}>{"Can't find it?"}</Text>
              <TextInput
                accessibilityLabel="Exercise name to look up"
                onChangeText={(value) => {
                  setCustomName(value);
                  setCustomMessage(null);
                }}
                placeholder="Type the catalog name"
                placeholderTextColor={palette.muted}
                style={styles.search}
                value={customName}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Look up exercise name"
                onPress={useCustomName}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Text style={styles.secondaryButtonLabel}>Look up this exercise</Text>
              </Pressable>
              {customMessage ? <Text style={styles.error}>{customMessage}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel swap"
                onPress={resetAndClose}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}>
                <Text style={styles.cancelButtonLabel}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  sheet: {
    backgroundColor: palette.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 20,
    gap: 12,
    maxHeight: '86%',
    zIndex: 1,
  },
  kicker: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: palette.text,
    fontSize: 22,
    fontWeight: '800',
  },
  fieldLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  search: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 12,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  filterChipSelected: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  filterChipLabel: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '700',
  },
  filterChipLabelSelected: {
    color: palette.accentText,
  },
  list: {
    maxHeight: 280,
  },
  row: {
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    paddingVertical: 10,
    justifyContent: 'center',
    gap: 2,
  },
  rowName: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  rowMeta: {
    color: palette.muted,
    fontSize: 14,
  },
  status: {
    color: palette.muted,
    fontSize: 16,
    paddingVertical: 12,
  },
  error: {
    color: palette.text,
    fontSize: 16,
    paddingVertical: 12,
  },
  primaryButton: {
    backgroundColor: palette.accent,
    minHeight: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  primaryButtonLabel: {
    color: palette.accentText,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  secondaryButtonLabel: {
    color: palette.accent,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  cancelButton: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonLabel: {
    color: palette.muted,
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
});
