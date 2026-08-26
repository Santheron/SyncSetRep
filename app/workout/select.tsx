import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { listProgramDays, startWorkoutForDay, type ProgramDayOption } from '@/lib/workout-session';

const palette = Colors.dark;

function exerciseCountLabel(count: number) {
  if (count === 1) {
    return '1 exercise';
  }

  return `${count} exercises`;
}

export default function SelectWorkoutDayScreen() {
  const router = useRouter();
  const [days, setDays] = useState<ProgramDayOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [startingDayId, setStartingDayId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function loadDays() {
        setIsLoading(true);
        const result = await listProgramDays();

        if (!isMounted) {
          return;
        }

        if (!result.ok) {
          setErrorMessage(result.error);
          setDays([]);
        } else {
          setErrorMessage(null);
          setDays(result.data);
        }

        setIsLoading(false);
      }

      void loadDays();

      return () => {
        isMounted = false;
      };
    }, []),
  );

  async function selectDay(day: ProgramDayOption) {
    if (startingDayId) {
      return;
    }

    setStartingDayId(day.id);
    setErrorMessage(null);

    const result = await startWorkoutForDay(day.id);

    if (!result.ok) {
      setErrorMessage(result.error);
      setStartingDayId(null);
      return;
    }

    router.replace({
      pathname: '/workout/[sessionId]',
      params: { sessionId: result.data.sessionId },
    });
  }

  return (
    <Screen>
      <View>
        <Text style={styles.kicker}>Program</Text>
        <Text style={styles.title}>Choose Workout</Text>
      </View>
      <Text style={styles.subtitle}>
        {isLoading
          ? 'Loading program days...'
          : errorMessage
            ? 'Could not load program days'
            : 'Select the day you are training.'}
      </Text>

      {isLoading ? (
        <Text style={styles.status}>Loading workout days...</Text>
      ) : errorMessage && days.length === 0 ? (
        <Text style={styles.error}>Could not load workout days. {errorMessage}</Text>
      ) : (
        days.map((day) => {
          const isStarting = startingDayId === day.id;

          return (
            <Pressable
              key={day.id}
              accessibilityRole="button"
              accessibilityLabel={`${day.name}. ${day.subtitle}. ${exerciseCountLabel(day.exerciseCount)}`}
              disabled={startingDayId !== null}
              onPress={() => {
                void selectDay(day);
              }}
              style={({ pressed }) => pressed && styles.pressed}>
              <Card style={styles.dayCard}>
                <View style={styles.dayIndex}>
                  <Text style={styles.dayIndexLabel}>{day.dayOrder}</Text>
                </View>
                <View style={styles.dayCopy}>
                  <Text style={styles.dayName}>{day.name}</Text>
                  <Text style={styles.dayFocus}>{day.subtitle}</Text>
                  <Text style={styles.dayMeta}>
                    {isStarting ? 'Starting...' : exerciseCountLabel(day.exerciseCount)}
                  </Text>
                </View>
              </Card>
            </Pressable>
          );
        })
      )}

      {errorMessage && days.length > 0 ? (
        <Text style={styles.error}>Could not start workout. {errorMessage}</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
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
  pressed: {
    opacity: 0.85,
  },
  dayCard: {
    minHeight: 88,
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
  dayMeta: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
  },
});
