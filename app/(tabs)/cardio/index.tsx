import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { formatCardioSummary, getCardioLogs, type CardioLog } from '@/lib/cardio';
import { formatWorkoutDate } from '@/lib/workout-format';

const palette = Colors.dark;

const todayStats = [
  { label: 'Steps', value: '--' },
  { label: 'Distance', value: '--' },
  { label: 'Active Calories', value: '--' },
];

export default function CardioScreen() {
  const [recentLogs, setRecentLogs] = useState<CardioLog[]>(getCardioLogs());

  useFocusEffect(
    useCallback(() => {
      setRecentLogs(getCardioLogs());
    }, []),
  );

  return (
    <Screen>
      <Text style={styles.title}>Cardio</Text>
      <Text style={styles.subtitle}>Track daily activity and logged sessions.</Text>

      <Card style={styles.todayCard}>
        <Text style={styles.sectionLabel}>Today&apos;s Activity</Text>
        {todayStats.map((stat) => (
          <View key={stat.label} style={styles.statRow}>
            <Text style={styles.statLabel}>{stat.label}</Text>
            <Text style={styles.statValue}>{stat.value}</Text>
          </View>
        ))}
        <Text style={styles.status}>Health Connect not connected</Text>
      </Card>

      <Link href="/cardio/log" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log Cardio"
          style={({ pressed }) => [styles.logButton, pressed && styles.pressed]}>
          <Text style={styles.logButtonLabel}>Log Cardio</Text>
        </Pressable>
      </Link>

      <Text style={styles.listLabel}>Recent Cardio</Text>

      {recentLogs.map((log) => (
        <Card key={log.id} style={styles.logCard}>
          <Text style={styles.logDate}>{formatWorkoutDate(log.loggedAt)}</Text>
          <Text style={styles.logName}>{log.activityType}</Text>
          <Text style={styles.logSummary}>{formatCardioSummary(log)}</Text>
          {log.notes ? <Text style={styles.logNotes}>{log.notes}</Text> : null}
        </Card>
      ))}
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
    marginBottom: 4,
  },
  todayCard: {
    gap: 12,
  },
  sectionLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statLabel: {
    color: palette.muted,
    fontSize: 16,
  },
  statValue: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  status: {
    color: palette.muted,
    fontSize: 16,
    marginTop: 4,
  },
  logButton: {
    backgroundColor: palette.accent,
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
  },
  logButtonLabel: {
    color: palette.accentText,
    fontSize: 20,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
  listLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  logCard: {
    minHeight: 88,
    justifyContent: 'center',
    gap: 4,
  },
  logDate: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  logName: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  logSummary: {
    color: palette.muted,
    fontSize: 16,
  },
  logNotes: {
    color: palette.muted,
    fontSize: 16,
  },
});
