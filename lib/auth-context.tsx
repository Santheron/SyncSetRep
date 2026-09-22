import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';

import { subscribeAuthDeepLinks } from '@/lib/auth-deep-link';
import { AUTH_EMAIL_REDIRECT_TO } from '@/lib/auth-redirect';
import {
  clearPasswordResetPending,
  hasPasswordResetPending,
  markPasswordResetPending,
} from '@/lib/password-recovery';
import { ensureProfile } from '@/lib/profile';
import { hasPkceVerifier, listPkceStorageKeys } from '@/lib/supabase-auth-storage';
import { supabase } from '@/lib/supabase';

type AuthResult = {
  error: string | null;
  needsConfirmation?: boolean;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isPasswordRecovery: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string, displayName: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  beginPasswordRecovery: () => Promise<void>;
  updatePassword: (password: string) => Promise<AuthResult>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

let didLogAuthProviderMount = false;

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!didLogAuthProviderMount) {
    didLogAuthProviderMount = true;
    console.log('[DeepLink] AuthProvider mounted');
  }

  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    let isMounted = true;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        const pending = await hasPasswordResetPending();

        if (!isMounted) {
          return;
        }

        setSession(data.session);
        setIsPasswordRecovery(Boolean(data.session && pending));
        setIsLoading(false);

        if (data.session?.user && !pending) {
          void ensureProfile(data.session.user);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSession(null);
          setIsPasswordRecovery(false);
          setIsLoading(false);
        }
      });

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setIsLoading(false);

      if (event === 'PASSWORD_RECOVERY') {
        console.log('[AuthPKCE] onAuthStateChange: PASSWORD_RECOVERY');
        setIsPasswordRecovery(true);
        void markPasswordResetPending();
        return;
      }

      if (event === 'SIGNED_OUT') {
        setIsPasswordRecovery(false);
        void clearPasswordResetPending();
        return;
      }

      if (nextSession?.user) {
        void hasPasswordResetPending().then((pending) => {
          if (!pending) {
            void ensureProfile(nextSession.user);
          }
        });
      }
    });

    const unsubscribeDeepLinks = subscribeAuthDeepLinks({
      onRecovery: async () => {
        if (!isMounted) {
          return;
        }

        setIsPasswordRecovery(true);
        await markPasswordResetPending();
      },
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
      unsubscribeDeepLinks();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      isLoading,
      isPasswordRecovery,
      async signIn(email, password) {
        await clearPasswordResetPending();
        setIsPasswordRecovery(false);

        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        return { error: error?.message ?? null };
      },
      async signUp(email, password, displayName) {
        const { data: signUpData, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: AUTH_EMAIL_REDIRECT_TO,
            data: {
              display_name: displayName.trim(),
            },
          },
        });

        if (error) {
          return { error: error.message };
        }

        if (signUpData.user && !signUpData.session) {
          return {
            error: null,
            needsConfirmation: true,
          };
        }

        if (signUpData.user) {
          await ensureProfile(signUpData.user);
        }

        return { error: null };
      },
      async signOut() {
        setIsPasswordRecovery(false);
        await clearPasswordResetPending();
        const { error } = await supabase.auth.signOut();
        return { error: error?.message ?? null };
      },
      async requestPasswordReset(email) {
        console.log('[AuthPKCE] verifier exists before reset request:', hasPkceVerifier());
        console.log('[AuthPKCE] stored verifier keys before reset:', listPkceStorageKeys().join(', ') || '(none)');
        console.log('[AuthPKCE] reset redirectTo:', AUTH_EMAIL_REDIRECT_TO);
        await markPasswordResetPending();

        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: AUTH_EMAIL_REDIRECT_TO,
        });

        console.log(
          '[AuthPKCE] resetPasswordForEmail error:',
          error
            ? `${error.name} status=${error.status ?? 'none'} code=${error.code ?? 'none'} message=${error.message}`
            : 'none',
        );
        console.log('[AuthPKCE] verifier exists after reset request:', hasPkceVerifier());
        console.log('[AuthPKCE] stored verifier keys after reset:', listPkceStorageKeys().join(', ') || '(none)');

        if (error) {
          await clearPasswordResetPending();
          return { error: error.message };
        }

        return { error: null };
      },
      async beginPasswordRecovery() {
        setIsPasswordRecovery(true);
        await markPasswordResetPending();
      },
      async updatePassword(password) {
        const { error } = await supabase.auth.updateUser({ password });

        if (error) {
          return { error: error.message };
        }

        setIsPasswordRecovery(false);
        await clearPasswordResetPending();
        await supabase.auth.signOut();
        return { error: null };
      },
    }),
    [isLoading, isPasswordRecovery, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth must be used within AuthProvider.');
  }

  return value;
}
