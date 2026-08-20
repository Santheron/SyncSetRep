import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import {
  addCardioLog,
  CARDIO_ACTIVITY_TYPES,
  type CardioActivityType,
} from '@/lib/cardio';

const palette = Colors.dark;

export default function LogCardioScreen() {
  const router = useRouter();
  const [activityType, setActivityType] = useState<CardioActivityType>('Walking');
  const [duration, setDuration] = useState('');
  const [distance, setDistance] = useState('');
  const [speed, setSpeed] = useState('');
  const [incline, setIncline] = useState('');
  const [calories, setCalories] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function optionalValue(value: string): string | null {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  function saveLog() {
    const durationMinutes = Number(duration.trim());

    if (!duration.trim() || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setErrorMessage('Enter duration in minutes.');
      return;
    }

    addCardioLog({
      activityType,
      durationMinutes,
      distance: optionalValue(distance),
      speed: optionalValue(speed),
      incline: optionalValue(incline),
      calories: optionalValue(calories),
      notes: optionalValue(notes),
    });

    router.back();
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}>
      <Screen keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Log Cardio</Text>
        <Text style={styles.subtitle}>Save a session to your recent cardio list.</Text>

        <Text style={styles.fieldLabel}>Activity Type</Text>
        <View style={styles.activityWrap}>
          {CARDIO_ACTIVITY_TYPES.map((type) => {
            const isSelected = type === activityType;

            return (
              <Pressable
                key={type}
                accessibilityRole="button"
                accessibilityLabel={type}
                onPress={() => setActivityType(type)}
                style={({ pressed }) => [
                  styles.activityChip,
                  isSelected && styles.activityChipSelected,
                  pressed && styles.pressed,
                ]}>
                <Text
                  style={[
                    styles.activityChipLabel,
                    isSelected && styles.activityChipLabelSelected,
                  ]}>
                  {type}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Field
          keyboardType="decimal-pad"
          label="Duration (minutes)"
          onChangeText={setDuration}
          placeholder="30"
          value={duration}
        />
        <Field
          keyboardType="decimal-pad"
          label="Distance (optional)"
          onChangeText={setDistance}
          placeholder="Miles"
          value={distance}
        />
        <Field
          keyboardType="decimal-pad"
          label="Speed (optional)"
          onChangeText={setSpeed}
          placeholder="mph"
          value={speed}
        />
        <Field
          keyboardType="decimal-pad"
          label="Incline % (optional)"
          onChangeText={setIncline}
          placeholder="8"
          value={incline}
        />
        <Field
          keyboardType="decimal-pad"
          label="Calories (optional)"
          onChangeText={setCalories}
          placeholder="220"
          value={calories}
        />
        <Field
          label="Notes (optional)"
          multiline
          onChangeText={setNotes}
          placeholder="How it felt"
          value={notes}
        />

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save cardio"
          onPress={saveLog}
          style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}>
          <Text style={styles.saveButtonLabel}>Save Cardio</Text>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'decimal-pad';
  multiline?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        style={[styles.input, multiline && styles.notesInput]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: palette.background,
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
  field: {
    gap: 8,
  },
  fieldLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  activityWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  activityChip: {
    minHeight: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  activityChipSelected: {
    backgroundColor: palette.accent,
    borderColor: palette.accent,
  },
  activityChipLabel: {
    color: palette.text,
    fontSize: 14,
    fontWeight: '700',
  },
  activityChipLabelSelected: {
    color: palette.accentText,
  },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 12,
  },
  notesInput: {
    minHeight: 96,
    paddingTop: 12,
    paddingBottom: 12,
  },
  error: {
    color: palette.text,
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: palette.accent,
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    marginTop: 8,
  },
  saveButtonLabel: {
    color: palette.accentText,
    fontSize: 20,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
});
