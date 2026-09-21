import { StyleSheet, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';
import type { ExerciseProgression } from '@/lib/progression';

const palette = Colors.dark;

type ExerciseProgressionBlockProps = {
  progression: ExerciseProgression;
};

export function ExerciseProgressionBlock({ progression }: ExerciseProgressionBlockProps) {
  return (
    <View style={styles.block}>
      <Text style={styles.label}>Previous</Text>
      {progression.isFirstSession ? (
        <Text style={styles.body}>First recorded session</Text>
      ) : (
        <>
          {progression.previousDateLabel ? (
            <Text style={styles.date}>{progression.previousDateLabel}</Text>
          ) : null}
          {(progression.previousLines ?? []).map((line, index) => (
            <Text key={`${index}:${line}`} style={styles.body}>
              {line}
            </Text>
          ))}
        </>
      )}

      <Text style={[styles.label, styles.targetLabel]}>Today&apos;s target</Text>
      <Text style={styles.body}>{progression.targetLine}</Text>

      {(progression.badges ?? []).length > 0 ? (
        <View style={styles.badges}>
          {(progression.badges ?? []).map((badge) => (
            <View key={badge} style={styles.badge}>
              <Text style={styles.badgeLabel}>{badge}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {progression.message ? <Text style={styles.message}>{progression.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 4,
    paddingTop: 4,
  },
  label: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  targetLabel: {
    marginTop: 8,
  },
  date: {
    color: palette.muted,
    fontSize: 14,
  },
  body: {
    color: palette.text,
    fontSize: 16,
  },
  badges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  badge: {
    minHeight: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  message: {
    color: palette.muted,
    fontSize: 14,
    marginTop: 4,
  },
});
