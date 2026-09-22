import { supabaseAuthStorage } from '@/lib/supabase-auth-storage';

const PASSWORD_RESET_PENDING_KEY = 'syncsetrep.password-reset-pending';

async function readItem(key: string): Promise<string | null> {
  return (await supabaseAuthStorage.getItem(key)) ?? null;
}

export async function markPasswordResetPending(): Promise<void> {
  await supabaseAuthStorage.setItem(PASSWORD_RESET_PENDING_KEY, '1');
}

export async function clearPasswordResetPending(): Promise<void> {
  await supabaseAuthStorage.removeItem(PASSWORD_RESET_PENDING_KEY);
}

export async function hasPasswordResetPending(): Promise<boolean> {
  return (await readItem(PASSWORD_RESET_PENDING_KEY)) === '1';
}

export function isRecoveryAuthUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  return /(?:\?|&|#)type=recovery(?:&|$|#)/.test(url) || url.includes('type=recovery');
}
