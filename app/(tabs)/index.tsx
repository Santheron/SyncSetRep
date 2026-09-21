import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { formatWorkoutDate } from '@/lib/workout-format';
import {
  discardUnfinishedSessions,
  getLatestUnfinishedSession,
  type UnfinishedSession,
} from '@/lib/workout-session';

const palette = Colors.dark;

export default function WorkoutScreen() {
  const router = useRouter();
  const [activeSession, setActiveSession] = useState<UnfinishedSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function load() {
        setIsLoading(true);
        const result = await getLatestUnfinishedSession();

        if (!isMounted) {
          return;
        }

        if (!result.ok) {
          setErrorMessage(result.error);
          setActiveSession(null);
        } else {
          setErrorMessage(null);
          setActiveSession(result.data);
        }

        setIsLoading(false);
      }

      void load();

      return () => {
        isMounted = false;
      };
    }, []),
  );

  function openSession(sessionId: string | number) {
    router.push({
      pathname: '/workout/[sessionId]',
      params: { sessionId: String(sessionId) },
    });
  }

  function openDaySelect() {
    router.push('/workout/select');
  }

  function resumeWorkout(sessionId?: string) {
    const id = sessionId ?? activeSession?.id;

    if (!id || isWorking) {
      return;
    }

    openSession(id);
  }

  async function discardAndStartNew() {
    if (isWorking) {
      return;
    }

    setIsWorking(true);
    setErrorMessage(null);

    const result = await discardUnfinishedSessions();

    if (!result.ok) {
      setErrorMessage(result.error);
      setIsWorking(false);
      const activeResult = await getLatestUnfinishedSession();

      if (activeResult.ok) {
        setActiveSession(activeResult.data);
      }

      return;
    }

    setActiveSession(null);
    setIsWorking(false);
    openDaySelect();
  }

  function confirmOverrideAndStartNew() {
    Alert.alert(
      'Discard unfinished workout?',
      'This will discard your unfinished workout progress. Continue?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () => {
            void discardAndStartNew();
          },
        },
      ],
    );
  }

  function promptUnfinishedWorkout(session: UnfinishedSession) {
    Alert.alert(
      'Workout in progress',
      'You already have an unfinished workout. Do you want to resume it or override it and start a new workout?',
      [
        {
          text: 'Resume Workout',
          onPress: () => resumeWorkout(session.id),
        },
        {
          text: 'Override & Start New',
          style: 'destructive',
          onPress: confirmOverrideAndStartNew,
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ],
    );
  }

  async function requestStartWorkout() {
    if (isWorking) {
      return;
    }

    let unfinished = activeSession;

    if (isLoading) {
      const result = await getLatestUnfinishedSession();

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      unfinished = result.data;
      setActiveSession(result.data);
    }

    if (!unfinished) {
      openDaySelect();
      return;
    }

    promptUnfinishedWorkout(unfinished);
  }

  const hasActiveSession = activeSession !== null;

  return (
    <Screen>
      <View>
        <Text style={styles.kicker}>
          {isLoading ? 'Workout' : hasActiveSession ? activeSession.name : 'Workout'}
        </Text>
        <Text style={styles.title}>
          {hasActiveSession ? 'Workout in progress' : "Today's Workout"}
        </Text>
      </View>

      {hasActiveSession ? (
        <Card style={styles.activeCard}>
          <Text style={styles.activeLabel}>Resume Workout</Text>
          <Text style={styles.activeName}>{activeSession.name}</Text>
          {activeSession.subtitle ? (
            <Text style={styles.activeDetail}>{activeSession.subtitle}</Text>
          ) : null}
          <Text style={styles.activeDetail}>
            Started {formatWorkoutDate(activeSession.startedAt)}
          </Text>
        </Card>
      ) : (
        <Text style={styles.helper}>
          {isLoading
            ? 'Checking for an in-progress workout...'
            : 'Choose a program day to start. Leaving the workout screen will keep your sets saved.'}
        </Text>
      )}

      {hasActiveSession ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Resume Workout"
          disabled={isWorking}
          onPress={() => resumeWorkout()}
          style={({ pressed }) => [
            styles.startButton,
            (pressed || isWorking) && styles.pressed,
          ]}>
          <Text style={styles.startButtonLabel}>Resume Workout</Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start Workout"
        disabled={isWorking}
        onPress={() => {
          void requestStartWorkout();
        }}
        style={({ pressed }) => [
          hasActiveSession ? styles.secondaryButton : styles.startButton,
          (pressed || isWorking) && styles.pressed,
        ]}>
        <Text
          style={hasActiveSession ? styles.secondaryButtonLabel : styles.startButtonLabel}>
          {isWorking ? 'Working...' : 'Start Workout'}
        </Text>
      </Pressable>

      {errorMessage ? (
        <Text style={styles.error}>Could not load workout. {errorMessage}</Text>
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
  helper: {
    color: palette.muted,
    fontSize: 16,
  },
  activeCard: {
    gap: 4,
  },
  activeLabel: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  activeName: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  activeDetail: {
    color: palette.muted,
    fontSize: 16,
  },
  startButton: {
    backgroundColor: palette.accent,
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
  },
  startButtonLabel: {
    color: palette.accentText,
    fontSize: 20,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.background,
  },
  secondaryButtonLabel: {
    color: palette.accent,
    fontSize: 20,
    fontWeight: '800',
  },
  error: {
    color: palette.text,
    fontSize: 16,
  },
  pressed: {
    opacity: 0.85,
  },
});
