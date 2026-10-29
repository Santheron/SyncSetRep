import { StyleSheet, Text, View } from 'react-native';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { savedProgramListItems, type SavedProgramSummary } from '@/lib/import/manual-program';

const palette = Colors.dark;

type SavedProgramListProps = {
  programs: readonly SavedProgramSummary[];
  isLoading: boolean;
  errorMessage: string | null;
};

export function SavedProgramList({ programs, isLoading, errorMessage }: SavedProgramListProps) {
  const items = savedProgramListItems(programs);

  return (
    <Screen>
      <Text style={styles.title}>Saved programs</Text>
      <Text style={styles.subtitle}>Current and saved routines stay as they are. Nothing here switches programs.</Text>

      {isLoading ? <Text style={styles.status}>Loading saved programs...</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
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
        </Card>
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
});
