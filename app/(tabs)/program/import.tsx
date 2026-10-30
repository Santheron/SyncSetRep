import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { buttonPaletteForSurface } from '@/lib/ui/button-contrast';
import { importWorkoutDraft } from '@/lib/import/import-workout';
import { saveManualProgramForCurrentUser } from '@/lib/import/manual-program-client';
import type { ProgramReview } from '@/lib/import/review-editor';

const palette = Colors.dark;
const primaryButton = buttonPaletteForSurface('dark');

export default function ImportWorkoutScreen() {
  const [source, setSource] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const [review, setReview] = useState<ProgramReview | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  async function readDraft() {
    if (isWorking) {
      return;
    }
    setIsWorking(true);
    setMessages([]);
    setReview(null);
    const imported = await importWorkoutDraft(source);
    if (!imported.ok) {
      setMessages(imported.errors);
      setIsWorking(false);
      return;
    }
    setReview(imported.review);
    setMessages([
      `${imported.review.programName || 'Imported routine'} · ${imported.review.days.length} days. Workout history was not changed.`,
    ]);
    setIsWorking(false);
  }

  async function saveDraft() {
    if (isWorking || review == null) {
      return;
    }
    setIsWorking(true);
    const saved = await saveManualProgramForCurrentUser(review);
    setMessages(saved.ok ? [`Saved id ${saved.programId}. Workout history was not changed.`] : saved.errors);
    setIsWorking(false);
  }

  return (
    <Screen>
      <Text style={styles.title}>Import a workout</Text>
      <Text style={styles.body}>
        Paste one week. Reading a draft does not save it, and saving does not change workout history.
      </Text>
      <TextInput
        accessibilityLabel="Workout text"
        multiline
        onChangeText={setSource}
        placeholder="Paste one week of a workout"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={source}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Read workout text"
        disabled={isWorking}
        onPress={() => {
          void readDraft();
        }}
        style={styles.button}>
        <Text style={styles.buttonLabel}>{isWorking ? 'Working...' : 'Read workout text'}</Text>
      </Pressable>
      {review ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save imported routine"
          disabled={isWorking}
          onPress={() => {
            void saveDraft();
          }}
          style={styles.secondary}>
          <Text style={styles.secondaryLabel}>Save imported routine</Text>
        </Pressable>
      ) : null}
      {messages.map((message) => (
        <Text key={message} style={styles.body}>
          {message}
        </Text>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: palette.text,
    fontSize: 32,
    fontWeight: '800',
  },
  body: {
    color: palette.text,
    fontSize: 16,
  },
  input: {
    minHeight: 160,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    color: palette.text,
    fontSize: 16,
    padding: 16,
    textAlignVertical: 'top',
  },
  button: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: primaryButton.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonLabel: {
    color: primaryButton.label,
    fontSize: 16,
    fontWeight: '700',
  },
  secondary: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  secondaryLabel: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
