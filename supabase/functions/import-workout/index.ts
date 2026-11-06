// NOT DEPLOYED.
// Reads OPENAI_API_KEY from the function environment and returns a draft.
// It does not write programs, days, exercises, or workout history.
// A Supabase Auth user JWT is required. The installed quota RPC runs
// as that user before any model request. The phone reviews the draft
// and saves only through the separate reviewed save path.

import { buildImportModelRequest } from '../../../lib/import/build-import-model-request.ts';
import { TEXT_MAX_CHARS } from '../../../lib/import/limits.ts';
import { checkImportSchema, validateImportModelOutput } from '../../../lib/import/validate-draft.ts';

const PROJECT_HOST = 'kbwaxskykqaymzdytjxv.supabase.co';
const MODEL_HOST = 'api.openai.com';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const IMPORT_BODY_MAX_BYTES = TEXT_MAX_CHARS * 6 + 1024;
export const IMPORT_AUTH_TIMEOUT_MS = 10_000;
export const IMPORT_QUOTA_TIMEOUT_MS = 10_000;
export const IMPORT_MODEL_TIMEOUT_MS = 50_000;
const AUTH_RESPONSE_MAX_BYTES = 65_536;
const QUOTA_RESPONSE_MAX_BYTES = 4_096;
const MODEL_RESPONSE_MAX_BYTES = 512 * 1024;
const TOKEN_MAX_CHARS = 8_192;

export type EnvReader = (name: string) => string | undefined;

export type VerifyResult =
  | { ok: true; userId: string }
  | { ok: false; error: 'unauthorized' | 'unconfigured' };

export type QuotaResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'rate_limited_burst'
        | 'rate_limited_daily'
        | 'unauthorized'
        | 'quota_unavailable'
        | 'unconfigured';
    };

export type ImportHandlers = {
  env?: EnvReader;
  fetch?: typeof fetch;
  verifyUser?: (jwt: string, env: EnvReader, fetchImpl: typeof fetch) => Promise<VerifyResult>;
  consumeQuota?: (jwt: string, env: EnvReader, fetchImpl: typeof fetch) => Promise<QuotaResult>;
  bodyMaxBytes?: number;
  authTimeoutMs?: number;
  quotaTimeoutMs?: number;
  modelTimeoutMs?: number;
};

type JwtClaims = {
  sub: string;
  expiresAt: number | null;
};

export const LOCALHOST_DEV_ORIGINS = [
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://localhost:8091',
  'http://127.0.0.1:8091',
] as const;

const CORS_ALLOW_HEADERS = 'authorization, apikey, x-client-info, content-type';
const CORS_ALLOW_METHODS = 'POST, OPTIONS';
const CORS_REQUEST_HEADERS = new Set([
  'authorization',
  'apikey',
  'x-client-info',
  'content-type',
]);

function allowedDevOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin == null) {
    return null;
  }
  return (LOCALHOST_DEV_ORIGINS as readonly string[]).includes(origin) ? origin : null;
}

function applyCors(headers: Headers, origin: string): void {
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-headers', CORS_ALLOW_HEADERS);
  headers.set('access-control-allow-methods', CORS_ALLOW_METHODS);
  headers.set('vary', 'origin');
}

function requestedHeadersAllowed(value: string | null): boolean {
  if (value == null || value.trim() === '') {
    return true;
  }
  const names = value.split(',').map((part) => part.trim().toLowerCase()).filter((part) => part !== '');
  return names.every((name) => CORS_REQUEST_HEADERS.has(name));
}

function preflight(request: Request, origin: string | null): Response {
  const headers = new Headers({ 'cache-control': 'no-store', vary: 'origin' });
  const method = request.headers.get('access-control-request-method');
  const allowed = origin != null &&
    (method == null || method.toUpperCase() === 'POST') &&
    requestedHeadersAllowed(request.headers.get('access-control-request-headers'));
  if (!allowed || origin == null) {
    return new Response(null, { status: 403, headers });
  }
  applyCors(headers, origin);
  return new Response(null, { status: 204, headers });
}

