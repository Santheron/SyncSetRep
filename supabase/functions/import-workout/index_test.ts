Deno.env.set('IMPORT_WORKOUT_NO_SERVE', '1');

const {
  LOCALHOST_DEV_ORIGINS,
  consumeAiImportQuota,
  handleImportWorkout,
  verifySupabaseUser,
} = await import('./index.ts');
const { buildImportModelRequest } = await import('../../../lib/import/build-import-model-request.ts');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const ATTACKER_ID = '33333333-3333-4333-8333-333333333333';
const ORIGIN = 'https://kbwaxskykqaymzdytjxv.supabase.co';
const MODEL_URL = 'https://api.openai.com/v1/responses';
const ANON_KEY = 'sb_publishable_local_test_only';
const API_KEY = 'local-test-key';
const UPSTREAM_SECRET = 'upstream-secret-body';

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value: unknown): void {
  if (value !== true) {
    throw new Error(`expected true got ${JSON.stringify(value)}`);
  }
}

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function userJwt(sub = USER_ID, overrides: Record<string, unknown> = {}): string {
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode({
    sub,
    role: 'authenticated',
    is_anonymous: false,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  })}.signature`;
}

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    role: 'authenticated',
    aud: 'authenticated',
    is_anonymous: false,
    ...overrides,
  };
}

function testEnv(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    SUPABASE_URL: ORIGIN,
    SUPABASE_ANON_KEY: ANON_KEY,
    OPENAI_API_KEY: API_KEY,
    ...overrides,
  };
  return (name: string) => values[name];
}

const validDraft = JSON.parse(
  await Deno.readTextFile(new URL('../../../scripts/fixtures/workout-import/valid-extracted.json', import.meta.url)),
);
const extraKeyDraft = JSON.parse(
  await Deno.readTextFile(new URL('../../../scripts/fixtures/workout-import/malformed-extra-key.json', import.meta.url)),
);

type SeenCall = { url: string; authorization: string; apikey: string; body: string };

function post(body: unknown, jwt = userJwt()): Request {
  return new Request('http://127.0.0.1/import-workout', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function route(options: {
  calls: SeenCall[];
  authStatus?: number;
  authBody?: unknown;
  quotaStatus?: number;
  quotaBody?: unknown;
  modelStatus?: number;
  modelBody?: unknown;
  modelText?: string;
  hangAuth?: boolean;
  hangModel?: boolean;
}): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    options.calls.push({
      url,
      authorization: headers.get('authorization') ?? '',
      apikey: headers.get('apikey') ?? '',
      body: typeof init?.body === 'string' ? init.body : '',
    });
    if (url === `${ORIGIN}/auth/v1/user`) {
      if (options.hangAuth) {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('auth timed out')));
        });
      }
      return new Response(JSON.stringify(options.authBody ?? authUser()), {
        status: options.authStatus ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === `${ORIGIN}/rest/v1/rpc/consume_ai_import_quota`) {
      if ((options.quotaStatus ?? 204) === 204 && options.quotaBody == null) {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify(options.quotaBody ?? {}), {
        status: options.quotaStatus ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === MODEL_URL) {
      if (options.hangModel) {
        await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('model timed out')));
        });
      }
      if (options.modelText != null) {
        return new Response(options.modelText, { status: options.modelStatus ?? 200 });
      }
      return new Response(
        JSON.stringify(options.modelBody ?? { output_text: JSON.stringify(validDraft) }),
        { status: options.modelStatus ?? 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

function safe(responseText: string): void {
  assertTrue(!responseText.includes(API_KEY));
  assertTrue(!responseText.includes(ANON_KEY));
  assertTrue(!responseText.includes(UPSTREAM_SECRET));
  assertTrue(!responseText.includes(USER_ID));
  assertTrue(!responseText.includes(ATTACKER_ID));
  assertTrue(!responseText.includes('signature'));
}

Deno.test('rejects missing, malformed, anonymous, expired, and publishable authorization', async () => {
  const calls: SeenCall[] = [];
  const fetchImpl = route({ calls });
  const handlers = { env: testEnv(), fetch: fetchImpl };

  const missing = await handleImportWorkout(post({ source: 'Bench' }, ''), handlers);
  assertEquals(missing.status, 401);
  const wrongScheme = await handleImportWorkout(
    new Request('http://127.0.0.1/import-workout', {
      method: 'POST',
      headers: { authorization: 'Basic abc', 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'Bench' }),
    }),
    handlers,
  );
  assertEquals(wrongScheme.status, 401);
  const publishable = await handleImportWorkout(post({ source: 'Bench' }, ANON_KEY), handlers);
  assertEquals(publishable.status, 401);
  const anonymousRole = await handleImportWorkout(
    post({ source: 'Bench' }, userJwt(USER_ID, { role: 'anon' })),
    handlers,
  );
  assertEquals(anonymousRole.status, 401);
  const anonymousFlag = await handleImportWorkout(
    post({ source: 'Bench' }, userJwt(USER_ID, { is_anonymous: true })),
    handlers,
  );
  assertEquals(anonymousFlag.status, 401);
  const expired = await handleImportWorkout(
    post({ source: 'Bench' }, userJwt(USER_ID, { exp: Math.floor(Date.now() / 1000) - 60 })),
    handlers,
  );
  assertEquals(expired.status, 401);
  const notYetValid = await handleImportWorkout(
    post({ source: 'Bench' }, userJwt(USER_ID, { nbf: Math.floor(Date.now() / 1000) + 600 })),
    handlers,
  );
  assertEquals(notYetValid.status, 401);
  assertEquals(calls.length, 0);
  for (const response of [missing, wrongScheme, publishable, anonymousRole, anonymousFlag, expired, notYetValid]) {
    safe(await response.text());
  }
});

Deno.test('auth server rejection, anonymous users, and mismatched ids stop before quota', async () => {
  for (const authBody of [
    null,
    authUser({ is_anonymous: true }),
    authUser({ id: OTHER_ID }),
    authUser({ role: 'anon' }),
  ]) {
    const calls: SeenCall[] = [];
    const response = await handleImportWorkout(post({ source: 'Bench' }), {
      env: testEnv(),
      fetch: route({
        calls,
        authStatus: authBody == null ? 401 : 200,
        authBody: authBody ?? { message: UPSTREAM_SECRET },
      }),
    });
    assertEquals(response.status, 401);
    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.url, `${ORIGIN}/auth/v1/user`);
    safe(await response.text());
  }
});

Deno.test('verify and quota use only the SyncSetRep project and the caller JWT', async () => {
  const calls: SeenCall[] = [];
  const jwt = userJwt();
  const response = await handleImportWorkout(
    post({ source: 'Bench press', user_id: ATTACKER_ID, userId: ATTACKER_ID }, jwt),
    { env: testEnv(), fetch: route({ calls }) },
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), validDraft);
  assertEquals(calls.map((call) => call.url), [
    `${ORIGIN}/auth/v1/user`,
    `${ORIGIN}/rest/v1/rpc/consume_ai_import_quota`,
    MODEL_URL,
  ]);
  assertEquals(calls[0]?.authorization, `Bearer ${jwt}`);
  assertEquals(calls[0]?.apikey, ANON_KEY);
  assertEquals(calls[1]?.authorization, `Bearer ${jwt}`);
  assertEquals(calls[1]?.apikey, ANON_KEY);
  assertEquals(JSON.parse(calls[1]?.body ?? '{}'), { p_kind: 'model' });
  assertTrue(!(calls[1]?.body ?? '').includes(ATTACKER_ID));
  assertTrue(!(calls[2]?.body ?? '').includes(ATTACKER_ID));
  assertTrue(!(calls[2]?.body ?? '').includes(API_KEY));
  assertEquals(calls[2]?.authorization, `Bearer ${API_KEY}`);
  const expected = buildImportModelRequest('Bench press');
  assertEquals(JSON.parse(calls[2]?.body ?? '{}'), expected.body);
  safe(JSON.stringify(validDraft));
});

Deno.test('a different Supabase project and a secret key are not called', async () => {
  const calls: SeenCall[] = [];
  const otherProject = await handleImportWorkout(post({ source: 'Bench' }), {
    env: testEnv({ SUPABASE_URL: 'https://example.supabase.co' }),
    fetch: route({ calls }),
  });
  assertEquals(otherProject.status, 500);
  assertEquals(await otherProject.json(), { error: 'import_unconfigured' });
  const secretKey = await handleImportWorkout(post({ source: 'Bench' }), {
    env: testEnv({ SUPABASE_ANON_KEY: 'sb_secret_local_test_only' }),
    fetch: route({ calls }),
  });
  assertEquals(secretKey.status, 500);
  assertEquals(calls.length, 0);
  safe(await secretKey.text());
});

Deno.test('quota exhaustion is returned without calling the model', async () => {
  for (const message of ['rate_limited_burst', 'rate_limited_daily']) {
    const calls: SeenCall[] = [];
    const response = await handleImportWorkout(post({ source: 'Bench' }), {
      env: testEnv(),
      fetch: route({
        calls,
        quotaStatus: 400,
        quotaBody: { code: 'P0001', message, details: UPSTREAM_SECRET },
      }),
    });
    assertEquals(response.status, 429);
    assertEquals(await response.json(), { error: message });
    assertEquals(calls.length, 2);
    safe(JSON.stringify({ error: message }));
  }
});

Deno.test('quota and upstream failures stay closed and do not leak response bodies', async () => {
  const quotaCalls: SeenCall[] = [];
  const quotaDown = await handleImportWorkout(post({ source: 'Bench' }), {
    env: testEnv(),
    fetch: route({
      calls: quotaCalls,
      quotaStatus: 500,
      quotaBody: { message: UPSTREAM_SECRET, key: API_KEY },
    }),
  });
  assertEquals(quotaDown.status, 503);
  assertEquals(await quotaDown.json(), { error: 'quota_unavailable' });
  assertEquals(quotaCalls.length, 2);

  const upstreamCalls: SeenCall[] = [];
  const upstream = await handleImportWorkout(post({ source: 'Bench' }), {
    env: testEnv(),
    fetch: route({
      calls: upstreamCalls,
      modelStatus: 503,
      modelBody: { error: UPSTREAM_SECRET, key: API_KEY },
    }),
  });
  assertEquals(upstream.status, 502);
  assertEquals(await upstream.json(), { error: 'import_upstream_failed' });
  assertEquals(upstreamCalls.length, 3);

  const nonJsonCalls: SeenCall[] = [];
  const nonJson = await handleImportWorkout(post({ source: 'Bench' }), {
    env: testEnv(),
    fetch: route({ calls: nonJsonCalls, modelText: 'not-json {', modelStatus: 200 }),
  });
  assertEquals(nonJson.status, 502);
  assertEquals(await nonJson.json(), { error: 'import_failed' });

  const badDraftCalls: SeenCall[] = [];
  const badDraft = await handleImportWorkout(post({ source: 'Bench' }), {
    env: testEnv(),
    fetch: route({
      calls: badDraftCalls,
      modelBody: { output_text: 'not-json' },
    }),
  });
  assertEquals(badDraft.status, 502);
  safe(await badDraft.text());
});

Deno.test('malformed requests, oversized bodies, and invalid model output are rejected', async () => {
  const calls: SeenCall[] = [];
  const handlers = { env: testEnv(), fetch: route({ calls }) };
  const malformed = await handleImportWorkout(post('{'), handlers);
  assertEquals(malformed.status, 400);
  const notObject = await handleImportWorkout(post('[]'), handlers);
  assertEquals(notObject.status, 400);
  const empty = await handleImportWorkout(post({ source: '   ' }), handlers);
  assertEquals(empty.status, 400);
  const tooLong = await handleImportWorkout(post({ source: 'a'.repeat(20_001) }), handlers);
  assertEquals(tooLong.status, 400);
  assertEquals(calls.length, 4);
  assertTrue(calls.every((call) => call.url.endsWith('/auth/v1/user')));

  const beforeOversize = calls.length;
  const oversized = await handleImportWorkout(
    new Request('http://127.0.0.1/import-workout', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${userJwt()}`,
        'content-type': 'application/json',
        'content-length': '99999999',
      },
      body: JSON.stringify({ source: 'Bench' }),
    }),
    { ...handlers, bodyMaxBytes: 8 },
  );
  assertEquals(oversized.status, 413);
  assertEquals(calls.length, beforeOversize);

  const extra = await handleImportWorkout(post({ source: 'Bench' }), {
    env: testEnv(),
    fetch: route({ calls: [], modelBody: { output_text: JSON.stringify(extraKeyDraft) } }),
  });
  assertEquals(extra.status, 422);
  assertEquals(await extra.json(), { error: 'invalid_import' });

  const emptyDays = {
    programName: { origin: 'extracted', value: 'Upper' },
    days: [],
    warnings: [],
  };
  const noDays = await handleImportWorkout(post({ source: 'Bench' }), {
    env: testEnv(),
    fetch: route({ calls: [], modelBody: { output_text: JSON.stringify(emptyDays) } }),
  });
  assertEquals(noDays.status, 422);
});

