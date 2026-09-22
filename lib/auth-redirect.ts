import Constants from 'expo-constants';
import * as Linking from 'expo-linking';

function nativeScheme(): string | null {
  const scheme = Constants.expoConfig?.scheme;

  if (Array.isArray(scheme) && typeof scheme[0] === 'string' && scheme[0]) {
    return scheme[0];
  }

  if (typeof scheme === 'string' && scheme) {
    return scheme;
  }

  return null;
}

function nativeAuthCallbackUrl(): string {
  const scheme = nativeScheme();

  if (scheme) {
    return `${scheme}://auth/callback`;
  }

  return Linking.createURL('auth/callback');
}

export const AUTH_EMAIL_REDIRECT_TO = nativeAuthCallbackUrl();

console.log('[AuthPKCE] redirectTo:', AUTH_EMAIL_REDIRECT_TO);
console.log('[AuthPKCE] createURL fallback:', Linking.createURL('auth/callback'));
console.log('[AuthPKCE] APP_VARIANT:', process.env.APP_VARIANT ?? '(unset)');
console.log('[AuthPKCE] expoConfig.scheme:', JSON.stringify(Constants.expoConfig?.scheme ?? null));

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
