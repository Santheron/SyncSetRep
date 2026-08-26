import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import {
  consumeCardioSaveNotice,
  formatCardioSummary,
  type CardioSession,
} from '@/lib/cardio';
import { supabase } from '@/lib/supabase';
import { formatWorkoutDate } from '@/lib/workout-format';

const palette = Colors.dark;

const todayStats = [
  { label: 'Steps', value: '--' },
  { label: 'Distance', value: '--' },
  { label: 'Active Calories', value: '--' },
];

export default function CardioScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<CardioSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const { data, error } = await supabase
      .from('cardio_sessions')
      .select(
        'id, activity_type, started_at, duration_minutes, distance_km, incline_percent, speed_kmh, calories, notes',
      )
      .order('started_at', { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      setSessions([]);
    } else {
      setErrorMessage(null);
      setSessions((data ?? []) as CardioSession[]);
    }

    setIsLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const notice = consumeCardioSaveNotice();

      if (notice) {
        setSuccessMessage(notice);
      }

      void loadSessions();
    }, [loadSessions]),
  );

  return (
    <Screen>
      <Text style={styles.title}>Cardio</Text>
      <Text style={styles.subtitle}>
        {isLoading
          ? 'Loading cardio...'
          : errorMessage
            ? 'Could not load cardio'
            : 'Track daily activity and logged sessions.'}
      </Text>

      {successMessage ? <Text style={styles.success}>{successMessage}</Text> : null}

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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Log Cardio"
        onPress={() => router.push('/cardio/log')}
        style={({ pressed }) => [styles.logButton, pressed && styles.pressed]}>
        <Text style={styles.logButtonLabel}>Log Cardio</Text>
      </Pressable>

      <Text style={styles.listLabel}>Recent Cardio</Text>

      {isLoading ? (
        <Text style={styles.status}>Loading cardio sessions...</Text>
      ) : errorMessage ? (
        <Text style={styles.error}>Could not load cardio sessions. {errorMessage}</Text>
      ) : sessions.length === 0 ? (
        <Text style={styles.status}>No cardio sessions yet.</Text>
      ) : (
        sessions.map((session) => (
          <Card key={session.id} style={styles.logCard}>
            <Text style={styles.logDate}>{formatWorkoutDate(session.started_at)}</Text>
            <Text style={styles.logName}>{session.activity_type}</Text>
            <Text style={styles.logSummary}>{formatCardioSummary(session)}</Text>
          </Card>
        ))
      )}
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
  success: {
    color: palette.accent,
    fontSize: 16,
    fontWeight: '700',
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
  error: {
    color: palette.text,
    fontSize: 16,
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
});
