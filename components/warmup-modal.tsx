import { useEffect, useState } from 'react';
import {
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
  calculateWarmup,
  formatWeight,
  normalizeEquipmentType,
  parsePositiveWeight,
  type WarmupPlan,
} from '@/lib/warmup';
import { calculatePlates, formatPlatesPerSideLine, isBarbellExercise } from '@/lib/plate-calculator';

const palette = Colors.dark;

type WarmupModalProps = {
  visible: boolean;
  exerciseName: string;
  equipmentType: string | null;
  warmupEnabled: boolean;
  minWeight: number | null;
  weightIncrement: number | null;
  initialWorkingWeight: number | null;
  onClose: () => void;
};

export function WarmupModal({
  visible,
  exerciseName,
  equipmentType,
  warmupEnabled,
  minWeight,
  weightIncrement,
  initialWorkingWeight,
  onClose,
}: WarmupModalProps) {
  const [plannedWeight, setPlannedWeight] = useState('');

  useEffect(() => {
    if (!visible) {
      return;
    }

    setPlannedWeight(
      initialWorkingWeight !== null ? String(initialWorkingWeight) : '',
    );
  }, [visible, initialWorkingWeight]);

  const workingWeight = parsePositiveWeight(plannedWeight);
  const isBodyweight = normalizeEquipmentType(equipmentType) === 'bodyweight';
  const isBarbell = isBarbellExercise({ name: exerciseName, equipmentType });
  const workingPlates = isBarbell && workingWeight !== null ? calculatePlates(workingWeight) : null;
  const plan: WarmupPlan = calculateWarmup({
    exerciseName,
    equipmentType,
    warmupEnabled,
    minWeight,
    weightIncrement,
    workingWeight,
  });

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close warm up"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View style={styles.sheet}>
          <Text style={styles.title}>Warm Up</Text>
          <Text style={styles.exerciseName}>{exerciseName}</Text>

          {isBodyweight ? null : (
            <View style={styles.weightBlock}>
              <Text style={styles.weightNote}>
                {plan.weightNote ?? 'Planned working weight'}
              </Text>
              <TextInput
                accessibilityLabel="Planned working weight"
                keyboardType="decimal-pad"
                onChangeText={setPlannedWeight}
                placeholder="Working weight"
                placeholderTextColor={palette.muted}
                style={styles.input}
                value={plannedWeight}
              />
            </View>
          )}

          {plan.needsWorkingWeight ? (
            <Text style={styles.message}>
              Enter your planned working weight to generate warm-up sets.
            </Text>
          ) : null}

          {plan.sets.map((set) => {
            const plates = isBarbell ? calculatePlates(set.weight) : null;

            return (
              <View key={set.label} style={styles.setRow}>
                <Text style={styles.setLabel}>{set.label}</Text>
                <View style={styles.setCopy}>
                  <Text style={styles.setValue}>
                    {formatWeight(set.weight)} lb × {set.reps}
                  </Text>
                  {plates ? (
                    <Text style={styles.plateLine}>
                      {formatPlatesPerSideLine(plates.platesPerSide)}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}

          {workingPlates ? (
            <View style={styles.workingBlock}>
              <Text style={styles.workingLabel}>Working</Text>
              <Text style={styles.setValue}>
                {formatWeight(workingPlates.requestedWeight)} lb
              </Text>
              {workingPlates.isExact ? null : (
                <Text style={styles.message}>
                  Nearest loadable: {formatWeight(workingPlates.actualWeight)} lb
                </Text>
              )}
              <Text style={styles.plateLine}>
                {formatPlatesPerSideLine(workingPlates.platesPerSide)}
              </Text>
            </View>
          ) : null}

          {plan.message ? <Text style={styles.message}>{plan.message}</Text> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close warm up"
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
            <Text style={styles.closeButtonLabel}>Close</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  sheet: {
    backgroundColor: palette.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 20,
    gap: 12,
    zIndex: 1,
  },
  title: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  exerciseName: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  weightBlock: {
    gap: 8,
  },
  weightNote: {
    color: palette.muted,
    fontSize: 16,
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
  setRow: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  setCopy: {
    flex: 1,
    alignItems: 'flex-end',
    gap: 2,
  },
  setLabel: {
    color: palette.accent,
    fontSize: 16,
    fontWeight: '800',
  },
  setValue: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  plateLine: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
  },
  workingBlock: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.accent,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 2,
  },
  workingLabel: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  message: {
    color: palette.muted,
    fontSize: 16,
  },
  closeButton: {
    backgroundColor: palette.accent,
    minHeight: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  closeButtonLabel: {
    color: palette.accentText,
    fontSize: 16,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
});
