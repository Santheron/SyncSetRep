import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { HealthConnectCard } from '@/components/health-connect-card';
import { Colors } from '@/constants/theme';
import {
  consumeCardioSaveNotice,
  formatCardioSummary,
  listCardioSessions,
  type CardioSession,
} from '@/lib/cardio';
import { formatWorkoutDate } from '@/lib/workout-format';

const palette = Colors.dark;

export default function CardioScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<CardioSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const result = await listCardioSessions();

    if (!result.ok) {
      setErrorMessage(result.error);
      setSessions([]);
    } else {
      setErrorMessage(null);
      setSessions(result.data);
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

      <HealthConnectCard />

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
