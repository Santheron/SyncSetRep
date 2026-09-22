import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';

import { isAuthCallbackUrl } from '@/lib/auth-redirect';
import {
  createSessionFromUrl,
  parseAuthCallbackParams,
} from '@/lib/auth-session-from-url';
import { hasPasswordResetPending, isRecoveryAuthUrl } from '@/lib/password-recovery';

type RecoveryHandler = () => Promise<void>;

const processedUrls = new Set<string>();
const recoveryHandlers = new Set<RecoveryHandler>();
let listenerRegistered = false;

function safeUrlShape(url: string | null | undefined): string {
  if (!url) {
    return '(none)';
  }

  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    const withoutQuery = url.split('?')[0]?.split('#')[0];
    return withoutQuery || '(unparsed)';
  }
}

function logUrlShape(source: string, url: string | null) {
  if (!url) {
    console.log(`[AuthPKCE] ${source} URL present: false`);
    console.log(`[DeepLink] ${source} result present: false`);
    return;
  }

  const params = parseAuthCallbackParams(url);

  console.log(`[AuthPKCE] ${source} URL present: true`);
  console.log(`[DeepLink] ${source} result present: true`);
  console.log(`[DeepLink] ${source} URL scheme/host/path only:`, safeUrlShape(url));
  console.log(`[AuthPKCE] ${source} has code:`, Boolean(params.code));
  console.log(`[AuthPKCE] ${source} has error param:`, Boolean(params.error || params.error_description));
  console.log(`[AuthPKCE] ${source} callback type:`, params.type ?? 'none');
}

async function handleUrl(url: string | null, source: string) {
  console.log(`[AuthPKCE] ${source}`);
  logUrlShape(source, url);

  if (!url || !isAuthCallbackUrl(url)) {
    return;
  }

  const identity = url.split('#')[0];

  if (processedUrls.has(identity)) {
    console.log('[DeepLink] skipping already handled URL');
    return;
  }

  processedUrls.add(identity);

  const result = await createSessionFromUrl(url);

  if (!result.ok) {
    processedUrls.delete(identity);
    console.log('[AuthPKCE] root handler did not complete session');
    return;
  }

  const pendingReset = await hasPasswordResetPending();
  const isRecovery = result.isRecovery || pendingReset || isRecoveryAuthUrl(url);

  console.log('[AuthPKCE] classified as recovery:', isRecovery);

  if (isRecovery) {
    for (const onRecovery of recoveryHandlers) {
      await onRecovery();
    }
    router.replace('/reset-password');
    return;
  }

  router.replace('/');
}

function registerEarlyLinkingListener() {
  if (listenerRegistered) {
    return;
  }

  listenerRegistered = true;
  console.log('[DeepLink] listener registered');

  Linking.addEventListener('url', (event) => {
    console.log('[DeepLink] Linking event received');
    console.log('[DeepLink] event URL scheme/host/path only:', safeUrlShape(event.url));
    void handleUrl(event.url, 'root linking event');
  });

  const expoUrl = Linking.getLinkingURL();
  console.log('[DeepLink] getLinkingURL present:', Boolean(expoUrl));
  console.log('[DeepLink] getLinkingURL scheme/host/path only:', safeUrlShape(expoUrl));

  console.log('[DeepLink] getInitialURL started');
  void Linking.getInitialURL()
    .then((url) => {
      console.log('[DeepLink] getInitialURL result present:', Boolean(url));
      console.log('[DeepLink] initial URL scheme/host/path only:', safeUrlShape(url));
      void handleUrl(url, 'root initial URL');
    })
    .catch((error: unknown) => {
      console.log(
        '[DeepLink] getInitialURL failed:',
        error instanceof Error ? error.message : 'unknown',
      );
    });
}

registerEarlyLinkingListener();

AppState.addEventListener('change', (state) => {
  console.log('[DeepLink] app state:', state);
});

export function subscribeAuthDeepLinks(options: {
  onRecovery: RecoveryHandler;
}): () => void {
  recoveryHandlers.add(options.onRecovery);

  const expoUrl = Linking.getLinkingURL();
  if (expoUrl) {
    void handleUrl(expoUrl, 'subscribe getLinkingURL');
  }

  return () => {
    recoveryHandlers.delete(options.onRecovery);
  };
}

export function DeepLinkBridge() {
  const linkingUrl = Linking.useLinkingURL();
  const lastUrl = useRef<string | null>(null);

  useEffect(() => {
    if (!linkingUrl || linkingUrl === lastUrl.current) {
      return;
    }

    lastUrl.current = linkingUrl;
    console.log('[DeepLink] useLinkingURL changed');
    console.log('[DeepLink] useLinkingURL scheme/host/path only:', safeUrlShape(linkingUrl));
    void handleUrl(linkingUrl, 'useLinkingURL');
  }, [linkingUrl]);

  return null;
}
