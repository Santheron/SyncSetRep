import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const supabase = createClient(
  env.EXPO_PUBLIC_SUPABASE_URL,
  env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function summarizeError(error) {
  if (!error) {
    return null;
  }

  return {
    code: error.code ?? null,
    message: error.message ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
  };
}

const queries = [
  ['program_days', () => supabase.from('program_days').select('*').order('day_order')],
  ['program_exercises', () => supabase.from('program_exercises').select('*')],
  ['exercises', () => supabase.from('exercises').select('*')],
  ['workout_sessions_count', () => supabase.from('workout_sessions').select('id', { count: 'exact', head: true })],
  ['workout_sets_count', () => supabase.from('workout_sets').select('id', { count: 'exact', head: true })],
];

for (const [name, run] of queries) {
  const { data, error, count } = await run();
  console.log(
    JSON.stringify(
      {
        table: name,
        ok: !error,
        rowCount: Array.isArray(data) ? data.length : count ?? null,
        error: summarizeError(error),
      },
      null,
      2,
    ),
  );
}
