import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '@/components/screen';
import { Colors } from '@/constants/theme';
import type { RestTimerStatus } from '@/lib/rest-timer';

const palette = Colors.dark;

type RestTimerCardProps = {
  status: RestTimerStatus;
  formatted: string;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
  onAddThirty: () => void;
  onSkip: () => void;
};

export function RestTimerCard({
  status,
  formatted,
  onPause,
  onResume,
  onReset,
  onAddThirty,
  onSkip,
}: RestTimerCardProps) {
  const isComplete = status === 'complete';

  return (
    <Card style={[styles.card, isComplete && styles.cardComplete]}>
      <Text style={[styles.kicker, isComplete && styles.kickerComplete]}>
        {isComplete ? 'Rest complete' : 'Rest'}
      </Text>
      <Text style={[styles.time, isComplete && styles.timeComplete]}>{formatted}</Text>

      <View style={styles.controls}>
        <TimerButton
          disabled={status !== 'running'}
          label="Pause"
          onPress={onPause}
        />
        <TimerButton
          disabled={status !== 'paused'}
          label="Resume"
          onPress={onResume}
        />
        <TimerButton label="Reset" onPress={onReset} />
        <TimerButton label="+30 sec" onPress={onAddThirty} />
        <TimerButton
          disabled={status === 'idle' || isComplete}
          label="Skip"
          onPress={onSkip}
        />
      </View>
    </Card>
  );
}

function TimerButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text style={[styles.buttonLabel, disabled && styles.buttonLabelDisabled]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 4,
  },
  cardComplete: {
    borderColor: palette.accent,
  },
  kicker: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  kickerComplete: {
    color: palette.accent,
  },
  time: {
    color: palette.text,
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: 1,
  },
  timeComplete: {
    color: palette.accent,
  },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.accent,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    borderColor: palette.border,
  },
  buttonLabel: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  buttonLabelDisabled: {
    color: palette.muted,
  },
  pressed: {
    opacity: 0.85,
  },
});
