import * as QueryParams from 'expo-auth-session/build/QueryParams';
import type { EmailOtpType, Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

type Result = { ok: true; session: Session | null } | { ok: false; error: string };

const OTP_TYPES: EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

function asOtpType(value: string | undefined): EmailOtpType | null {
  if (!value) {
    return null;
  }

  return OTP_TYPES.includes(value as EmailOtpType) ? (value as EmailOtpType) : null;
}

export async function createSessionFromUrl(url: string): Promise<Result> {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  const errorMessage = errorCode || params.error_description || params.error;

  if (errorMessage) {
    return { ok: false, error: errorMessage };
  }

  if (params.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, session: data.session };
  }

  if (params.token_hash) {
    const type = asOtpType(params.type) ?? 'signup';
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: params.token_hash,
      type,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, session: data.session };
  }

  if (params.access_token && params.refresh_token) {
    const { data, error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, session: data.session };
  }

  return {
    ok: false,
    error: 'This confirmation link did not include a valid auth session.',
  };
}
