import { Alert, Pressable, StyleSheet, Text } from 'react-native';

import { Card } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { applyDiscardConfirmation, formatUnfinishedSessionWhen } from '@/lib/workout-day-selection';
import type { UnfinishedSession } from '@/lib/workout-session';

const palette = Colors.dark;

type UnfinishedSessionCardProps = {
  session: UnfinishedSession;
  label: string;
  disabled?: boolean;
  resumeLabel?: string;
  discardLabel?: string;
  onResume: (session: UnfinishedSession) => void;
  onDiscard: (session: UnfinishedSession) => void;
};

export function confirmDiscardUnfinishedSession(
  session: UnfinishedSession,
  onConfirm: () => void,
): void {
  const started = formatUnfinishedSessionWhen(session.startedAt);

  Alert.alert(
    `Discard ${session.name}?`,
    `This discards the unfinished ${session.name} workout started ${started}. Completed workouts stay saved.`,
    [
      {
        text: 'Cancel',
        style: 'cancel',
        onPress: () => {
          applyDiscardConfirmation('cancel', onConfirm);
        },
      },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          applyDiscardConfirmation('discard', onConfirm);
        },
      },
    ],
  );
}

export function UnfinishedSessionCard({
  session,
  label,
  disabled = false,
  resumeLabel = 'Resume Workout',
  discardLabel = 'Discard workout',
  onResume,
  onDiscard,
}: UnfinishedSessionCardProps) {
  const started = formatUnfinishedSessionWhen(session.startedAt);

  return (
    <Card style={styles.card}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.name}>{session.name}</Text>
      {session.subtitle ? <Text style={styles.detail}>{session.subtitle}</Text> : null}
      <Text style={styles.detail}>Started {started}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Resume ${session.name}. Started ${started}`}
        disabled={disabled}
        onPress={() => onResume(session)}
        style={({ pressed }) => [styles.resumeButton, (pressed || disabled) && styles.pressed]}>
        <Text style={styles.resumeLabel}>{resumeLabel}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Discard ${session.name}`}
        disabled={disabled}
        onPress={() => onDiscard(session)}
        style={({ pressed }) => [styles.discardButton, (pressed || disabled) && styles.pressed]}>
        <Text style={styles.discardLabel}>{discardLabel}</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 4,
  },
  label: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  name: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  detail: {
    color: palette.muted,
    fontSize: 16,
  },
  resumeButton: {
    backgroundColor: palette.accent,
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    marginTop: 12,
  },
  resumeLabel: {
    color: palette.accentText,
    fontSize: 20,
    fontWeight: '800',
  },
  discardButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  discardLabel: {
    color: palette.muted,
    fontSize: 16,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
});
