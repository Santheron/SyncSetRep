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
  currentName: string;
  exercises: WorkoutExercise[];
  isLoading: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: (exercise: WorkoutExercise, scope: 'session' | 'program') => void;
};

function matchesEquipment(exercise: WorkoutExercise, filter: EquipmentFilter): boolean {
  if (filter === 'All') {
    return true;
  }

  const equipment = (exercise.equipmentType ?? '').trim().toLowerCase();
  return equipment === filter.toLowerCase() || equipment.includes(filter.toLowerCase());
}

export function ExercisePickerSheet({
  visible,
  currentName,
  exercises,
  isLoading,
  errorMessage,
  onClose,
  onConfirm,
}: ExercisePickerSheetProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<EquipmentFilter>('All');
  const [selected, setSelected] = useState<WorkoutExercise | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setFilter('All');
      setSelected(null);
    }
  }, [visible]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return exercises.filter((exercise) => {
      if (!matchesEquipment(exercise, filter)) {
        return false;
      }

      if (!needle) {
        return true;
      }

      return (
        exercise.name.toLowerCase().includes(needle) ||
        exercise.category.toLowerCase().includes(needle) ||
        (exercise.equipmentType ?? '').toLowerCase().includes(needle)
      );
    });
  }, [exercises, filter, query]);

  function resetAndClose() {
    setQuery('');
    setFilter('All');
    setSelected(null);
    onClose();
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Just this workout"
                onPress={() => onConfirm(selected, 'session')}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                <Text style={styles.primaryButtonLabel}>Just This Workout</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Replace in program"
                onPress={() => onConfirm(selected, 'program')}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Text style={styles.secondaryButtonLabel}>Replace In Program</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Cancel replace"
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
                  data={filtered}
                  keyExtractor={(item) => item.id}
                  keyboardShouldPersistTaps="handled"
                  style={styles.list}
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
    maxHeight: 360,
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
  },
  primaryButtonLabel: {
    color: palette.accentText,
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonLabel: {
    color: palette.accent,
    fontSize: 16,
    fontWeight: '800',
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
