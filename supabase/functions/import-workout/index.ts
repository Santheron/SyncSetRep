// NOT DEPLOYED.
// Reads XAI_API_KEY from the function environment and returns a draft.
// It does not write programs, days, exercises, or workout history.
// The phone validates the draft and saves only through the reviewed save path.

import { buildImportModelRequest } from '../../../lib/import/build-import-model-request.ts';

const TEXT_MAX_CHARS = 20_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function draftText(payload: {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ text?: unknown }> }>;
}): string | null {
  if (typeof payload.output_text === 'string' && payload.output_text.trim() !== '') {
    return payload.output_text;
  }
  for (const item of payload.output ?? []) {
    for (const part of item.content ?? []) {
      if (typeof part.text === 'string' && part.text.trim() !== '') {
        return part.text;
      }
    }
  }
  return null;
}

export async function handleImportWorkout(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  const key = Deno.env.get('XAI_API_KEY');
  if (!key) {
    return json({ error: 'import_unconfigured' }, 500);
  }
  let source = '';
  try {
    const body = await request.json();
    source = typeof body?.source === 'string' ? body.source.trim() : '';
  } catch {
    return json({ error: 'invalid_import' }, 400);
  }
  if (source.length === 0 || source.length > TEXT_MAX_CHARS) {
    return json({ error: 'invalid_import' }, 400);
  }

  const modelRequest = buildImportModelRequest(source);
  const modelResponse = await fetch(modelRequest.url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(modelRequest.body),
  });
  if (!modelResponse.ok) {
    return json({ error: 'import_failed' }, 502);
  }
  const text = draftText(await modelResponse.json());
  if (text == null) {
    return json({ error: 'import_failed' }, 502);
  }
  try {
    return json(JSON.parse(text));
  } catch {
    return json({ error: 'import_failed' }, 502);
  }
}

if (Deno.env.get('IMPORT_WORKOUT_NO_SERVE') !== '1') {
  Deno.serve(handleImportWorkout);
}
