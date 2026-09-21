import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Card } from '@/components/screen';
import { Colors } from '@/constants/theme';
import {
  canOpenHealthConnectSettings,
  connectHealthConnect,
  formatActiveCalories,
  formatDistanceKm,
  formatSteps,
  loadHealthConnectSnapshot,
  openHealthConnectPermissionSettings,
  syncHealthConnect,
  type HealthConnectSnapshot,
} from '@/lib/health-connect';

const palette = Colors.dark;

export function HealthConnectCard() {
  const [snapshot, setSnapshot] = useState<HealthConnectSnapshot | { kind: 'loading' }>({
    kind: 'loading',
  });
  const [isWorking, setIsWorking] = useState(false);

  const refresh = useCallback(async (next: Promise<HealthConnectSnapshot>) => {
    setIsWorking(true);
    const result = await next;
    setSnapshot(result);
    setIsWorking(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function load() {
        const result = await loadHealthConnectSnapshot();

        if (isMounted) {
          setSnapshot(result);
        }
      }

      void load();

      return () => {
        isMounted = false;
      };
    }, []),
  );

  function renderBody() {
    if (snapshot.kind === 'loading') {
      return <Text style={styles.status}>Checking Health Connect...</Text>;
    }

    if (snapshot.kind === 'unavailable') {
      return <Text style={styles.status}>{snapshot.message}</Text>;
    }

    if (snapshot.kind === 'disconnected') {
      return (
        <>
          <Text style={styles.status}>
            Connect Health Connect to automatically import activity from your phone.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Connect Health Connect"
            disabled={isWorking}
            onPress={() => {
              void refresh(connectHealthConnect());
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || isWorking) && styles.pressed,
            ]}>
            <Text style={styles.primaryButtonLabel}>
              {isWorking ? 'Connecting...' : 'Connect Health Connect'}
            </Text>
          </Pressable>
        </>
      );
    }

    if (snapshot.kind === 'denied' || snapshot.kind === 'error') {
      return (
        <>
          <Text style={styles.status}>{snapshot.message}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Connect Health Connect"
            disabled={isWorking}
            onPress={() => {
              void refresh(connectHealthConnect());
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || isWorking) && styles.pressed,
            ]}>
            <Text style={styles.primaryButtonLabel}>
              {isWorking ? 'Connecting...' : 'Try again'}
            </Text>
          </Pressable>
          {canOpenHealthConnectSettings ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open Health Connect settings"
              disabled={isWorking}
              onPress={() => {
                openHealthConnectPermissionSettings();
              }}
              style={({ pressed }) => [
                styles.secondaryButton,
                (pressed || isWorking) && styles.pressed,
              ]}>
              <Text style={styles.secondaryButtonLabel}>Open Health Connect settings</Text>
            </Pressable>
          ) : null}
        </>
      );
    }

    return (
      <>
        <Text style={styles.connected}>Health Connect connected</Text>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Steps</Text>
          <Text style={styles.statValue}>{formatSteps(snapshot.steps)}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Distance</Text>
          <Text style={styles.statValue}>{formatDistanceKm(snapshot.distanceKm)}</Text>
        </View>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Active Calories</Text>
          <Text style={styles.statValue}>{formatActiveCalories(snapshot.activeCaloriesKcal)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sync Now"
          disabled={isWorking}
          onPress={() => {
            void refresh(syncHealthConnect());
          }}
          style={({ pressed }) => [
            styles.secondaryButton,
            (pressed || isWorking) && styles.pressed,
          ]}>
          <Text style={styles.secondaryButtonLabel}>{isWorking ? 'Syncing...' : 'Sync Now'}</Text>
        </Pressable>
      </>
    );
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.sectionLabel}>Health Connect</Text>
      {renderBody()}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
  },
  sectionLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  connected: {
    color: palette.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  status: {
    color: palette.muted,
    fontSize: 16,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statLabel: {
    color: palette.muted,
    fontSize: 16,
  },
  statValue: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: palette.accent,
    minHeight: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  primaryButtonLabel: {
    color: palette.accentText,
    fontSize: 18,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.background,
  },
  secondaryButtonLabel: {
    color: palette.accent,
    fontSize: 18,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
});
