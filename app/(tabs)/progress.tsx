import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import {
  formatMetricNumber,
  insertBodyMetric,
  listBodyMetrics,
  parseOptionalMetric,
  type BodyMetric,
} from '@/lib/body-metrics';
import { formatWeight } from '@/lib/warmup';
import { formatWorkoutDate } from '@/lib/workout-format';
import { listPersonalRecords, type PersonalRecord } from '@/lib/workout-session';

const palette = Colors.dark;

export default function ProgressScreen() {
  const [metrics, setMetrics] = useState<BodyMetric[]>([]);
  const [records, setRecords] = useState<PersonalRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');
  const [bodyFat, setBodyFat] = useState('');

  const latest = metrics[0] ?? null;

  const loadProgress = useCallback(async () => {
    const [metricsResult, recordsResult] = await Promise.all([
      listBodyMetrics(),
      listPersonalRecords(),
    ]);

    if (!metricsResult.ok) {
      setErrorMessage(metricsResult.error);
      setMetrics([]);
    } else {
      setMetrics(metricsResult.data);
    }

    if (!recordsResult.ok) {
      setErrorMessage(recordsResult.error);
      setRecords([]);
    } else if (metricsResult.ok) {
      setErrorMessage(null);
      setRecords(recordsResult.data);
    } else {
      setRecords(recordsResult.data);
    }

    setIsLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProgress();
    }, [loadProgress]),
  );

  async function saveMetrics() {
    if (isSaving) {
      return;
    }

    const parsedWeight = parseOptionalMetric(weight);
    const parsedWaist = parseOptionalMetric(waist);
    const parsedBodyFat = parseOptionalMetric(bodyFat);

    if (!parsedWeight.ok) {
      setErrorMessage('Enter a valid body weight, or leave it blank.');
      return;
    }

    if (!parsedWaist.ok) {
      setErrorMessage('Enter a valid waist measurement, or leave it blank.');
      return;
    }

    if (!parsedBodyFat.ok) {
      setErrorMessage('Enter a valid body fat percentage, or leave it blank.');
      return;
    }

    if (
      parsedWeight.value === null &&
      parsedWaist.value === null &&
      parsedBodyFat.value === null
    ) {
      setErrorMessage('Enter body weight, waist, or body fat before saving.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    const result = await insertBodyMetric({
      bodyweight: parsedWeight.value,
      waist: parsedWaist.value,
      body_fat: parsedBodyFat.value,
    });

    if (!result.ok) {
      setErrorMessage(result.error);
      setIsSaving(false);
      return;
    }

    setWeight('');
    setWaist('');
    setBodyFat('');
    setIsSaving(false);
    await loadProgress();
  }

  return (
    <Screen>
      <Text style={styles.title}>Progress</Text>
      <Text style={styles.subtitle}>Track body stats and lifting PRs.</Text>

      {isLoading ? <Text style={styles.status}>Loading progress...</Text> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Bodyweight</Text>
        <Text style={styles.cardValue}>
          {latest?.bodyweight != null ? `${formatMetricNumber(latest.bodyweight)} lb` : '—'}
        </Text>
        <Text style={styles.cardHint}>
          {latest ? formatWorkoutDate(latest.recorded_at) : 'Log your first weigh-in'}
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Waist</Text>
        <Text style={styles.cardValue}>
          {latest?.waist != null ? `${formatMetricNumber(latest.waist)} in` : '—'}
        </Text>
        <Text style={styles.cardHint}>
          {latest?.waist != null ? formatWorkoutDate(latest.recorded_at) : 'Add a waist measurement'}
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Personal Records</Text>
        <Text style={styles.cardValue}>
          {records.length === 0 ? '0 PRs' : `${records.length} PRs`}
        </Text>
        {records.length === 0 ? (
          <Text style={styles.cardHint}>PRs will show up after you train</Text>
        ) : (
          records.slice(0, 5).map((record) => (
            <Text key={record.exerciseName} style={styles.prLine}>
              {record.exerciseName}: {formatWeight(record.heaviestWeight)} lb × {record.bestReps}
            </Text>
          ))
        )}
      </Card>

      <Card style={styles.logCard}>
        <Text style={styles.cardTitle}>Log body metrics</Text>
        <Field
          keyboardType="decimal-pad"
          label="Body weight (lb)"
          onChangeText={setWeight}
          placeholder="185"
          value={weight}
        />
        <Field
          keyboardType="decimal-pad"
          label="Waist (in)"
          onChangeText={setWaist}
          placeholder="34"
          value={waist}
        />
        <Field
          keyboardType="decimal-pad"
          label="Body fat % (optional)"
          onChangeText={setBodyFat}
          placeholder="18"
          value={bodyFat}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save body metrics"
          disabled={isSaving}
          onPress={() => {
            void saveMetrics();
          }}
          style={({ pressed }) => [
            styles.saveButton,
            (pressed || isSaving) && styles.pressed,
          ]}>
          <Text style={styles.saveButtonLabel}>{isSaving ? 'Saving...' : 'Save'}</Text>
        </Pressable>
      </Card>

      <Text style={styles.listLabel}>Recent entries</Text>
      {isLoading ? (
        <Text style={styles.status}>Loading entries...</Text>
      ) : metrics.length === 0 ? (
        <Text style={styles.status}>No body metrics yet</Text>
      ) : (
        metrics.map((metric) => (
          <Card key={metric.id} style={styles.row}>
            <Text style={styles.date}>{formatWorkoutDate(metric.recorded_at)}</Text>
            <Text style={styles.summary}>
              {[
                metric.bodyweight != null ? `${formatMetricNumber(metric.bodyweight)} lb` : null,
                metric.waist != null ? `${formatMetricNumber(metric.waist)} in waist` : null,
                metric.body_fat != null ? `${formatMetricNumber(metric.body_fat)}% BF` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'decimal-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={value}
      />
    </View>
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
  status: {
    color: palette.muted,
    fontSize: 16,
  },
  error: {
    color: palette.text,
    fontSize: 16,
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
  prLine: {
    color: palette.muted,
    fontSize: 16,
  },
  logCard: {
    gap: 12,
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
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.background,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 12,
  },
  saveButton: {
    backgroundColor: palette.accent,
    minHeight: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
  saveButtonLabel: {
    color: palette.accentText,
    fontSize: 18,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
  listLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 8,
  },
  row: {
    minHeight: 72,
    justifyContent: 'center',
    gap: 4,
  },
  date: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '600',
  },
  summary: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
