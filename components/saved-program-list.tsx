import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import {
  requestProgramSwitch,
  savedProgramListItems,
  UNFINISHED_WORKOUT_SWITCH_MESSAGE,
  USE_ROUTINE_LABEL,
  type ProgramSwitchPrompt,
  type SavedProgramSummary,
} from '@/lib/import/manual-program';

const palette = Colors.dark;

type SavedProgramListProps = {
  programs: readonly SavedProgramSummary[];
  isLoading: boolean;
  errorMessage: string | null;
  switchError: string | null;
  isSwitching: boolean;
  onConfirmSwitch: (programId: string) => void;
};

export function SavedProgramList({
  programs,
  isLoading,
  errorMessage,
  switchError,
  isSwitching,
  onConfirmSwitch,
}: SavedProgramListProps) {
  const items = savedProgramListItems(programs);
  const [prompt, setPrompt] = useState<ProgramSwitchPrompt | null>(null);

  function askToSwitch(programId: string) {
    if (isSwitching) {
      return;
    }
    const decision = requestProgramSwitch(programs, programId);
    if (decision.ok) {
      setPrompt(decision.prompt);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>Saved programs</Text>
      <Text style={styles.subtitle}>
        Choose a saved routine only after confirming. {UNFINISHED_WORKOUT_SWITCH_MESSAGE}
      </Text>

      {isLoading ? <Text style={styles.status}>Loading saved programs...</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      {switchError ? <Text style={styles.error}>{switchError}</Text> : null}
      {!isLoading && !errorMessage && items.length === 0 ? (
        <Text style={styles.status}>No saved programs yet.</Text>
      ) : null}

      {items.map((item) => (
        <Card key={item.id}>
          <Text
            accessibilityLabel={`${item.statusLabel}. ${item.name}`}
            style={styles.statusLabel}>
            {item.statusLabel}
          </Text>
          <Text style={styles.name}>{item.name}</Text>
          {item.offerSwitch ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${USE_ROUTINE_LABEL}. ${item.name}`}
              disabled={isSwitching}
              onPress={() => askToSwitch(item.id)}
              style={({ pressed }) => [styles.switchButton, pressed && styles.pressed]}>
              <Text style={styles.switchLabel}>{USE_ROUTINE_LABEL}</Text>
            </Pressable>
          ) : null}
        </Card>
      ))}

      <Modal
        animationType="slide"
        onRequestClose={() => setPrompt(null)}
        transparent
        visible={prompt != null}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.promptTitle}>{prompt?.title}</Text>
            <Text style={styles.promptBody}>{prompt?.body}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={prompt?.confirmLabel ?? USE_ROUTINE_LABEL}
              disabled={isSwitching || prompt == null}
              onPress={() => {
                if (!prompt) {
                  return;
                }
                const programId = prompt.programId;
                setPrompt(null);
                onConfirmSwitch(programId);
              }}
              style={({ pressed }) => [styles.confirmButton, pressed && styles.pressed]}>
              <Text style={styles.confirmLabel}>{prompt?.confirmLabel ?? USE_ROUTINE_LABEL}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={prompt?.cancelLabel ?? 'Keep the current program'}
              disabled={isSwitching}
              onPress={() => setPrompt(null)}
              style={({ pressed }) => [styles.switchButton, pressed && styles.pressed]}>
              <Text style={styles.switchLabel}>{prompt?.cancelLabel ?? 'Keep the current program'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  },
  status: {
    color: palette.muted,
    fontSize: 16,
  },
  error: {
    color: palette.text,
    fontSize: 16,
  },
  statusLabel: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  name: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 6,
  },
  switchButton: {
    minHeight: 48,
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  switchLabel: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  confirmButton: {
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  confirmLabel: {
    color: palette.accentText,
    fontSize: 16,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: palette.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    gap: 12,
  },
  promptTitle: {
    color: palette.text,
    fontSize: 22,
    fontWeight: '800',
  },
  promptBody: {
    color: palette.text,
    fontSize: 16,
  },
});
