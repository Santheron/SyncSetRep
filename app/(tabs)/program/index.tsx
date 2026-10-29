import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { listProgramDays, type ProgramDayOption } from '@/lib/workout-session';

const palette = Colors.dark;

export default function ProgramScreen() {
  const [programDays, setProgramDays] = useState<ProgramDayOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function loadProgramDays() {
        const result = await listProgramDays();

        if (!isMounted) {
          return;
        }

        if (!result.ok) {
          setErrorMessage(result.error);
          setProgramDays([]);
        } else {
          setErrorMessage(null);
          setProgramDays(result.data);
        }

        setIsLoading(false);
      }

      void loadProgramDays();

      return () => {
        isMounted = false;
      };
    }, []),
  );

  return (
    <Screen>
      <Text style={styles.title}>Program</Text>
      <Text style={styles.subtitle}>
        {isLoading
          ? 'Loading program...'
          : errorMessage
            ? errorMessage
            : `${programDays.length}-day split`}
      </Text>

      <Link href="/program/build" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Build a routine"
          style={({ pressed }) => [styles.linkButton, pressed && styles.dayPressed]}>
          <Text style={styles.linkLabel}>Build a routine</Text>
        </Pressable>
      </Link>
      <Link href="/program/saved" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Saved programs"
          style={({ pressed }) => [styles.linkButton, pressed && styles.dayPressed]}>
          <Text style={styles.linkLabel}>Saved programs</Text>
        </Pressable>
      </Link>

      {isLoading ? (
        <Text style={styles.status}>Loading program days...</Text>
      ) : errorMessage ? (
        <Text style={styles.error}>
          Could not load program days. {errorMessage}
        </Text>
      ) : (
        programDays.map((day) => (
          <Link
            key={day.id}
            href={{
              pathname: '/program/[id]',
              params: { id: String(day.id) },
            }}
            asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${day.name}. ${day.subtitle}`}
              style={({ pressed }) => pressed && styles.dayPressed}>
              <Card style={styles.dayCard}>
                <View style={styles.dayIndex}>
                  <Text style={styles.dayIndexLabel}>{day.dayOrder}</Text>
                </View>
                <View style={styles.dayCopy}>
                  <Text style={styles.dayName}>{day.name}</Text>
                  <Text style={styles.dayFocus}>{day.subtitle}</Text>
                </View>
              </Card>
            </Pressable>
          </Link>
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
  status: {
    color: palette.muted,
    fontSize: 16,
  },
  error: {
    color: palette.text,
    fontSize: 16,
  },
  dayPressed: {
    opacity: 0.85,
  },
  linkButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  linkLabel: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  dayCard: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  dayIndex: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: palette.background,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayIndexLabel: {
    color: palette.accent,
    fontSize: 18,
    fontWeight: '800',
  },
  dayCopy: {
    flex: 1,
    gap: 2,
  },
  dayName: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  dayFocus: {
    color: palette.muted,
    fontSize: 16,
  },
});
