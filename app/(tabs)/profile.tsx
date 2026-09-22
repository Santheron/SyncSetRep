import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Card, Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getOwnProfile } from '@/lib/profile';

const palette = Colors.dark;

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function loadProfile() {
        const profile = await getOwnProfile();

        if (!isMounted) {
          return;
        }

        setDisplayName(profile?.display_name ?? user?.user_metadata?.display_name ?? null);
      }

      void loadProfile();

      return () => {
        isMounted = false;
      };
    }, [user]),
  );

  async function handleSignOut() {
    if (isSigningOut) {
      return;
    }

    setIsSigningOut(true);
    setErrorMessage(null);

    const result = await signOut();

    if (result.error) {
      setErrorMessage(result.error);
      setIsSigningOut(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>Profile</Text>
      <Text style={styles.subtitle}>Your SyncSetRep account</Text>

      <Card>
        <View style={styles.row}>
          <Text style={styles.label}>Display name</Text>
          <Text style={styles.value}>{displayName || '—'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{user?.email ?? '—'}</Text>
        </View>
      </Card>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign Out"
        disabled={isSigningOut}
        onPress={() => {
          void handleSignOut();
        }}
        style={({ pressed }) => [styles.button, (pressed || isSigningOut) && styles.pressed]}>
        <Text style={styles.buttonLabel}>{isSigningOut ? 'Signing out...' : 'Sign Out'}</Text>
      </Pressable>
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
  row: {
    gap: 6,
    marginBottom: 16,
  },
  label: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  value: {
    color: palette.text,
    fontSize: 20,
    fontWeight: '700',
  },
  error: {
    color: palette.text,
    fontSize: 16,
  },
  button: {
    backgroundColor: palette.accent,
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
  },
  buttonLabel: {
    color: palette.accentText,
    fontSize: 20,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
});
