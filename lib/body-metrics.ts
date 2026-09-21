import { supabase } from '@/lib/supabase';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type BodyMetric = {
  id: string;
  recorded_at: string;
  bodyweight: number | null;
  waist: number | null;
  body_fat: number | null;
  notes: string | null;
};

export type BodyMetricInput = {
  recorded_at?: string;
  bodyweight: number | null;
  waist: number | null;
  body_fat: number | null;
  notes?: string | null;
};

export function parseOptionalMetric(
  value: string,
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = value.trim();

  if (!trimmed) {
    return { ok: true, value: null };
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false };
  }

  return { ok: true, value: parsed };
}

export function formatMetricNumber(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

export async function listBodyMetrics(): Promise<Result<BodyMetric[]>> {
  const { data, error } = await supabase
    .from('body_metrics')
    .select('id, recorded_at, bodyweight, waist, body_fat, notes')
    .order('recorded_at', { ascending: false });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data ?? []) as BodyMetric[] };
}

export async function insertBodyMetric(input: BodyMetricInput): Promise<Result<true>> {
  const { error } = await supabase.from('body_metrics').insert({
    recorded_at: input.recorded_at ?? new Date().toISOString(),
    bodyweight: input.bodyweight,
    waist: input.waist,
    body_fat: input.body_fat,
    notes: input.notes ?? null,
  });

  if (error) {
    console.log('[insertBodyMetric] error', {
      error_code: error.code,
      error_message: error.message,
    });
    return { ok: false, error: error.message };
  }

  return { ok: true, data: true };
}