Deno.test('timeouts fail closed before or during the model call', async () => {
  const authCalls: SeenCall[] = [];
  const authTimedOut = await handleImportWorkout(post({ source: 'Bench' }), {
    env: testEnv(),
    fetch: route({ calls: authCalls, hangAuth: true }),
    authTimeoutMs: 20,
  });
  assertEquals(authTimedOut.status, 401);
  assertEquals(authCalls.length, 1);
  safe(await authTimedOut.text());

  const modelCalls: SeenCall[] = [];
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    const modelTimedOut = await handleImportWorkout(post({ source: 'Bench' }), {
      env: testEnv(),
      fetch: route({ calls: modelCalls, hangModel: true }),
      modelTimeoutMs: 20,
    });
    assertEquals(modelTimedOut.status, 504);
    const body = await modelTimedOut.json();
    assertEquals(body, { error: 'import_upstream_timeout' });
    safe(JSON.stringify(body));
    assertEquals(modelCalls.length, 3);
    assertEquals(JSON.parse(lines[0] ?? ''), {
      upstream_status: null,
      error_type: 'timeout',
      error_code: null,
      error_param: null,
    });
    assertTrue(!(lines[0] ?? '').includes('Bench'));
  } finally {
    console.log = originalLog;
  }
});

Deno.test('concurrent requests cannot pass a shared per-user quota', async () => {
  let chain = Promise.resolve();
  const counts = new Map<string, number>();
  let modelCalls = 0;
  const consumeQuota = (jwt: string) => {
    const run = chain.then(() => {
      const used = counts.get(jwt) ?? 0;
      if (used >= 2) {
        return { ok: false as const, error: 'rate_limited_burst' as const };
      }
      counts.set(jwt, used + 1);
      return { ok: true as const };
    });
    chain = run.then(() => undefined, () => undefined);
    return run;
  };
  const jwtA = userJwt(USER_ID);
  const jwtB = userJwt(OTHER_ID);
  const requests = [
    ...Array.from({ length: 3 }, () => jwtA),
    jwtB,
  ].map((jwt) => handleImportWorkout(post({ source: 'Bench' }, jwt), {
    env: testEnv(),
    verifyUser: async (token) => ({ ok: true, userId: token === jwtB ? OTHER_ID : USER_ID }),
    consumeQuota,
    fetch: (async () => {
      modelCalls += 1;
      return new Response(JSON.stringify({ output_text: JSON.stringify(validDraft) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  }));
  const responses = await Promise.all(requests);
  const bodies = await Promise.all(responses.map(async (response) => ({
    status: response.status,
    body: await response.json(),
  })));
  const limited = bodies.filter((body) => body.status === 429);
  const accepted = bodies.filter((body) => body.status === 200);
  assertEquals(limited.length, 1);
  assertEquals(accepted.length, 3);
  assertEquals(limited[0]?.body, { error: 'rate_limited_burst' });
  assertEquals(modelCalls, 3);
  assertEquals(counts.get(jwtA), 2);
  assertEquals(counts.get(jwtB), 1);
});

Deno.test('direct auth and quota helpers reject bad tokens and map database errors', async () => {
  const calls: SeenCall[] = [];
  const publishable = await verifySupabaseUser(ANON_KEY, testEnv(), route({ calls }));
  assertEquals(publishable, { ok: false, error: 'unauthorized' });
  const quota = await consumeAiImportQuota(userJwt(), testEnv(), route({
    calls,
    quotaStatus: 400,
    quotaBody: { message: 'rate_limited_daily', hint: UPSTREAM_SECRET },
  }));
  assertEquals(quota, { ok: false, error: 'rate_limited_daily' });
  assertTrue(calls.every((call) => call.url.startsWith(ORIGIN)));
  const unauthenticated = await consumeAiImportQuota(userJwt(), testEnv(), route({
    calls: [],
    quotaStatus: 401,
    quotaBody: { message: 'Not authenticated' },
  }));
  assertEquals(unauthenticated, { ok: false, error: 'unauthorized' });
});

Deno.test('malformed OpenAI responses fail closed without leaking upstream text', async () => {
  const refusal = `${UPSTREAM_SECRET} refusal`;
  const cases: Array<{ modelBody?: unknown; modelText?: string }> = [
    {
      modelBody: {
        status: 'completed',
        error: null,
        output: [{ type: 'message', content: [{ type: 'refusal', refusal }] }],
      },
    },
    {
      modelBody: {
        status: 'completed',
        error: null,
        output_text: JSON.stringify(validDraft),
        output: [{ type: 'message', content: [{ type: 'refusal', refusal }] }],
      },
    },
    {
      modelBody: {
        status: 'failed',
        error: { message: UPSTREAM_SECRET, code: 'server_error' },
      },
    },
    { modelBody: { error: { message: UPSTREAM_SECRET } } },
    {
      modelBody: {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output_text: `{"programName":"${UPSTREAM_SECRET}"`,
      },
    },
    { modelBody: { status: 'cancelled', output_text: UPSTREAM_SECRET } },
    { modelBody: { status: 'completed', output: [{ type: 'message', content: [] }] } },
    { modelBody: { status: 'completed', output_text: '' } },
    { modelBody: { output_text: 12 } },
    { modelBody: { output_text: { leaked: UPSTREAM_SECRET } } },
    { modelText: `<html>${UPSTREAM_SECRET}</html>` },
    { modelText: 'not-json {' },
  ];
  for (const item of cases) {
    const calls: SeenCall[] = [];
    const response = await handleImportWorkout(post({ source: 'Bench' }), {
      env: testEnv(),
      fetch: route({ calls, ...item }),
    });
    assertEquals(response.status, 502);
    const body = await response.json();
    assertEquals(body, { error: 'import_failed' });
    safe(JSON.stringify(body));
    assertEquals(calls.length, 3);
    assertEquals(calls[2]?.url, MODEL_URL);
    assertTrue(!(calls[2]?.body ?? '').includes(API_KEY));
  }

  const acceptedCalls: SeenCall[] = [];
  const accepted = await handleImportWorkout(post({ source: 'Bench' }), {
    env: testEnv(),
    fetch: route({
      calls: acceptedCalls,
      modelBody: {
        id: 'resp_local',
        status: 'completed',
        error: null,
        incomplete_details: null,
        output_text: JSON.stringify(validDraft),
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify(validDraft), annotations: [] }],
        }],
      },
    }),
  });
  assertEquals(accepted.status, 200);
  assertEquals(await accepted.json(), validDraft);
  assertEquals(acceptedCalls[2]?.url, MODEL_URL);
});

Deno.test('OpenAI statuses are classified and logs omit secrets and source text', async () => {
  const leakMessage = 'Incorrect API key sk-test-do-not-log';
  const sourceText = 'private routine source text';
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    const cases: Array<{
      status: number;
      body: unknown;
      error: string;
      httpStatus: number;
      log: Record<string, unknown>;
    }> = [
      {
        status: 400,
        body: {
          error: {
            message: leakMessage,
            type: 'invalid_request_error',
            code: 'invalid_json_schema',
            param: 'text.format.schema',
          },
        },
        error: 'import_upstream_rejected',
        httpStatus: 502,
        log: {
          upstream_status: 400,
          error_type: 'invalid_request_error',
          error_code: 'invalid_json_schema',
          error_param: 'text.format.schema',
        },
      },
      {
        status: 401,
        body: {
          error: {
            message: leakMessage,
            type: 'invalid_request_error',
            code: 'invalid_api_key',
            param: null,
          },
        },
        error: 'import_upstream_auth',
        httpStatus: 502,
        log: {
          upstream_status: 401,
          error_type: 'invalid_request_error',
          error_code: 'invalid_api_key',
          error_param: null,
        },
      },
      {
        status: 403,
        body: {
          error: {
            message: leakMessage,
            type: leakMessage,
            code: 'permission_denied',
            param: `Bearer ${API_KEY}`,
          },
        },
        error: 'import_upstream_auth',
        httpStatus: 502,
        log: {
          upstream_status: 403,
          error_type: null,
          error_code: 'permission_denied',
          error_param: null,
        },
      },
      {
        status: 429,
        body: {
          error: {
            message: leakMessage,
            type: 'requests',
            code: 'rate_limit_exceeded',
            param: null,
          },
        },
        error: 'import_upstream_rate_limited',
        httpStatus: 502,
        log: {
          upstream_status: 429,
          error_type: 'requests',
          error_code: 'rate_limit_exceeded',
          error_param: null,
        },
      },
      {
        status: 429,
        body: {
          error: {
            message: leakMessage,
            type: 'insufficient_quota',
            code: 'insufficient_quota',
            param: null,
          },
        },
        error: 'import_upstream_billing',
        httpStatus: 502,
        log: {
          upstream_status: 429,
          error_type: 'insufficient_quota',
          error_code: 'insufficient_quota',
          error_param: null,
        },
      },
      {
        status: 500,
        body: {
          error: {
            message: leakMessage,
            type: 'server_error',
            code: 'server_error',
            param: null,
          },
        },
        error: 'import_upstream_failed',
        httpStatus: 502,
        log: {
          upstream_status: 500,
          error_type: 'server_error',
          error_code: 'server_error',
          error_param: null,
        },
      },
    ];
    for (const item of cases) {
      lines.length = 0;
      const calls: SeenCall[] = [];
      const response = await handleImportWorkout(post({ source: sourceText }), {
        env: testEnv(),
        fetch: route({ calls, modelStatus: item.status, modelBody: item.body }),
      });
      assertEquals(response.status, item.httpStatus);
      const body = await response.json();
      assertEquals(body, { error: item.error });
      safe(JSON.stringify(body));
      assertTrue(!JSON.stringify(body).includes(leakMessage));
      assertTrue(!JSON.stringify(body).includes(sourceText));
      assertEquals(calls.length, 3);
      assertEquals(calls[2]?.url, MODEL_URL);
      assertEquals(lines.length, 1);
      assertEquals(JSON.parse(lines[0] ?? ''), item.log);
      const logged = lines[0] ?? '';
      assertTrue(!logged.includes(leakMessage));
      assertTrue(!logged.includes(sourceText));
      assertTrue(!logged.includes(API_KEY));
      assertTrue(!logged.includes(USER_ID));
      assertTrue(!logged.includes('authorization'));
      assertEquals(Object.keys(JSON.parse(logged)).sort(), [
        'error_code',
        'error_param',
        'error_type',
        'upstream_status',
      ]);
    }

    lines.length = 0;
    const malformedCalls: SeenCall[] = [];
    const malformed = await handleImportWorkout(post({ source: sourceText }), {
      env: testEnv(),
      fetch: route({
        calls: malformedCalls,
        modelStatus: 200,
        modelText: `not-json ${leakMessage}`,
      }),
    });
    assertEquals(malformed.status, 502);
    const malformedBody = await malformed.json();
    assertEquals(malformedBody, { error: 'import_failed' });
    safe(JSON.stringify(malformedBody));
    assertTrue(!JSON.stringify(malformedBody).includes(leakMessage));
    assertEquals(lines.length, 0);
    assertEquals(malformedCalls.length, 3);

    lines.length = 0;
    const validCalls: SeenCall[] = [];
    const valid = await handleImportWorkout(post({ source: sourceText }), {
      env: testEnv(),
      fetch: route({ calls: validCalls, modelBody: { output_text: JSON.stringify(validDraft) } }),
    });
    assertEquals(valid.status, 200);
    assertEquals(await valid.json(), validDraft);
    assertEquals(lines.length, 0);
    assertTrue(!(validCalls[2]?.body ?? '').includes(API_KEY));
    assertTrue((validCalls[2]?.body ?? '').includes(sourceText));

    lines.length = 0;
    const fetchFailed = await handleImportWorkout(post({ source: sourceText }), {
      env: testEnv(),
      verifyUser: async () => ({ ok: true, userId: USER_ID }),
      consumeQuota: async () => ({ ok: true }),
      fetch: (() => Promise.reject(new Error(`network ${API_KEY} ${sourceText}`))) as typeof fetch,
    });
    assertEquals(fetchFailed.status, 502);
    assertEquals(await fetchFailed.json(), { error: 'import_upstream_failed' });
    assertEquals(lines.length, 1);
    assertEquals(JSON.parse(lines[0] ?? ''), {
      upstream_status: null,
      error_type: 'fetch_failed',
      error_code: null,
      error_param: null,
    });
    assertTrue(!(lines[0] ?? '').includes(API_KEY));
    assertTrue(!(lines[0] ?? '').includes(sourceText));
  } finally {
    console.log = originalLog;
  }
});

