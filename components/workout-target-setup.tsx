import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '@/constants/theme';
import {
  SUGGESTED_REPS,
  SUGGESTED_SETS,
  SUGGESTION_NOTE,
  SUGGESTION_REPS_NOTE,
  SUGGESTION_SETS_NOTE,
} from '@/lib/workout-today';

const palette = Colors.dark;

export function WorkoutTargetSetup(props: {
  askSets: boolean;
  askReps: boolean;
  disabled: boolean;
  onAccept: (setsText: string, repsText: string) => void;
}) {
  const [setsText, setSetsText] = useState(String(SUGGESTED_SETS));
  const [repsText, setRepsText] = useState(String(SUGGESTED_REPS));
  if (!props.askSets && !props.askReps) {
    return null;
  }
  const note = props.askSets && props.askReps ? SUGGESTION_NOTE : props.askSets ? SUGGESTION_SETS_NOTE : SUGGESTION_REPS_NOTE;
  return (
    <View style={styles.box}>
      <Text style={styles.note}>{note}</Text>
      <View style={styles.row}>
        {props.askSets ? (
          <TextInput
            accessibilityLabel="Suggested sets"
            editable={!props.disabled}
            keyboardType="number-pad"
            onChangeText={setSetsText}
            placeholder="Sets"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={setsText}
          />
        ) : null}
        {props.askReps ? (
          <TextInput
            accessibilityLabel="Suggested reps"
            editable={!props.disabled}
            keyboardType="number-pad"
            onChangeText={setRepsText}
            placeholder="Reps"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={repsText}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use these targets for today"
          disabled={props.disabled}
          onPress={() => props.onAccept(setsText, repsText)}
          style={styles.button}>
          <Text style={styles.buttonLabel}>Use for today</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: 8,
  },
  note: {
    color: palette.muted,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    minWidth: 72,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    paddingHorizontal: 10,
  },
  button: {
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: palette.accent,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    color: palette.accentText,
    fontSize: 14,
    fontWeight: '800',
  },
});
