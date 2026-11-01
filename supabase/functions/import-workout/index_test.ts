Deno.env.set('IMPORT_WORKOUT_NO_SERVE', '1');
Deno.env.set('XAI_API_KEY', 'local-test-key');

const { handleImportWorkout } = await import('./index.ts');
const { buildImportModelRequest } = await import('../../../lib/import/build-import-model-request.ts');

const draft = {
  programName: { origin: 'extracted', value: 'Upper Lower' },
  warnings: [],
  issues: [],
  days: [],
};

Deno.test('import workout edge function uses mocked model responses', async () => {
const originalFetch = globalThis.fetch;
const calls: Array<{ url: string; authorization: string; body: string }> = [];

function mockFetch(status: number, payload: unknown): void {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get('authorization') ?? '',
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function request(source: string, method = 'POST'): Request {
  return new Request('http://127.0.0.1/import-workout', {
    method,
    body: method === 'POST' ? JSON.stringify({ source }) : undefined,
    headers: { 'content-type': 'application/json' },
  });
}

try {
  const wrongMethod = await handleImportWorkout(request('', 'GET'));
  assertEquals(wrongMethod.status, 405);
  assertEquals(calls.length, 0);

  const empty = await handleImportWorkout(request('   '));
  assertEquals(empty.status, 400);
  assertEquals(await empty.json(), { error: 'invalid_import' });
  assertEquals(calls.length, 0);

  const tooLong = await handleImportWorkout(request('a'.repeat(20_001)));
  assertEquals(tooLong.status, 400);
  assertEquals(calls.length, 0);

  Deno.env.delete('XAI_API_KEY');
  const unconfigured = await handleImportWorkout(request('Bench press'));
  assertEquals(unconfigured.status, 500);
  assertEquals(await unconfigured.json(), { error: 'import_unconfigured' });
  assertEquals(calls.length, 0);
  Deno.env.set('XAI_API_KEY', 'local-test-key');

  mockFetch(200, { output_text: JSON.stringify(draft) });
  const accepted = await handleImportWorkout(request(' Bench press 3 x 8 '));
  assertEquals(accepted.status, 200);
  assertEquals(await accepted.json(), draft);
  assertEquals(calls.length, 1);
  const expected = buildImportModelRequest('Bench press 3 x 8');
  assertEquals(calls[0]?.url, expected.url);
  assertEquals(calls[0]?.authorization, 'Bearer local-test-key');
  assertEquals(JSON.parse(calls[0]?.body ?? '{}'), expected.body);
  assertEquals(accepted.headers.get('content-type'), 'application/json');
  assertEquals(JSON.stringify(draft).includes('local-test-key'), false);

  mockFetch(200, {
    output: [{ content: [{ text: JSON.stringify(draft) }] }],
  });
  const nested = await handleImportWorkout(request('Squat'));
  assertEquals(nested.status, 200);
  assertEquals(await nested.json(), draft);

  mockFetch(503, { error: 'upstream' });
  const upstream = await handleImportWorkout(request('Squat'));
  assertEquals(upstream.status, 502);
  assertEquals(await upstream.json(), { error: 'import_failed' });

  mockFetch(200, { output_text: 'not-json' });
  const unreadable = await handleImportWorkout(request('Squat'));
  assertEquals(unreadable.status, 502);
  assertEquals(await unreadable.json(), { error: 'import_failed' });

  const source = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assertEquals(source.includes('NOT DEPLOYED'), true);
  assertEquals(source.includes('workout_sets'), false);
  assertEquals(source.includes('workout_sessions'), false);
  assertEquals(source.includes('SERVICE_ROLE'), false);
  console.log('import workout edge function checks passed');
} finally {
  globalThis.fetch = originalFetch;
}
});

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) {
    throw new Error(`expected ${right} but received ${left}`);
  }
}
