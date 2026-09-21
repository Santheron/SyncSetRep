export const AUTH_EMAIL_REDIRECT_TO = 'workouttracker://auth/callback';

export function isAuthCallbackUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  return (
    url.includes('auth/callback') ||
    url.includes('access_token=') ||
    url.includes('refresh_token=') ||
    url.includes('code=') ||
    url.includes('token_hash=')
  );
}
