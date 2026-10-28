import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  confirmDiscardUnfinishedSession,
  UnfinishedSessionCard,
} from '@/components/unfinished-session-card';
import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { partitionUnfinishedSessions, workoutNavigationTarget } from '@/lib/workout-day-selection';
import {
  discardUnfinishedSession,
  listProgramDays,
  listUnfinishedSessions,
  startWorkoutForDay,
  type ProgramDayOption,
  type UnfinishedSession,
} from '@/lib/workout-session';

const palette = Colors.dark;

type DayDecision = {
  day: ProgramDayOption;
  sameDay: UnfinishedSession[];
  otherDays: UnfinishedSession[];
};

function exerciseCountLabel(count: number) {
  if (count === 1) {
    return '1 exercise';
  }

  return `${count} exercises`;
}

function decisionCopy(dayName: string, sameDayCount: number, otherDayCount: number): string {
  if (sameDayCount > 0 && otherDayCount > 0) {
    return `${dayName} already has an unfinished workout. Other days are in progress too. Resume a workout by name, or discard one after you confirm. Nothing is deleted automatically.`;
  }

  if (sameDayCount > 1) {
    return `${dayName} has ${sameDayCount} unfinished workouts. Resume one of them. A new session stays unavailable until those sessions are discarded.`;
  }

  if (sameDayCount === 1) {
    return `${dayName} already has an unfinished workout. Resume it, or discard that session before starting another.`;
  }

  return `These workouts are still in progress. Start ${dayName} to keep them, or resume one by name.`;
}

