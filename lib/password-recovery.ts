import { supabaseAuthStorage } from '@/lib/supabase-auth-storage';

const PASSWORD_RESET_PENDING_KEY = 'syncsetrep.password-reset-pending';

let pendingMemory = false;

async function readItem(key: string): Promise<string | null> {
  return (await supabaseAuthStorage.getItem(key)) ?? null;
}

export function hasPasswordResetPendingSync(): boolean {
  return pendingMemory;
}

export function markPasswordResetPendingSync(): void {
  pendingMemory = true;
}

export async function markPasswordResetPending(): Promise<void> {
  pendingMemory = true;
  await supabaseAuthStorage.setItem(PASSWORD_RESET_PENDING_KEY, '1');
}

export async function clearPasswordResetPending(): Promise<void> {
  pendingMemory = false;
  await supabaseAuthStorage.removeItem(PASSWORD_RESET_PENDING_KEY);
}

export async function hasPasswordResetPending(): Promise<boolean> {
  const stored = (await readItem(PASSWORD_RESET_PENDING_KEY)) === '1';
  pendingMemory = stored || pendingMemory;
  return pendingMemory;
}

export function isRecoveryAuthUrl(url: string | null | undefined): boolean {
  if (!url) {
    return false;
  }

  return /(?:\?|&|#)type=recovery(?:&|$|#)/.test(url) || url.includes('type=recovery');
}
