-- NOT APPLIED.
-- Do not run this file on production.
-- Adds explicit tracking columns for new sets and routine prescriptions.
-- Does not UPDATE existing workout_sets or program_exercises rows.
-- Existing rows keep load_mode NULL, assistance NULL, and weight_unit NULL.
-- Their weight values stay exactly as recorded, including zero and negative
-- numbers. This file does not add a blanket weight >= 0 check.
-- record_tracked_set writes only an unfinished session owned by auth.uid().
-- A finished session raises history_locked and is left unchanged.
-- The phone must not call record_tracked_set while PERSIST_LOAD_MODE is false.
-- PostgreSQL grants EXECUTE to PUBLIC on a new function. Default privileges
-- can also grant anon, authenticated, or service_role. A direct grant is
-- separate from PUBLIC, and another signature keeps its own grant.
-- CREATE OR REPLACE keeps an existing grant. This file revokes PUBLIC, anon,
-- authenticated, and service_role after creating the function and does not
-- give EXECUTE back. sql/routine-write-enablement.sql is the later grant.
-- Rollback: sql/load-mode-rollback.sql. It refuses while any load_mode,
-- assistance, or weight_unit value is stored. When every value is NULL,
-- dropping the columns leaves workout_sets.weight unchanged.
-- Finished historical weights are never written by this function.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.workout_sets
  ADD COLUMN load_mode text,
  ADD COLUMN assistance numeric,
  ADD COLUMN weight_unit text;

ALTER TABLE public.program_exercises
  ADD COLUMN load_mode text;

ALTER TABLE public.workout_sets
  ADD CONSTRAINT workout_sets_tracked_load_check CHECK (
    (
      load_mode IS NULL
      AND assistance IS NULL
      AND weight_unit IS NULL
    )
    OR (
      load_mode = 'bodyweight'
      AND weight_unit IN ('lb', 'kg')
      AND assistance IS NULL
      AND (weight IS NULL OR weight = 0)
    )
    OR (
      load_mode = 'added'
      AND weight_unit IN ('lb', 'kg')
      AND assistance IS NULL
      AND weight > 0
    )
    OR (
      load_mode = 'assisted'
      AND weight_unit IN ('lb', 'kg')
      AND assistance > 0
      AND (weight IS NULL OR weight = 0)
    )
  );

ALTER TABLE public.program_exercises
  ADD CONSTRAINT program_exercises_load_mode_check CHECK (
    load_mode IS NULL OR load_mode IN ('bodyweight', 'added', 'assisted')
  );

CREATE OR REPLACE FUNCTION public.record_tracked_set(
  p_session_id bigint,
  p_exercise_id bigint,
  p_set_number integer,
  p_load_mode text,
  p_weight numeric,
  p_assistance numeric,
  p_weight_unit text,
  p_reps integer,
  p_rir integer,
  p_is_completed boolean
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $tracked$
DECLARE
  uid uuid := auth.uid();
  session_owner uuid;
  session_finished timestamptz;
  existing_id bigint;
  stored_weight numeric;
  stored_assistance numeric;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '30s', true);

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_session_id IS NULL OR p_session_id < 1
     OR p_exercise_id IS NULL OR p_exercise_id < 1
     OR p_set_number IS NULL OR p_set_number < 1 THEN
    RAISE EXCEPTION 'invalid_tracked_set';
  END IF;

  IF p_weight_unit IS DISTINCT FROM 'lb' AND p_weight_unit IS DISTINCT FROM 'kg' THEN
    RAISE EXCEPTION 'invalid_weight_unit';
  END IF;

  IF p_weight < 0 OR p_assistance < 0 THEN
    RAISE EXCEPTION 'invalid_load_amount';
  END IF;

  IF p_load_mode = 'bodyweight' THEN
    IF p_assistance IS NOT NULL OR (p_weight IS NOT NULL AND p_weight <> 0) THEN
      RAISE EXCEPTION 'invalid_load_amount';
    END IF;
    stored_weight := NULL;
    stored_assistance := NULL;
  ELSIF p_load_mode = 'added' THEN
    IF p_weight IS NULL OR p_weight <= 0 OR p_assistance IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_load_amount';
    END IF;
    stored_weight := p_weight;
    stored_assistance := NULL;
  ELSIF p_load_mode = 'assisted' THEN
    IF p_assistance IS NULL OR p_assistance <= 0
       OR (p_weight IS NOT NULL AND p_weight <> 0) THEN
      RAISE EXCEPTION 'invalid_load_amount';
    END IF;
    stored_weight := NULL;
    stored_assistance := p_assistance;
  ELSE
    RAISE EXCEPTION 'invalid_load_mode';
  END IF;

  SELECT user_id, finished_at
  INTO session_owner, session_finished
  FROM public.workout_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF session_owner IS NULL OR session_owner IS DISTINCT FROM uid THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF session_finished IS NOT NULL THEN
    RAISE EXCEPTION 'history_locked';
  END IF;

  SELECT id
  INTO existing_id
  FROM public.workout_sets
  WHERE workout_session_id = p_session_id
    AND exercise_id = p_exercise_id
    AND set_number = p_set_number
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF existing_id IS NOT NULL THEN
    UPDATE public.workout_sets
    SET weight = stored_weight,
        assistance = stored_assistance,
        load_mode = p_load_mode,
        weight_unit = p_weight_unit,
        reps = p_reps,
        rir = p_rir,
        is_completed = p_is_completed
    WHERE id = existing_id;
    RETURN existing_id;
  END IF;

  INSERT INTO public.workout_sets (
    workout_session_id,
    exercise_id,
    set_number,
    weight,
    assistance,
    load_mode,
    weight_unit,
    reps,
    rir,
    is_completed
  )
  VALUES (
    p_session_id,
    p_exercise_id,
    p_set_number,
    stored_weight,
    stored_assistance,
    p_load_mode,
    p_weight_unit,
    p_reps,
    p_rir,
    p_is_completed
  )
  RETURNING id INTO existing_id;

  RETURN existing_id;
END;
$tracked$;

REVOKE ALL ON FUNCTION public.record_tracked_set(
  bigint, bigint, integer, text, numeric, numeric, text, integer, integer, boolean
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
