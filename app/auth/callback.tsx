import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { AuthLoadingScreen } from '@/components/auth-loading';
import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { isAuthCallbackUrl } from '@/lib/auth-redirect';
import {
  createSessionFromUrl,
  parseAuthCallbackParams,
} from '@/lib/auth-session-from-url';
import { hasPasswordResetPending, isRecoveryAuthUrl } from '@/lib/password-recovery';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const palette = Colors.dark;

const handledCallbackKeys = new Set<string>();

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

  return `${Linking.createURL('auth/callback')}?${queryString}`;
}

function callbackIdentity(url: string): string {
  const params = parseAuthCallbackParams(url);
  return params.code || params.token_hash || params.access_token || url;
}

function pickCallbackUrl(
  linkingUrl: string | null,
  routeParams: Record<string, string | string[]>,
  initialUrl: string | null,
): string | null {
  const candidates = [
    linkingUrl,
    paramsToUrl(routeParams),
    initialUrl,
  ].filter((value): value is string => Boolean(value && isAuthCallbackUrl(value)));

  return (
    candidates.find((url) => {
      const params = parseAuthCallbackParams(url);
      return Boolean(params.code || params.token_hash || (params.access_token && params.refresh_token));
    }) ??
    candidates[0] ??
    null
  );
}

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { beginPasswordRecovery } = useAuth();
  const routeParams = useLocalSearchParams<Record<string, string | string[]>>();
  const routeParamKey = JSON.stringify(routeParams);
  const linkingUrl = Linking.useLinkingURL();
  const beginPasswordRecoveryRef = useRef(beginPasswordRecovery);
  const routerRef = useRef(router);
  const didLogMount = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isHandling, setIsHandling] = useState(true);

  beginPasswordRecoveryRef.current = beginPasswordRecovery;
  routerRef.current = router;

  if (!didLogMount.current) {
    didLogMount.current = true;
    console.log('[AuthPKCE] callback component mounted');
    console.log('[AuthPKCE] router params present:', Object.keys(routeParams).length > 0);
    console.log('[AuthPKCE] linking URL present:', Boolean(linkingUrl));
  }

  const candidateHint = linkingUrl ?? paramsToUrl(routeParams);
  const callbackType = candidateHint ? parseAuthCallbackParams(candidateHint).type : undefined;
  const isRecoveryCallback = callbackType === 'recovery';

  useEffect(() => {
    let isMounted = true;

    console.log('[AuthPKCE] callback effect running');
    console.log('[AuthPKCE] router params present:', Object.keys(JSON.parse(routeParamKey)).length > 0);
    console.log('[AuthPKCE] linking URL present:', Boolean(linkingUrl));

    async function handleIncomingUrl() {
      const params = JSON.parse(routeParamKey) as Record<string, string | string[]>;
      const candidate = pickCallbackUrl(
        linkingUrl,
        params,
        await Linking.getInitialURL(),
      );

      if (!candidate) {
        console.log('[AuthPKCE] callback received: false (no candidate URL)');
        return;
      }

      const identity = callbackIdentity(candidate);

      if (handledCallbackKeys.has(identity)) {
        console.log('[AuthPKCE] callback already handled; skipping duplicate');
        const pendingReset = await hasPasswordResetPending();
        const { data } = await supabase.auth.getSession();

        if (!isMounted) {
          return;
        }

        if (data.session && (pendingReset || isRecoveryAuthUrl(candidate))) {
          await beginPasswordRecoveryRef.current();
          routerRef.current.replace('/reset-password');
          return;
        }

        if (data.session) {
          routerRef.current.replace('/');
        }

        return;
      }

      handledCallbackKeys.add(identity);
      setIsHandling(true);
      setErrorMessage(null);
      console.log('[AuthPKCE] callback received');

      const result = await createSessionFromUrl(candidate);

      if (!isMounted) {
        return;
      }

      if (!result.ok) {
        handledCallbackKeys.delete(identity);
        setErrorMessage(result.error);
        setIsHandling(false);
        return;
      }

      const pendingReset = await hasPasswordResetPending();
      const isRecovery = result.isRecovery || pendingReset || isRecoveryAuthUrl(candidate);

      if (isRecovery) {
        await beginPasswordRecoveryRef.current();
        routerRef.current.replace('/reset-password');
        return;
      }

      routerRef.current.replace('/');
    }

    const timeoutId = setTimeout(() => {
      if (isMounted && handledCallbackKeys.size === 0) {
        setErrorMessage('This confirmation link is missing auth details.');
        setIsHandling(false);
      }
    }, 1500);

    void handleIncomingUrl();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [linkingUrl, routeParamKey]);

  if (isHandling && !errorMessage) {
    return <AuthLoadingScreen />;
  }

  return (
    <Screen>
      <Text style={styles.kicker}>SyncSetRep</Text>
      <Text style={styles.title}>{isRecoveryCallback ? 'Password recovery' : 'Email link'}</Text>
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
