import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';
import {
  calculatePlates,
  formatPlate,
  formatPlatesPerSide,
  isBarbellExercise,
} from '@/lib/plate-calculator';

const palette = Colors.dark;

type PlateLoadHintProps = {
  weight: string;
  exerciseName?: string | null;
  equipmentType?: string | null;
};

export function PlateLoadHint({
  weight,
  exerciseName,
  equipmentType,
}: PlateLoadHintProps) {
  if (!isBarbellExercise({ name: exerciseName, equipmentType })) {
    return null;
  }

  try {
    const trimmed = String(weight ?? '').trim();

    if (!trimmed) {
      return null;
    }

    const requested = Number(trimmed);

    if (!Number.isFinite(requested) || requested < 0) {
      return null;
    }

    const result = calculatePlates(requested);

    return (
    <View style={styles.block}>
      {result.isExact ? null : (
        <>
          <Text style={styles.label}>Nearest loadable</Text>
          <Text style={styles.nearest}>{formatPlate(result.actualWeight)} lb</Text>
        </>
      )}
      <Text style={styles.label}>Plates per side</Text>
      <Text style={styles.value}>{formatPlatesPerSide(result.platesPerSide)}</Text>
    </View>
    );
  } catch (error) {
    console.error('[START WORKOUT ERROR]', error);
    return null;
  }
}

const styles = StyleSheet.create({
  block: {
    gap: 2,
    paddingTop: 2,
  },
  label: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  value: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '800',
  },
  nearest: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '800',
  },
});
