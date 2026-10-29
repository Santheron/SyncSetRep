-- NOT APPLIED. Run only after the read-only preflight has been reviewed.
-- Adds per-user import quota. Does not alter programs, days, exercises, or history.
-- Does not add rest_seconds or an alias table.
-- Does not grant privileges to anon or PUBLIC.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_import_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_import_attempts_kind_check CHECK (kind IN ('pdf', 'model'))
);

CREATE INDEX IF NOT EXISTS ai_import_attempts_user_kind_created_idx
  ON public.ai_import_attempts (user_id, kind, created_at DESC);

ALTER TABLE public.ai_import_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_import_attempts FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.ai_import_attempts TO authenticated;

DROP POLICY IF EXISTS ai_import_attempts_select_own ON public.ai_import_attempts;
CREATE POLICY ai_import_attempts_select_own
  ON public.ai_import_attempts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP FUNCTION IF EXISTS public.consume_ai_import_quota();

CREATE OR REPLACE FUNCTION public.consume_ai_import_quota(p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $quota$
DECLARE
  uid uuid := auth.uid();
  burst integer;
  daily integer;
  burst_cap integer;
  daily_cap integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_kind IS DISTINCT FROM 'pdf' AND p_kind IS DISTINCT FROM 'model' THEN
    RAISE EXCEPTION 'quota_unavailable';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ai-import:' || uid::text, 0));

  IF p_kind = 'pdf' THEN
    burst_cap := 8;
    daily_cap := 40;
  ELSE
    burst_cap := 2;
    daily_cap := 5;
  END IF;

  SELECT count(*) INTO burst
  FROM public.ai_import_attempts
  WHERE user_id = uid
    AND kind = p_kind
    AND created_at > now() - interval '10 minutes';

  IF burst >= burst_cap THEN
    RAISE EXCEPTION 'rate_limited_burst';
  END IF;

  SELECT count(*) INTO daily
  FROM public.ai_import_attempts
  WHERE user_id = uid
    AND kind = p_kind
    AND created_at > now() - interval '24 hours';

  IF daily >= daily_cap THEN
    RAISE EXCEPTION 'rate_limited_daily';
  END IF;

  INSERT INTO public.ai_import_attempts (user_id, kind)
  VALUES (uid, p_kind);
END;
$quota$;

REVOKE ALL ON FUNCTION public.consume_ai_import_quota(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_import_quota(text) TO authenticated;

COMMIT;