function json(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({
    'content-type': 'application/json',
    'cache-control': 'no-store',
  });
  if (origin != null) {
    applyCors(headers, origin);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function timeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer),
  };
}

function defaultEnv(name: string): string | undefined {
  const value = Deno.env.get(name);
  if (value == null || value.trim() === '') {
    return undefined;
  }
  return value;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header == null) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (match?.[1] == null || match[1].length > TOKEN_MAX_CHARS) {
    return null;
  }
  return match[1];
}

function decodeBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function readJwtClaims(token: string): JwtClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    return null;
  }
  if (token.startsWith('sb_')) {
    return null;
  }
  const payloadText = decodeBase64Url(parts[1] ?? '');
  if (payloadText == null) {
    return null;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return null;
  }
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.role !== 'authenticated' || record.is_anonymous === true) {
    return null;
  }
  if (typeof record.sub !== 'string' || !UUID_PATTERN.test(record.sub)) {
    return null;
  }
  const expiresAt = typeof record.exp === 'number' && Number.isFinite(record.exp)
    ? record.exp * 1000
    : null;
  if (expiresAt != null && expiresAt <= Date.now()) {
    return null;
  }
  if (typeof record.nbf === 'number' && Number.isFinite(record.nbf) && record.nbf * 1000 > Date.now()) {
    return null;
  }
  return { sub: record.sub, expiresAt };
}

function projectOrigin(env: EnvReader): string | null {
  const raw = env('SUPABASE_URL');
  if (raw == null) {
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== PROJECT_HOST) {
      return null;
    }
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
      return null;
    }
    if (url.pathname !== '' && url.pathname !== '/') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function anonKey(env: EnvReader): string | null {
  const key = env('SUPABASE_ANON_KEY');
  if (key == null || key.startsWith('sb_secret_')) {
    return null;
  }
  return key;
}

async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array | 'too_large'> {
  if (stream == null) {
    return new Uint8Array();
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value == null || value.byteLength === 0) {
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return 'too_large';
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return 'too_large';
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readResponseText(response: Response, maxBytes: number): Promise<string | null> {
  const bytes = await readLimited(response.body, maxBytes);
  if (bytes === 'too_large') {
    return null;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export async function verifySupabaseUser(
  jwt: string,
  env: EnvReader,
  fetchImpl: typeof fetch,
  timeoutMs = IMPORT_AUTH_TIMEOUT_MS,
): Promise<VerifyResult> {
  if (readJwtClaims(jwt) == null) {
    return { ok: false, error: 'unauthorized' };
  }
  const origin = projectOrigin(env);
  const key = anonKey(env);
  if (origin == null || key == null) {
    return { ok: false, error: 'unconfigured' };
  }
  const timed = timeoutSignal(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/auth/v1/user`, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${jwt}`,
        apikey: key,
      },
      cache: 'no-store',
      redirect: 'error',
      signal: timed.signal,
    });
  } catch {
    return { ok: false, error: 'unauthorized' };
  } finally {
    timed.cancel();
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, error: 'unauthorized' };
  }
  const text = await readResponseText(response, AUTH_RESPONSE_MAX_BYTES);
  if (text == null) {
    return { ok: false, error: 'unauthorized' };
  }
  let user: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'unauthorized' };
    }
    user = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'unauthorized' };
  }
  const claims = readJwtClaims(jwt);
  if (
    claims == null ||
    typeof user.id !== 'string' ||
    user.id !== claims.sub ||
    !UUID_PATTERN.test(user.id) ||
    user.role !== 'authenticated' ||
    user.is_anonymous === true ||
    (user.aud != null && user.aud !== 'authenticated')
  ) {
    return { ok: false, error: 'unauthorized' };
  }
  return { ok: true, userId: user.id };
}

