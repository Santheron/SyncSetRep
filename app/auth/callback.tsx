import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { AuthLoadingScreen } from '@/components/auth-loading';
import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { isAuthCallbackUrl } from '@/lib/auth-redirect';
import { createSessionFromUrl } from '@/lib/auth-session-from-url';

WebBrowser.maybeCompleteAuthSession();

const palette = Colors.dark;

function paramsToUrl(params: Record<string, string | string[]>): string | null {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const nextValue = Array.isArray(value) ? value[0] : value;

    if (nextValue) {
      query.set(key, nextValue);
    }
  }

  const queryString = query.toString();

  if (!queryString) {
    return null;
  }

  return `workouttracker://auth/callback?${queryString}`;
}

export default function AuthCallbackScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<Record<string, string | string[]>>();
  const routeParamKey = JSON.stringify(routeParams);
  const linkingUrl = Linking.useLinkingURL();
  const processedUrl = useRef<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isHandling, setIsHandling] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function handleIncomingUrl() {
      const params = JSON.parse(routeParamKey) as Record<string, string | string[]>;
      const candidate =
        (isAuthCallbackUrl(linkingUrl) ? linkingUrl : null) ??
        paramsToUrl(params) ??
        (await Linking.getInitialURL());

      if (!candidate || !isAuthCallbackUrl(candidate)) {
        return;
      }

      if (processedUrl.current === candidate) {
        return;
      }

      processedUrl.current = candidate;
      setIsHandling(true);
      setErrorMessage(null);

      const result = await createSessionFromUrl(candidate);

      if (!isMounted) {
        return;
      }

      if (!result.ok) {
        setErrorMessage(result.error);
        setIsHandling(false);
        return;
      }

      router.replace('/');
    }

    const timeoutId = setTimeout(() => {
      if (isMounted && !processedUrl.current) {
        setErrorMessage('This confirmation link is missing auth details.');
        setIsHandling(false);
      }
    }, 1500);

    void handleIncomingUrl();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [linkingUrl, routeParamKey, router]);

  if (isHandling && !errorMessage) {
    return <AuthLoadingScreen />;
  }

  return (
    <Screen>
      <Text style={styles.kicker}>Workout Tracker</Text>
      <Text style={styles.title}>Email confirmation</Text>
      <Text style={styles.error}>
        {errorMessage ?? 'Could not finish signing in from this link.'}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go to Sign In"
        onPress={() => router.replace('/sign-in')}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.buttonLabel}>Go to Sign In</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: palette.text,
    fontSize: 32,
    fontWeight: '800',
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
    marginTop: 8,
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