Deno.test('localhost preflight is allowlisted and does not reach auth or quota', async () => {
  const calls: SeenCall[] = [];
  const headers = {
    'access-control-request-method': 'POST',
    'access-control-request-headers': 'Authorization, apikey, X-Client-Info, Content-Type',
  };
  for (const origin of LOCALHOST_DEV_ORIGINS) {
    const response = await handleImportWorkout(
      new Request('http://127.0.0.1/import-workout', {
        method: 'OPTIONS',
        headers: { ...headers, origin },
      }),
      { env: testEnv(), fetch: route({ calls }) },
    );
    assertEquals(response.status, 204);
    assertEquals(response.headers.get('access-control-allow-origin'), origin);
    assertEquals(
      response.headers.get('access-control-allow-headers'),
      'authorization, apikey, x-client-info, content-type',
    );
    assertEquals(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
    assertEquals(await response.text(), '');
  }
  assertEquals(calls.length, 0);

  const rejected = await handleImportWorkout(
    new Request('http://127.0.0.1/import-workout', {
      method: 'OPTIONS',
      headers: { ...headers, origin: 'https://evil.example' },
    }),
    { env: testEnv(), fetch: route({ calls }) },
  );
  assertEquals(rejected.status, 403);
  assertEquals(rejected.headers.get('access-control-allow-origin'), null);
  assertTrue(!(await rejected.text()).includes('https://evil.example'));

  const extraHeader = await handleImportWorkout(
    new Request('http://127.0.0.1/import-workout', {
      method: 'OPTIONS',
      headers: {
        ...headers,
        origin: LOCALHOST_DEV_ORIGINS[0],
        'access-control-request-headers': 'authorization, x-evil',
      },
    }),
    { env: testEnv(), fetch: route({ calls }) },
  );
  assertEquals(extraHeader.status, 403);
  assertEquals(extraHeader.headers.get('access-control-allow-origin'), null);

  const denied = await handleImportWorkout(
    new Request('http://127.0.0.1/import-workout', {
      method: 'POST',
      headers: {
        origin: LOCALHOST_DEV_ORIGINS[0],
        'content-type': 'application/json',
      },
      body: JSON.stringify({ source: 'Bench' }),
    }),
    { env: testEnv(), fetch: route({ calls }) },
  );
  assertEquals(denied.status, 401);
  assertEquals(await denied.json(), { error: 'unauthorized' });
  assertEquals(denied.headers.get('access-control-allow-origin'), LOCALHOST_DEV_ORIGINS[0]);
  assertEquals(denied.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assertEquals(calls.length, 0);

  const foreign = await handleImportWorkout(
    new Request('http://127.0.0.1/import-workout', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ source: 'Bench' }),
    }),
    { env: testEnv(), fetch: route({ calls }) },
  );
  assertEquals(foreign.status, 401);
  assertEquals(foreign.headers.get('access-control-allow-origin'), null);
  assertEquals(calls.length, 0);
});

