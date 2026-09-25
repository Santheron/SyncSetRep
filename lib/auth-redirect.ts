import Constants from 'expo-constants';
import * as Linking from 'expo-linking';

const DEVELOPMENT_SCHEME = 'workouttracker-dev';
const PRODUCTION_SCHEME = 'workouttracker';
const DEVELOPMENT_ANDROID_PACKAGE = 'com.akagi253.workouttracker.dev';
const PRODUCTION_ANDROID_PACKAGE = 'com.akagi253.workouttracker';

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        return item.trim();
      }
    }
  }

  return null;
}

function installedAndroidPackage(): string | null {
  const platformAndroid = (
    Constants.platform as { android?: { package?: string } } | undefined
  )?.android?.package;

  return firstString(platformAndroid) ?? firstString(Constants.expoConfig?.android?.package);
}

function installedIosBundle(): string | null {
  return firstString(Constants.expoConfig?.ios?.bundleIdentifier);
}

export function resolveAuthScheme(): string {
  const variant = process.env.APP_VARIANT;

  if (variant === 'development') {
    return DEVELOPMENT_SCHEME;
  }

  if (variant === 'preview' || variant === 'production') {
    return PRODUCTION_SCHEME;
  }

  const androidPackage = installedAndroidPackage() ?? '';
  const iosBundle = installedIosBundle() ?? '';

  if (
    androidPackage === DEVELOPMENT_ANDROID_PACKAGE ||
    androidPackage.endsWith('.dev') ||
    iosBundle.endsWith('.dev')
  ) {
    return DEVELOPMENT_SCHEME;
  }

  if (androidPackage === PRODUCTION_ANDROID_PACKAGE) {
    return PRODUCTION_SCHEME;
  }

  const expoScheme = firstString(Constants.expoConfig?.scheme);

  if (expoScheme === DEVELOPMENT_SCHEME) {
    return DEVELOPMENT_SCHEME;
  }

  // Metro evaluates app.config.ts without APP_VARIANT, so expoConfig.scheme
  // becomes "workouttracker" even when the installed development APK uses
  // workouttracker-dev. Prefer the development scheme while JS is in __DEV__.
  if (__DEV__) {
    return DEVELOPMENT_SCHEME;
  }

  if (expoScheme === PRODUCTION_SCHEME) {
    return PRODUCTION_SCHEME;
  }

  if (expoScheme) {
    return expoScheme;
  }

  const created = Linking.createURL('auth/callback');
  if (created.startsWith(`${DEVELOPMENT_SCHEME}:`)) {
    return DEVELOPMENT_SCHEME;
  }
  if (created.startsWith(`${PRODUCTION_SCHEME}:`)) {
    return PRODUCTION_SCHEME;
  }

  return PRODUCTION_SCHEME;
}

export function getAuthEmailRedirectTo(): string {
  return `${resolveAuthScheme()}://auth/callback`;
}

export function logAuthRedirectTarget(): string {
  const url = getAuthEmailRedirectTo();
  console.log('[AuthRedirect] APP_VARIANT:', process.env.APP_VARIANT ?? '(unset)');
  console.log('[AuthRedirect] __DEV__:', __DEV__);
  console.log('[AuthRedirect] expoConfig.scheme:', JSON.stringify(Constants.expoConfig?.scheme ?? null));
  console.log('[AuthRedirect] android.package:', installedAndroidPackage() ?? '(none)');
  console.log('[AuthRedirect] scheme:', resolveAuthScheme());
  console.log('[AuthRedirect] redirectTo:', url);
  return url;
}

export const AUTH_EMAIL_REDIRECT_TO = getAuthEmailRedirectTo();

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
