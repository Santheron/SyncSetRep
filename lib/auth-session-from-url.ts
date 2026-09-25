import * as QueryParams from 'expo-auth-session/build/QueryParams';
import type { EmailOtpType, Session } from '@supabase/supabase-js';

import { hasPkceVerifier, listPkceStorageKeys } from '@/lib/supabase-auth-storage';
import { supabase } from '@/lib/supabase';

type Result = { ok: true; session: Session | null; isRecovery: boolean } | { ok: false; error: string };

type CallbackParams = {
  code?: string;
  type?: string;
  token_hash?: string;
  access_token?: string;
  refresh_token?: string;
  sb_flow_id?: string;
  error?: string;
  error_description?: string;
  errorCode?: string;
};

const OTP_TYPES: EmailOtpType[] = [
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
];

const exchangeByCode = new Map<string, Promise<Result>>();

function asOtpType(value: string | undefined): EmailOtpType | null {
  if (!value) {
    return null;
  }

  return OTP_TYPES.includes(value as EmailOtpType) ? (value as EmailOtpType) : null;
}

function firstParam(
  params: Record<string, string>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = params[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function parseQueryString(value: string): Record<string, string> {
  const params: Record<string, string> = {};

  for (const part of value.split('&')) {
    if (!part) {
      continue;
    }

    const [rawKey, ...rest] = part.split('=');
    const key = decodeURIComponent(rawKey || '');
    const rawValue = rest.join('=');

    if (!key) {
      continue;
    }

    try {
      params[key] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      params[key] = rawValue;
    }
  }

  return params;
}

export function parseAuthCallbackParams(url: string): CallbackParams {
  const { params, errorCode } = QueryParams.getQueryParams(url);
  const merged: Record<string, string> = { ...params };

  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');

  if (queryIndex !== -1) {
    const queryEnd = hashIndex > queryIndex ? hashIndex : url.length;
    Object.assign(merged, parseQueryString(url.slice(queryIndex + 1, queryEnd)));
  }

  if (hashIndex !== -1) {
    Object.assign(merged, parseQueryString(url.slice(hashIndex + 1)));
  }

  const nestedUrl = firstParam(merged, ['url', 'linkingUri']);

  if (nestedUrl && nestedUrl !== url && /[?&#](code|token_hash|access_token)=/.test(nestedUrl)) {
    return parseAuthCallbackParams(nestedUrl);
  }

  return {
    code: firstParam(merged, ['code']),
    type: firstParam(merged, ['type']),
    token_hash: firstParam(merged, ['token_hash', 'token']),
    access_token: firstParam(merged, ['access_token']),
    refresh_token: firstParam(merged, ['refresh_token']),
    sb_flow_id: firstParam(merged, ['sb_flow_id']),
    error: firstParam(merged, ['error']),
    error_description: firstParam(merged, ['error_description']),
    errorCode: errorCode || firstParam(merged, ['errorCode', 'error_code']),
  };
}

async function exchangeAuthorizationCode(params: CallbackParams): Promise<Result> {
  const code = params.code;

  if (!code) {
    return {
      ok: false,
      error: 'This confirmation link did not include a valid auth session.',
    };
  }

  const existing = exchangeByCode.get(code);

  if (existing) {
    console.log('[AuthPKCE] exchange reused in-flight result for same code');
    return existing;
  }

  const attempt = (async (): Promise<Result> => {
    console.log('[AuthPKCE] callback type:', params.type ?? 'none');
    console.log('[AuthPKCE] authorization code present: true');
    console.log('[AuthPKCE] verifier exists before exchange:', hasPkceVerifier());
    console.log('[AuthPKCE] stored verifier keys before exchange:', listPkceStorageKeys().join(', ') || '(none)');
    console.log('[AuthPKCE] exchange attempted');

    const flowId =
      params.sb_flow_id && /^[a-zA-Z0-9_-]{8,64}$/.test(params.sb_flow_id)
        ? params.sb_flow_id
        : undefined;

    const { data, error } = await supabase.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );

    if (error && flowId && /verifier not found/i.test(error.message)) {
      console.log('[AuthPKCE] slot lookup missed; retrying with latest verifier');
      const retry = await supabase.auth.exchangeCodeForSession(code);
      if (retry.error) {
        console.log('[AuthPKCE] exchange error');
        console.log('[AuthPKCE] verifier exists after exchange:', hasPkceVerifier());
        return { ok: false, error: retry.error.message };
      }

      console.log('[AuthPKCE] exchange success');
      return {
        ok: true,
        session: retry.data.session,
        isRecovery: params.type === 'recovery',
      };
    }

    if (error) {
      console.log('[AuthPKCE] exchange error');
      console.log('[AuthPKCE] verifier exists after exchange:', hasPkceVerifier());
      return { ok: false, error: error.message };
    }

    console.log('[AuthPKCE] exchange success');
    return {
      ok: true,
      session: data.session,
      isRecovery: params.type === 'recovery',
    };
  })();

  exchangeByCode.set(code, attempt);

  try {
    return await attempt;
  } catch (error) {
    exchangeByCode.delete(code);
    throw error;
  }
}

export async function createSessionFromUrl(url: string): Promise<Result> {
  console.log('[AuthPKCE] callback received');

  const params = parseAuthCallbackParams(url);
  const errorMessage = params.errorCode || params.error_description || params.error;
  const hasExchangeableSecret = Boolean(
    params.code || params.token_hash || (params.access_token && params.refresh_token),
  );

  console.log('[AuthPKCE] callback type:', params.type ?? 'none');
  console.log('[AuthPKCE] authorization code present:', Boolean(params.code));
  console.log('[AuthPKCE] callback has error param:', Boolean(errorMessage));

  if (errorMessage && !hasExchangeableSecret) {
    console.log('[AuthPKCE] callback URL contained error param without code');
    return { ok: false, error: errorMessage };
  }

  if (errorMessage && params.code) {
    console.log('[AuthPKCE] callback URL contained error param AND code; preferring code exchange');
  }

  if (params.code) {
    const exchanged = await exchangeAuthorizationCode(params);

    if (exchanged.ok) {
      return exchanged;
    }

    if (params.token_hash) {
      console.log('[AuthPKCE] code exchange failed; trying token_hash recovery');
    } else {
      return exchanged;
    }
  } else {
    console.log('[AuthPKCE] authorization code present: false');
    console.log('[AuthPKCE] verifier exists before exchange:', hasPkceVerifier());
  }

  if (params.token_hash) {
    const type = asOtpType(params.type) ?? 'recovery';
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: params.token_hash,
      type,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, session: data.session, isRecovery: type === 'recovery' };
  }

  if (params.access_token && params.refresh_token) {
    const { data, error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return {
      ok: true,
      session: data.session,
      isRecovery: params.type === 'recovery',
    };
  }

  return {
    ok: false,
    error: 'This confirmation link did not include a valid auth session.',
  };
}
