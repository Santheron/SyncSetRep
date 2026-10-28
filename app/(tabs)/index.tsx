import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  confirmDiscardUnfinishedSession,
  UnfinishedSessionCard,
} from '@/components/unfinished-session-card';
import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { workoutNavigationTarget } from '@/lib/workout-day-selection';
import {
  discardUnfinishedSession,
  listUnfinishedSessions,
  type UnfinishedSession,
} from '@/lib/workout-session';

const palette = Colors.dark;

export default function WorkoutScreen() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [sessions, setSessions] = useState<UnfinishedSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    const result = await listUnfinishedSessions();
    return result;
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      setBusyAction(null);

      async function load() {
        setIsLoading(true);
        const result = await loadSessions();

        if (!isMounted) {
          return;
        }

        if (!result.ok) {
          setErrorMessage(result.error);
          setSessions([]);
        } else {
          setErrorMessage(null);
          setSessions(result.data);
        }

        setIsLoading(false);
      }

      void load();

      return () => {
        isMounted = false;
      };
    }, [loadSessions]),
  );

  function followNavigation(action: 'start' | 'resume', sessionId: string | null) {
    const target = workoutNavigationTarget('home', action, sessionId);

    if (target.stay) {
      return;
    }

    if (target.pathname === '/workout/select') {
      router.push(target.pathname);
      return;
    }

    router.push({
      pathname: target.pathname,
      params: { sessionId: target.sessionId },
    });
  }

  async function resumeWorkout(session: UnfinishedSession) {
    if (busyAction) {
      return;
    }

    setBusyAction(`resume:${session.id}`);
    setErrorMessage(null);
    const result = await listUnfinishedSessions();

    if (!result.ok) {
      setSessions([]);
      setErrorMessage(result.error);
      setBusyAction(null);
      return;
    }

    setSessions(result.data);
    const match = result.data.find((item) => item.id === session.id);

    if (!match || match.programDayId !== session.programDayId) {
      setErrorMessage(`${session.name} is no longer an unfinished workout.`);
      setBusyAction(null);
      return;
    }

    followNavigation('resume', match.id);
  }

  async function discardSession(session: UnfinishedSession) {
    if (busyAction) {
      return;
    }

    setBusyAction(`discard:${session.id}`);
    setErrorMessage(null);
    const result = await discardUnfinishedSession(session.id);
    const refreshed = await listUnfinishedSessions();
    setBusyAction(null);

    if (!result.ok) {
      setErrorMessage(result.error);
    }

    if (refreshed.ok) {
      setSessions(refreshed.data);
    } else if (result.ok) {
      setErrorMessage(refreshed.error);
    }
  }

  function requestDiscard(session: UnfinishedSession) {
    if (busyAction) {
      return;
    }

    confirmDiscardUnfinishedSession(session, () => {
      void discardSession(session);
    });
  }

  async function requestStartWorkout() {
    if (busyAction) {
      return;
    }

    if (isAuthLoading) {
      setErrorMessage('Finishing sign-in. Try Start Workout again in a moment.');
      return;
    }

    if (!user) {
      setErrorMessage('You must be signed in to start a workout.');
      return;
    }

    setBusyAction('start');

    if (isLoading) {
      const result = await loadSessions();

      if (!result.ok) {
        setErrorMessage(result.error);
        setBusyAction(null);
        return;
      }

      setSessions(result.data);
    }

    followNavigation('start', null);
  }

  const isBusy = busyAction !== null;

  const sessionCount = sessions.length;
  const kicker = !isLoading && sessionCount === 1 ? sessions[0]?.name ?? 'Workout' : 'Workout';
  const title =
    sessionCount === 0 ? "Today's Workout" : sessionCount === 1 ? 'Workout in progress' : 'Workouts in progress';

  return (
    <Screen>
      <View>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>

      {isLoading ? (
        <Text style={styles.helper}>Checking for an in-progress workout...</Text>
      ) : sessionCount === 0 ? (
        <Text style={styles.helper}>
          Choose a program day to start. Leaving the workout screen will keep your sets saved.
        </Text>
      ) : (
        sessions.map((session) => (
          <UnfinishedSessionCard
            key={session.id}
            disabled={isBusy}
            discardLabel={
              busyAction === `discard:${session.id}` ? 'Discarding...' : 'Discard workout'
            }
            label="In progress"
            resumeLabel={busyAction === `resume:${session.id}` ? 'Resuming...' : 'Resume Workout'}
            session={session}
            onDiscard={requestDiscard}
            onResume={(item) => {
              void resumeWorkout(item);
            }}
          />
        ))
      )}

      {sessionCount > 0 ? (
        <Text style={styles.helper}>
          Choosing another day keeps these workouts. A workout is discarded only after you confirm it.
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start Workout"
        disabled={isBusy}
        onPress={() => {
          void requestStartWorkout();
        }}
        style={({ pressed }) => [
          sessionCount > 0 ? styles.secondaryButton : styles.startButton,
          (pressed || isBusy) && styles.pressed,
        ]}>
        <Text style={sessionCount > 0 ? styles.secondaryButtonLabel : styles.startButtonLabel}>
          {busyAction === 'start' ? 'Starting...' : 'Start Workout'}
        </Text>
      </Pressable>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
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
