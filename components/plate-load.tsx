import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';
import { describePlateLoad, parsePlateSetup, type PlateSetup } from '@/lib/import/equipment-targets';
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
  plateSetup?: PlateSetup | null;
};

export function PlateLoadHint({
  weight,
  exerciseName,
  equipmentType,
  plateSetup,
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

    let resolved: PlateSetup | null = plateSetup ?? null;
    if (!resolved) {
      const parsed = parsePlateSetup('', '');
      resolved = parsed.ok ? parsed.setup : null;
    }
    const result = resolved
      ? calculatePlates(requested, resolved.barWeightLb, resolved.platesLb)
      : calculatePlates(requested);
    const belowBar =
      resolved != null && requested < resolved.barWeightLb ? describePlateLoad(requested, resolved) : null;

    return (
    <View style={styles.block}>
      {result.isExact || belowBar ? null : (
        <>
          <Text style={styles.label}>Nearest loadable</Text>
          <Text style={styles.nearest}>{formatPlate(result.actualWeight)} lb</Text>
        </>
      )}
      {belowBar ? <Text style={styles.nearest}>{belowBar}</Text> : null}
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
