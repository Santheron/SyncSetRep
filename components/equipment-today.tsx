import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '@/constants/theme';
import type { LinkedSuggestion } from '@/lib/equipment-progression';
import {
  EQUIPMENT_TARGET_KINDS,
  formatEquipmentTarget,
  type EquipmentKind,
  type EquipmentTarget,
} from '@/lib/import/equipment-targets';

const palette = Colors.dark;

type EquipmentTodayProps = {
  targets: readonly EquipmentTarget[] | null | undefined;
  selected: EquipmentKind;
  suggestion: LinkedSuggestion | null;
  dismissed: boolean;
  saveOffer: string | null;
  plannedText: string;
  onSelect: (equipment: EquipmentKind) => void;
  onTry: () => void;
  onKeep: () => void;
  onDismiss: () => void;
  onChangePlanned: (value: string) => void;
  onSavePlanned: () => void;
};

export function EquipmentToday({
  targets,
  selected,
  suggestion,
  dismissed,
  saveOffer,
  plannedText,
  onSelect,
  onTry,
  onKeep,
  onDismiss,
  onChangePlanned,
  onSavePlanned,
}: EquipmentTodayProps) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>Today&apos;s equipment</Text>
      <Text style={styles.body}>Today&apos;s logged weight stays on this workout. Future planned weight changes only when you save it to the routine.</Text>
      <View style={styles.row}>
        {EQUIPMENT_TARGET_KINDS.map((equipment) => {
          const active = equipment === selected;
          return (
            <Pressable
              key={equipment}
              accessibilityRole="button"
              accessibilityLabel={`Use ${equipment} today`}
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(equipment)}
              style={[styles.chip, active && styles.chipSelected]}>
              <Text style={[styles.chipLabel, active && styles.chipLabelSelected]}>{equipment}</Text>
            </Pressable>
          );
        })}
      </View>
      {(targets ?? []).length > 0 ? (
        <Text style={styles.body}>{(targets ?? []).map((target) => formatEquipmentTarget(target)).join('. ')}.</Text>
      ) : null}
      {suggestion && !dismissed && suggestion.suggestedWeight != null ? (
        <View style={styles.suggestion}>
          <Text style={styles.body}>{suggestion.reason}</Text>
          <View style={styles.row}>
            <Pressable accessibilityRole="button" accessibilityLabel="Try suggested weight today" onPress={onTry} style={styles.chip}>
              <Text style={styles.chipLabel}>Try suggested weight today</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Keep current weight" onPress={onKeep} style={styles.chip}>
              <Text style={styles.chipLabel}>Keep current weight</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss suggestion" onPress={onDismiss} style={styles.chip}>
              <Text style={styles.chipLabel}>Dismiss</Text>
            </Pressable>
          </View>
        </View>
      ) : suggestion && !dismissed ? (
        <Text style={styles.body}>{suggestion.reason}</Text>
      ) : null}
      <Text style={styles.label}>Future planned weight</Text>
      <TextInput
        accessibilityLabel={`Future ${selected} planned weight`}
        keyboardType="decimal-pad"
        onChangeText={onChangePlanned}
        placeholder="Planned weight"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={plannedText}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Save planned weight to routine" onPress={onSavePlanned} style={styles.chip}>
        <Text style={styles.chipLabel}>Save to routine</Text>
      </Pressable>
      {saveOffer ? <Text style={styles.body}>{saveOffer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 8,
  },
  label: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  body: {
    color: palette.text,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: palette.accent,
  },
  chipLabel: {
    color: palette.text,
    fontSize: 13,
    fontWeight: '700',
  },
  chipLabelSelected: {
    color: '#111111',
  },
  suggestion: {
    gap: 8,
  },
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 12,
  },
});
