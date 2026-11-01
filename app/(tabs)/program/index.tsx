import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Link, useFocusEffect } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { NO_ACTIVE_PROGRAM_CODE } from '@/lib/active-program';
import { EDIT_DAY_LABEL } from '@/lib/import/manual-program';
import { buttonPaletteForSurface } from '@/lib/ui/button-contrast';
import { listProgramDays, type ProgramDayOption } from '@/lib/workout-session';

const palette = Colors.dark;
const primaryButton = buttonPaletteForSurface('dark');

export default function ProgramScreen() {
  const [programDays, setProgramDays] = useState<ProgramDayOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loadCode, setLoadCode] = useState<string | null>(null);

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
          setLoadCode(result.code ?? null);
          setProgramDays([]);
        } else {
          setErrorMessage(null);
          setLoadCode(null);
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

  const noCurrentProgram = errorMessage != null && loadCode === NO_ACTIVE_PROGRAM_CODE;

  return (
    <Screen>
      <Text style={styles.title}>Program</Text>
      <Text style={styles.subtitle}>
        {isLoading
          ? 'Loading program...'
          : noCurrentProgram
            ? 'No current program'
            : errorMessage
              ? errorMessage
              : `${programDays.length}-day split`}
      </Text>

      <Link href="/program/build" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Build a routine"
          android_ripple={{ color: 'rgba(17, 17, 17, 0.18)' }}
          style={styles.primaryBuildButton}>
          {({ pressed }) => (
            <View style={[styles.primaryBuildContent, pressed && styles.pressed]}>
              <MaterialIcons color={primaryButton.icon} name="add" size={24} />
              <Text style={styles.primaryBuildLabel}>Build a routine</Text>
            </View>
          )}
        </Pressable>
      </Link>
      <Link href="/program/saved" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Saved programs"
          android_ripple={{ color: 'rgba(255, 255, 255, 0.12)' }}
          style={styles.secondarySavedButton}>
          {({ pressed }) => (
            <Text style={[styles.secondarySavedLabel, pressed && styles.pressed]}>Saved programs</Text>
          )}
        </Pressable>
      </Link>
      <Link href="/program/import" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Import a workout"
          android_ripple={{ color: 'rgba(255, 255, 255, 0.12)' }}
          style={styles.secondarySavedButton}>
          {({ pressed }) => (
            <Text style={[styles.secondarySavedLabel, pressed && styles.pressed]}>
              Import a workout
            </Text>
          )}
        </Pressable>
      </Link>

      {isLoading ? (
        <Text style={styles.status}>Loading program days...</Text>
      ) : noCurrentProgram ? (
        <Text style={styles.error}>{errorMessage}</Text>
      ) : errorMessage ? (
        <Text style={styles.error}>
          Could not load program days. {errorMessage}
        </Text>
      ) : (
        programDays.map((day) => (
          <View key={day.id} style={styles.dayBlock}>
          <Link
            href={{
              pathname: '/program/[id]',
              params: { id: String(day.id) },
            }}
            asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${day.name}. ${day.subtitle}`}
              style={styles.dayPressable}>
              {({ pressed }) => (
                <View style={pressed ? styles.dayPressed : undefined}>
                  <Card style={styles.dayCard}>
                    <View style={styles.dayIndex}>
                      <Text style={styles.dayIndexLabel}>{day.dayOrder}</Text>
                    </View>
                    <View style={styles.dayCopy}>
                      <Text style={styles.dayName}>{day.name}</Text>
                      <Text style={styles.dayFocus}>{day.subtitle}</Text>
                    </View>
                  </Card>
                </View>
              )}
            </Pressable>
          </Link>
          <Link
            href={{ pathname: '/program/build', params: { dayId: String(day.id) } }}
            asChild>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${EDIT_DAY_LABEL}. ${day.name}`}
              android_ripple={{ color: 'rgba(255, 255, 255, 0.12)' }}
              style={styles.editDayButton}>
              {({ pressed }) => (
                <Text style={[styles.editDayLabel, pressed && styles.pressed]}>{EDIT_DAY_LABEL}</Text>
              )}
            </Pressable>
          </Link>
          </View>
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
  pressed: {
    opacity: 0.72,
  },
  dayPressable: {
    borderRadius: 16,
  },
  primaryBuildButton: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: primaryButton.background,
    justifyContent: 'center',
  },
  primaryBuildContent: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  primaryBuildLabel: {
    color: primaryButton.label,
    fontSize: 18,
    fontWeight: '800',
  },
  secondarySavedButton: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  secondarySavedLabel: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  dayBlock: {
    gap: 8,
  },
  editDayButton: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  editDayLabel: {
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
