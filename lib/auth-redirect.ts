import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { NativeModules } from 'react-native';

import {
  readExpoConfigIdentity,
  selectAuthRedirect,
  type AuthRedirectDiagnostics,
} from '@/lib/auth-scheme';

export type { AuthRedirectDiagnostics, AuthSchemeSource } from '@/lib/auth-scheme';

function linkingCallbackUrl(): string | null {
  try {
    return Linking.createURL('auth/callback');
  } catch {
    return null;
  }
}

function embeddedManifest(): unknown {
  const constants = (NativeModules as { ExponentConstants?: { manifest?: unknown } }).ExponentConstants;
  return constants?.manifest;
}

export function getAuthRedirectDiagnostics(): AuthRedirectDiagnostics {
  const embedded = readExpoConfigIdentity(embeddedManifest());
  const configured = readExpoConfigIdentity(Constants.expoConfig);

  return selectAuthRedirect({
    appVariant: process.env.APP_VARIANT,
    dev: __DEV__,
    executionEnvironment: Constants.executionEnvironment ?? null,
    embeddedAndroidPackage: embedded.androidPackage,
    embeddedIosBundle: embedded.iosBundle,
    embeddedScheme: embedded.scheme,
    configuredAndroidPackage: configured.androidPackage,
    configuredScheme: configured.scheme,
    linkingUrl: linkingCallbackUrl(),
  });
}

export function resolveAuthScheme(): string {
  return getAuthRedirectDiagnostics().scheme;
}

export function getAuthEmailRedirectTo(): string {
  return getAuthRedirectDiagnostics().redirectTo;
}

export function logAuthRedirectTarget(): string {
  const diagnostics = getAuthRedirectDiagnostics();

  console.log('[AuthRedirect] scheme:', diagnostics.scheme);
  console.log('[AuthRedirect] redirectTo:', diagnostics.redirectTo);
  console.log('[AuthRedirect] source:', diagnostics.source);
  console.log('[AuthRedirect] APP_VARIANT:', diagnostics.appVariant ?? '(unset)');
  console.log('[AuthRedirect] __DEV__:', diagnostics.dev);
  console.log('[AuthRedirect] executionEnvironment:', diagnostics.executionEnvironment ?? '(none)');
  console.log('[AuthRedirect] embeddedAndroidPackage:', diagnostics.embeddedAndroidPackage ?? '(none)');
  console.log('[AuthRedirect] embeddedScheme:', diagnostics.embeddedScheme ?? '(none)');
  console.log('[AuthRedirect] configuredAndroidPackage:', diagnostics.configuredAndroidPackage ?? '(none)');
  console.log('[AuthRedirect] configuredScheme:', diagnostics.configuredScheme ?? '(none)');

  if (
    diagnostics.configuredScheme &&
    diagnostics.configuredScheme !== diagnostics.scheme
  ) {
    console.log(
      '[AuthRedirect] Metro scheme differs from the scheme sent to Supabase:',
      diagnostics.configuredScheme,
    );
  }

  return diagnostics.redirectTo;
}

export function isAuthCallbackUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  return (
    url.includes('auth/callback') ||
    url.includes('access_token=') ||
    url.includes('refresh_token=') ||
    url.includes('code=') ||
    url.includes('token_hash=') ||
    url.includes('error_description=') ||
    url.includes('error=')
  );
}