function quotaError(message: string): QuotaResult {
  if (message === 'rate_limited_burst' || message === 'rate_limited_daily') {
    return { ok: false, error: message };
  }
  if (message === 'Not authenticated') {
    return { ok: false, error: 'unauthorized' };
  }
  return { ok: false, error: 'quota_unavailable' };
}

export async function consumeAiImportQuota(
  jwt: string,
  env: EnvReader,
  fetchImpl: typeof fetch,
  timeoutMs = IMPORT_QUOTA_TIMEOUT_MS,
): Promise<QuotaResult> {
  if (readJwtClaims(jwt) == null) {
    return { ok: false, error: 'unauthorized' };
  }
  const origin = projectOrigin(env);
  const key = anonKey(env);
  if (origin == null || key == null) {
    return { ok: false, error: 'unconfigured' };
  }
  const timed = timeoutSignal(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(`${origin}/rest/v1/rpc/consume_ai_import_quota`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${jwt}`,
        apikey: key,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ p_kind: 'model' }),
      cache: 'no-store',
      redirect: 'error',
      signal: timed.signal,
    });
  } catch {
    return { ok: false, error: 'quota_unavailable' };
  } finally {
    timed.cancel();
  }
  if (response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: true };
  }
  const text = await readResponseText(response, QUOTA_RESPONSE_MAX_BYTES);
  if (text == null) {
    return { ok: false, error: 'quota_unavailable' };
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    const message = parsed != null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as { message?: unknown }).message === 'string'
      ? (parsed as { message: string }).message.trim()
      : '';
    return quotaError(message);
  } catch {
    return { ok: false, error: 'quota_unavailable' };
  }
}

function refusedOutput(output: unknown): boolean {
  if (!Array.isArray(output)) {
    return false;
  }
  for (const item of output) {
    if (item == null || typeof item !== 'object') {
      continue;
    }
    if ((item as { type?: unknown }).type === 'refusal') {
      return true;
    }
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (part != null && typeof part === 'object' && (part as { type?: unknown }).type === 'refusal') {
        return true;
      }
    }
  }
  return false;
}

function draftText(payload: unknown): string | null {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as {
    status?: unknown;
    error?: unknown;
    output_text?: unknown;
    output?: unknown;
  };
  if (record.error != null) {
    return null;
  }
  if (typeof record.status === 'string' && record.status !== 'completed') {
    return null;
  }
  if (refusedOutput(record.output)) {
    return null;
  }
  if (typeof record.output_text === 'string' && record.output_text.trim() !== '') {
    return record.output_text;
  }
  if (!Array.isArray(record.output)) {
    return null;
  }
  for (const item of record.output) {
    if (item == null || typeof item !== 'object') {
      continue;
    }
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const part of content) {
      if (part == null || typeof part !== 'object') {
        continue;
      }
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim() !== '') {
        return text;
      }
    }
  }
  return null;
}

const UPSTREAM_FIELD_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const BILLING_MARKERS = new Set([
  'insufficient_quota',
  'billing_hard_limit_reached',
  'billing_not_active',
  'payment_required',
]);

type UpstreamFields = {
  error_type: string | null;
  error_code: string | null;
  error_param: string | null;
};

function sanitizeUpstreamField(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!UPSTREAM_FIELD_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function upstreamFields(payload: unknown): UpstreamFields {
  const empty: UpstreamFields = { error_type: null, error_code: null, error_param: null };
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return empty;
  }
  const error = (payload as { error?: unknown }).error;
  if (error == null || typeof error !== 'object' || Array.isArray(error)) {
    return empty;
  }
  const record = error as { type?: unknown; code?: unknown; param?: unknown };
  return {
    error_type: sanitizeUpstreamField(record.type),
    error_code: sanitizeUpstreamField(record.code),
    error_param: sanitizeUpstreamField(record.param),
  };
}

function logUpstream(status: number | null, fields: UpstreamFields): void {
  console.log(JSON.stringify({
    upstream_status: status,
    error_type: fields.error_type,
    error_code: fields.error_code,
    error_param: fields.error_param,
  }));
}

function isBilling(fields: UpstreamFields): boolean {
  return (fields.error_code != null && BILLING_MARKERS.has(fields.error_code)) ||
    (fields.error_type != null && BILLING_MARKERS.has(fields.error_type));
}

function upstreamFailure(status: number, fields: UpstreamFields): { error: string; httpStatus: number } {
  if (status === 401 || status === 403) {
    return { error: 'import_upstream_auth', httpStatus: 502 };
  }
  if (status === 400) {
    return { error: 'import_upstream_rejected', httpStatus: 502 };
  }
  if (status === 408 || status === 504) {
    return { error: 'import_upstream_timeout', httpStatus: 504 };
  }
  if (status === 402 || isBilling(fields)) {
    return { error: 'import_upstream_billing', httpStatus: 502 };
  }
  if (status === 429) {
    return { error: 'import_upstream_rate_limited', httpStatus: 502 };
  }
  return { error: 'import_upstream_failed', httpStatus: 502 };
}

async function readUpstreamFields(response: Response): Promise<UpstreamFields> {
  const empty: UpstreamFields = { error_type: null, error_code: null, error_param: null };
  const text = await readResponseText(response, QUOTA_RESPONSE_MAX_BYTES);
  if (text == null) {
    return empty;
  }
  try {
    return upstreamFields(JSON.parse(text));
  } catch {
    return empty;
  }
}

function declaredLength(request: Request, maxBytes: number): 'ok' | 'too_large' {
  const declared = request.headers.get('content-length');
  if (declared == null) {
    return 'ok';
  }
  if (!/^\d+$/.test(declared)) {
    return 'too_large';
  }
  const length = Number(declared);
  if (!Number.isSafeInteger(length) || length > maxBytes) {
    return 'too_large';
  }
  return 'ok';
}

export async function handleImportWorkout(
  request: Request,
  handlers: ImportHandlers = {},
): Promise<Response> {
  const origin = allowedDevOrigin(request);
  const respond = (body: unknown, status: number) => json(body, status, origin);
  if (request.method === 'OPTIONS') {
    return preflight(request, origin);
  }
  if (request.method !== 'POST') {
    return respond({ error: 'method_not_allowed' }, 405);
  }
  const token = bearerToken(request);
  if (token == null || readJwtClaims(token) == null) {
    return respond({ error: 'unauthorized' }, 401);
  }

  const env = handlers.env ?? defaultEnv;
  const fetchImpl = handlers.fetch ?? fetch;
  const bodyMaxBytes = handlers.bodyMaxBytes ?? IMPORT_BODY_MAX_BYTES;
  const authTimeoutMs = handlers.authTimeoutMs ?? IMPORT_AUTH_TIMEOUT_MS;
  const quotaTimeoutMs = handlers.quotaTimeoutMs ?? IMPORT_QUOTA_TIMEOUT_MS;
  if (declaredLength(request, bodyMaxBytes) === 'too_large') {
    return respond({ error: 'invalid_import' }, 413);
  }
  const rawBody = await readLimited(request.body, bodyMaxBytes);
  if (rawBody === 'too_large') {
    return respond({ error: 'invalid_import' }, 413);
  }

  const verify = handlers.verifyUser ??
    ((jwt: string, envReader: EnvReader, fetchImpl: typeof fetch) =>
      verifySupabaseUser(jwt, envReader, fetchImpl, authTimeoutMs));
  let verified: VerifyResult;
  try {
    verified = await verify(token, env, fetchImpl);
  } catch {
    return respond({ error: 'unauthorized' }, 401);
  }
  if (!verified.ok) {
    return respond(
      { error: verified.error === 'unconfigured' ? 'import_unconfigured' : 'unauthorized' },
      verified.error === 'unconfigured' ? 500 : 401,
    );
  }

  let source = '';
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(rawBody).replace(/^\uFEFF/, '');
    const body = JSON.parse(text) as unknown;
    source = body != null &&
        typeof body === 'object' &&
        !Array.isArray(body) &&
        typeof (body as { source?: unknown }).source === 'string'
      ? (body as { source: string }).source.trim()
      : '';
  } catch {
    return respond({ error: 'invalid_import' }, 400);
  }
  if (source.length === 0 || source.length > TEXT_MAX_CHARS) {
    return respond({ error: 'invalid_import' }, 400);
  }

  const apiKey = env('OPENAI_API_KEY')?.trim();
  if (apiKey == null || apiKey === '') {
    return respond({ error: 'import_unconfigured' }, 500);
  }

  const consume = handlers.consumeQuota ??
    ((jwt: string, envReader: EnvReader, fetchImpl: typeof fetch) =>
      consumeAiImportQuota(jwt, envReader, fetchImpl, quotaTimeoutMs));
  let quota: QuotaResult;
  try {
    quota = await consume(token, env, fetchImpl);
  } catch {
    return respond({ error: 'quota_unavailable' }, 503);
  }
  if (!quota.ok) {
    if (quota.error === 'unconfigured') {
      return respond({ error: 'import_unconfigured' }, 500);
    }
    if (quota.error === 'unauthorized') {
      return respond({ error: 'unauthorized' }, 401);
    }
    if (quota.error === 'rate_limited_burst' || quota.error === 'rate_limited_daily') {
      return respond({ error: quota.error }, 429);
    }
    return respond({ error: 'quota_unavailable' }, 503);
  }

  const modelRequest = buildImportModelRequest(source);
  let modelUrl: URL;
  try {
    modelUrl = new URL(modelRequest.url);
  } catch {
    return respond({ error: 'import_failed' }, 502);
  }
  if (modelUrl.protocol !== 'https:' || modelUrl.hostname !== MODEL_HOST) {
    return respond({ error: 'import_failed' }, 502);
  }

  const modelTimeoutMs = handlers.modelTimeoutMs ?? IMPORT_MODEL_TIMEOUT_MS;
  const timed = timeoutSignal(modelTimeoutMs);
  let modelResponse: Response;
  try {
    modelResponse = await fetchImpl(modelUrl.toString(), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(modelRequest.body),
      cache: 'no-store',
      redirect: 'error',
      signal: timed.signal,
    });
  } catch {
    const timedOut = timed.signal.aborted;
    logUpstream(null, {
      error_type: timedOut ? 'timeout' : 'fetch_failed',
      error_code: null,
      error_param: null,
    });
    return respond(
      { error: timedOut ? 'import_upstream_timeout' : 'import_upstream_failed' },
      timedOut ? 504 : 502,
    );
  } finally {
    timed.cancel();
  }
  if (!modelResponse.ok) {
    const fields = await readUpstreamFields(modelResponse);
    logUpstream(modelResponse.status, fields);
    const failure = upstreamFailure(modelResponse.status, fields);
    return respond({ error: failure.error }, failure.httpStatus);
  }

  const modelText = await readResponseText(modelResponse, MODEL_RESPONSE_MAX_BYTES);
  if (modelText == null) {
    return respond({ error: 'import_failed' }, 502);
  }
  let modelPayload: unknown;
  try {
    modelPayload = JSON.parse(modelText);
  } catch {
    return respond({ error: 'import_failed' }, 502);
  }
  const draft = draftText(modelPayload);
  if (draft == null) {
    return respond({ error: 'import_failed' }, 502);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(draft);
  } catch {
    return respond({ error: 'import_failed' }, 502);
  }
  try {
    const schema = checkImportSchema(parsed);
    if (!schema.ok) {
      return respond({ error: 'invalid_import' }, 422);
    }
    const validated = validateImportModelOutput(parsed);
    if (!validated.ok) {
      return respond({ error: 'invalid_import' }, 422);
    }
  } catch {
    return respond({ error: 'invalid_import' }, 422);
  }
  return respond(parsed, 200);
}

if (Deno.env.get('IMPORT_WORKOUT_NO_SERVE') !== '1') {
  Deno.serve((request) => handleImportWorkout(request));
}