export default function SelectWorkoutDayScreen() {
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [days, setDays] = useState<ProgramDayOption[]>([]);
  const [decision, setDecision] = useState<DayDecision | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const decisionRef = useRef<DayDecision | null>(null);
  decisionRef.current = decision;

  const refreshDecision = useCallback(async (day: ProgramDayOption) => {
    const listed = await listUnfinishedSessions();

    if (!listed.ok) {
      return listed;
    }

    const partition = partitionUnfinishedSessions(listed.data, day.id);

    if (partition.sameDay.length === 0 && partition.otherDays.length === 0) {
      setDecision(null);
    } else {
      setDecision({
        day,
        sameDay: partition.sameDay,
        otherDays: partition.otherDays,
      });
    }

    return listed;
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      setBusyAction(null);

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

        const currentDecision = decisionRef.current;

        if (currentDecision) {
          const refreshed = await refreshDecision(currentDecision.day);

          if (isMounted && !refreshed.ok) {
            setErrorMessage(refreshed.error);
          }
        }

        if (isMounted) {
          setIsLoading(false);
        }
      }

      void loadDays();

      return () => {
        isMounted = false;
      };
    }, [refreshDecision]),
  );

  function openWorkout(action: 'start' | 'resume', sessionId: string) {
    const target = workoutNavigationTarget('select', action, sessionId);

    if (target.stay || !('sessionId' in target)) {
      return;
    }

    router.replace({
      pathname: target.pathname,
      params: { sessionId: target.sessionId },
    });
  }

  async function selectDay(day: ProgramDayOption) {
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

    setBusyAction(`day:${day.id}`);
    setErrorMessage(null);

    try {
      const result = await startWorkoutForDay(day.id);

      if (!result.ok) {
        if (result.block) {
          setDecision({
            day,
            sameDay: result.block.sameDay,
            otherDays: result.block.otherDays,
          });
          setBusyAction(null);
          return;
        }

        setErrorMessage(result.error);
        setBusyAction(null);
        return;
      }

      setDecision(null);
      openWorkout('start', result.data.sessionId);
    } catch (error) {
      console.error('[WorkoutStart CRASH]', error);
      setErrorMessage(error instanceof Error ? error.message : 'Could not start workout.');
      setBusyAction(null);
    }
  }

  async function startDespiteOtherDays() {
    if (!decision || busyAction || decision.sameDay.length > 0) {
      return;
    }

    setBusyAction(`start:${decision.day.id}`);
    setErrorMessage(null);

    try {
      const result = await startWorkoutForDay(decision.day.id, {
        acknowledgeOtherUnfinished: true,
      });

      if (!result.ok) {
        if (result.block) {
          setDecision({
            day: decision.day,
            sameDay: result.block.sameDay,
            otherDays: result.block.otherDays,
          });
          setBusyAction(null);
          return;
        }

        setErrorMessage(result.error);
        setBusyAction(null);
        return;
      }

      setDecision(null);
      openWorkout('start', result.data.sessionId);
    } catch (error) {
      console.error('[WorkoutStart CRASH]', error);
      setErrorMessage(error instanceof Error ? error.message : 'Could not start workout.');
      setBusyAction(null);
    }
  }

  async function resumeSession(session: UnfinishedSession) {
    if (busyAction) {
      return;
    }

    setBusyAction(`resume:${session.id}`);
    setErrorMessage(null);
    const listed = await listUnfinishedSessions();

    if (!listed.ok) {
      setErrorMessage(listed.error);
      setBusyAction(null);
      return;
    }

    const match = listed.data.find((item) => item.id === session.id);

    if (!match || match.programDayId !== session.programDayId) {
      setErrorMessage(`${session.name} is no longer an unfinished workout.`);
      if (decision) {
        await refreshDecision(decision.day);
      }
      setBusyAction(null);
      return;
    }

    openWorkout('resume', match.id);
  }

  async function discardSession(session: UnfinishedSession) {
    if (busyAction || !decision) {
      return;
    }

    setBusyAction(`discard:${session.id}`);
    setErrorMessage(null);
    const result = await discardUnfinishedSession(session.id);
    const refreshed = await refreshDecision(decision.day);
    setBusyAction(null);

    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }

    if (!refreshed.ok) {
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

  const isBusy = busyAction !== null;

  function resumeLabel(sessionId: string) {
    return busyAction === `resume:${sessionId}` ? 'Resuming...' : 'Resume Workout';
  }

  function discardLabel(sessionId: string) {
    return busyAction === `discard:${sessionId}` ? 'Discarding...' : 'Discard workout';
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
          : 'Select the day you are training.'}
      </Text>

      {decision ? (
        <View style={styles.decision}>
          <Text style={styles.kicker}>Selected day</Text>
          <Text style={styles.decisionTitle}>{decision.day.name}</Text>
          {decision.day.subtitle ? (
            <Text style={styles.subtitle}>{decision.day.subtitle}</Text>
          ) : null}
          <Text style={styles.subtitle}>
            {decisionCopy(decision.day.name, decision.sameDay.length, decision.otherDays.length)}
          </Text>
          {decision.sameDay.map((session) => (
            <UnfinishedSessionCard
              key={session.id}
              disabled={isBusy}
              discardLabel={discardLabel(session.id)}
              label="This day"
              resumeLabel={resumeLabel(session.id)}
              session={session}
              onDiscard={requestDiscard}
              onResume={(item) => {
                void resumeSession(item);
              }}
            />
          ))}
          {decision.otherDays.map((session) => (
            <UnfinishedSessionCard
              key={session.id}
              disabled={isBusy}
              discardLabel={discardLabel(session.id)}
              label="Other workout"
              resumeLabel={resumeLabel(session.id)}
              session={session}
              onDiscard={requestDiscard}
              onResume={(item) => {
                void resumeSession(item);
              }}
            />
          ))}
          {decision.sameDay.length === 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Start ${decision.day.name} and keep other unfinished workouts`}
              disabled={isBusy}
              onPress={() => {
                void startDespiteOtherDays();
              }}
              style={({ pressed }) => [styles.startButton, (pressed || isBusy) && styles.pressed]}>
              <Text style={styles.startButtonLabel}>
                {busyAction === `start:${decision.day.id}` ? 'Starting...' : `Start ${decision.day.name}`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {isLoading ? (
        <Text style={styles.status}>Loading workout days...</Text>
      ) : errorMessage && days.length === 0 ? (
        <Text style={styles.error}>Could not load workout days. {errorMessage}</Text>
      ) : (
        days.map((day) => {
          const isStarting = busyAction === `day:${day.id}`;

          return (
            <Pressable
              key={day.id}
              accessibilityRole="button"
              accessibilityLabel={`${day.name}. ${day.subtitle}. ${exerciseCountLabel(day.exerciseCount)}`}
              disabled={isBusy}
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

      {errorMessage && days.length > 0 ? <Text style={styles.error}>{errorMessage}</Text> : null}
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
  decision: {
    gap: 16,
  },
  decisionTitle: {
    color: palette.text,
    fontSize: 28,
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