Deno.test('nested model output is accepted and the source stays undeployed', async () => {
  const calls: SeenCall[] = [];
  const nested = await handleImportWorkout(post({ source: 'Squat' }), {
    env: testEnv(),
    fetch: route({
      calls,
      modelBody: { output: [{ content: [{ text: JSON.stringify(validDraft) }] }] },
    }),
  });
  assertEquals(nested.status, 200);
  assertEquals(await nested.json(), validDraft);

  const wrongCalls: SeenCall[] = [];
  const wrongMethod = await handleImportWorkout(
    new Request('http://127.0.0.1/import-workout', { method: 'GET' }),
    { env: testEnv(), fetch: route({ calls: wrongCalls }) },
  );
  assertEquals(wrongMethod.status, 405);
  assertEquals(wrongCalls.length, 0);
  const missingCalls: SeenCall[] = [];
  const missingKey = await handleImportWorkout(post({ source: 'Squat' }), {
    env: testEnv({ OPENAI_API_KEY: undefined }),
    fetch: route({ calls: missingCalls }),
  });
  assertEquals(missingKey.status, 500);
  assertEquals(await missingKey.json(), { error: 'import_unconfigured' });
  assertEquals(missingCalls.length, 1);
  assertEquals(missingCalls[0]?.url, `${ORIGIN}/auth/v1/user`);
  assertTrue(missingCalls.every((call) => !call.url.includes('api.openai.com')));
  assertTrue(missingCalls.every((call) => !call.url.includes('consume_ai_import_quota')));

  const blankCalls: SeenCall[] = [];
  const blankKey = await handleImportWorkout(post({ source: 'Squat' }), {
    env: testEnv({ OPENAI_API_KEY: '   ' }),
    fetch: route({ calls: blankCalls }),
  });
  assertEquals(blankKey.status, 500);
  assertEquals(await blankKey.json(), { error: 'import_unconfigured' });
  assertEquals(blankCalls.length, 1);
  assertTrue(blankCalls.every((call) => !call.url.includes('api.openai.com')));

  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  const requestSource = await Deno.readTextFile(
    new URL('../../../lib/import/build-import-model-request.ts', import.meta.url),
  );
  const config = await Deno.readTextFile(new URL('../../config.toml', import.meta.url));
  assertTrue(source.includes('NOT DEPLOYED'));
  assertTrue(source.includes('OPENAI_API_KEY'));
  assertTrue(source.includes('api.openai.com'));
  assertTrue(!source.includes('XAI_API_KEY'));
  assertTrue(!source.includes('api.x.ai'));
  assertTrue(!requestSource.includes('XAI_API_KEY'));
  assertTrue(!requestSource.includes('api.x.ai'));
  assertTrue(!requestSource.includes('OPENAI_API_KEY'));
  assertTrue(!source.includes('workout_sets'));
  assertTrue(!source.includes('workout_sessions'));
  assertTrue(!source.includes('SERVICE_ROLE'));
  assertTrue(source.includes('consume_ai_import_quota'));
  assertTrue(source.includes('../../../lib/import/build-import-model-request.ts'));
  assertTrue(config.includes('project_id = "kbwaxskykqaymzdytjxv"'));
  assertTrue(config.includes('verify_jwt = true'));
  assertTrue(!config.includes('verify_jwt = false'));
  assertTrue(!source.includes("'*'"));
  assertTrue(source.includes('LOCALHOST_DEV_ORIGINS'));
  assertTrue(!config.includes('OPENAI_API_KEY'));
  assertTrue(!config.includes('XAI_API_KEY'));
  const request = buildImportModelRequest('Squat');
  assertEquals(new URL(request.url).hostname, 'api.openai.com');
  assertEquals(request.body.model, 'gpt-4.1-mini');
  console.log('import workout edge function checks passed');
});
