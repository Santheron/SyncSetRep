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
  CARDIO_ACTIVITY_TYPES,
  isCardioActivityType,
  parseOptionalNumber,
  setCardioSaveNotice,
  type CardioActivityType,
} from '@/lib/cardio';
import { supabase } from '@/lib/supabase';

const palette = Colors.dark;

export default function LogCardioScreen() {
  const router = useRouter();
  const [activityType, setActivityType] = useState<CardioActivityType>('Incline Walk');
  const [duration, setDuration] = useState('');
  const [distance, setDistance] = useState('');
  const [speed, setSpeed] = useState('');
  const [incline, setIncline] = useState('');
  const [calories, setCalories] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function optionalNotes(value: string): string | null {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  function parseOptionalField(label: string, value: string): number | null | false {
    const parsed = parseOptionalNumber(value);

    if (!parsed.ok) {
      setErrorMessage(`Enter a valid number for ${label}, or leave it blank.`);
      return false;
    }

    return parsed.value;
  }

  function resetForm() {
    setActivityType('Incline Walk');
    setDuration('');
    setDistance('');
    setSpeed('');
    setIncline('');
    setCalories('');
    setNotes('');
    setErrorMessage(null);
  }

  async function saveLog() {
    if (isSaving) {
      return;
    }

    if (!isCardioActivityType(activityType)) {
      setErrorMessage('Select an activity type.');
      return;
    }

    const durationMinutes = Number(duration.trim());

    if (!duration.trim() || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setErrorMessage('Duration must be greater than 0.');
      return;
    }

    const parsedDistance = parseOptionalField('distance', distance);
    const parsedSpeed = parseOptionalField('speed', speed);
    const parsedIncline = parseOptionalField('incline', incline);
    const parsedCalories = parseOptionalField('calories', calories);

    if (
      parsedDistance === false ||
      parsedSpeed === false ||
      parsedIncline === false ||
      parsedCalories === false
    ) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    const { error } = await supabase.from('cardio_sessions').insert({
      activity_type: activityType,
      started_at: new Date().toISOString(),
      duration_minutes: durationMinutes,
      distance_km: parsedDistance,
      incline_percent: parsedIncline,
      speed_kmh: parsedSpeed,
      calories: parsedCalories,
      notes: optionalNotes(notes),
    });

    if (error) {
      setErrorMessage(error.message);
      setIsSaving(false);
      return;
    }

    resetForm();
    setCardioSaveNotice();
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
          label="Distance (km) optional"
          onChangeText={setDistance}
          placeholder="2.5"
          value={distance}
        />
        <Field
          keyboardType="decimal-pad"
          label="Incline (%) optional"
          onChangeText={setIncline}
          placeholder="8"
          value={incline}
        />
        <Field
          keyboardType="decimal-pad"
          label="Speed (km/h) optional"
          onChangeText={setSpeed}
          placeholder="5.5"
          value={speed}
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
          disabled={isSaving}
          onPress={() => {
            void saveLog();
          }}
          style={({ pressed }) => [
            styles.saveButton,
            (pressed || isSaving) && styles.pressed,
          ]}>
          <Text style={styles.saveButtonLabel}>
            {isSaving ? 'Saving...' : 'Save Cardio'}
          </Text>
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
