import { StyleSheet, Text } from 'react-native';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';

const palette = Colors.dark;

const progressCards = [
  { title: 'Bodyweight', value: '—', hint: 'Log your first weigh-in' },
  { title: 'Waist', value: '—', hint: 'Add a waist measurement' },
  { title: 'Personal Records', value: '0 PRs', hint: 'PRs will show up after you train' },
];

export default function ProgressScreen() {
  return (
    <Screen>
      <Text style={styles.title}>Progress</Text>
      <Text style={styles.subtitle}>Track body stats and lifting PRs.</Text>

      {progressCards.map((card) => (
        <Card key={card.title} style={styles.card}>
          <Text style={styles.cardTitle}>{card.title}</Text>
          <Text style={styles.cardValue}>{card.value}</Text>
          <Text style={styles.cardHint}>{card.hint}</Text>
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
    marginBottom: 4,
  },
  card: {
    minHeight: 120,
    justifyContent: 'center',
    gap: 6,
  },
  cardTitle: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cardValue: {
    color: palette.text,
    fontSize: 28,
    fontWeight: '800',
  },
  cardHint: {
    color: palette.muted,
    fontSize: 16,
  },
});
