-- NOT APPLIED.
-- Do not run this file on production.
-- Adds exercises.owner_user_id. NULL is the shared catalog.
-- A non-null value is private to that auth.uid().
-- Existing rows stay NULL. This file does not UPDATE exercises.
-- It does not reuse or change an exercise id.
-- exercises_name_key UNIQUE (name) stays. Two accounts cannot store the
-- same exercise name. A second owner raises exercise_name_taken.
-- A shared catalog name raises use_catalog_exercise.
-- Production already grants ALL on public.exercises to authenticated.
-- This file does not grant or revoke table privileges.
-- The select policy becomes owner-null OR owner = auth.uid().
-- Authenticated may insert and update only rows they own.
-- There is no delete policy. Authenticated delete stays denied by RLS.
-- program_exercises.exercise_id changes from ON DELETE CASCADE to
-- NO ACTION, so a later delete cannot remove routine rows silently.
-- workout_sets.exercise_id is already NO ACTION and is left unchanged.
-- seed_standard_exercises writes category, exercise type, and equipment
-- from the payload. It does not leave new rows on the machine default.
-- It inserts only when the normalized name is absent, and never updates.
-- PostgreSQL grants EXECUTE to PUBLIC on a new function. Default privileges
-- can also grant anon, authenticated, or service_role. A direct grant is
-- separate from PUBLIC, and another signature keeps its own grant.
-- CREATE OR REPLACE keeps an existing grant. This file revokes PUBLIC, anon,
-- authenticated, and service_role and does not give EXECUTE back.
-- sql/routine-write-enablement.sql is the later grant.
-- Rollback: sql/exercise-ownership-rollback.sql.
-- When every owner_user_id is NULL, that rollback restores the production
-- select policy and ON DELETE CASCADE. It does not change table grants or
-- exercises_name_key. It refuses while any custom owner is still recorded.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.exercises
  ADD COLUMN owner_user_id uuid REFERENCES auth.users (id);

DO $fk$
DECLARE
  delete_action "char";
BEGIN
  SELECT con.confdeltype
  INTO delete_action
  FROM pg_catalog.pg_constraint con
  WHERE con.conname = 'program_exercises_exercise_id_fkey'
    AND con.conrelid = 'public.program_exercises'::regclass
    AND con.confrelid = 'public.exercises'::regclass;

  IF delete_action IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION 'exercise_fk_schema';
  END IF;
END
$fk$;

ALTER TABLE public.program_exercises
  DROP CONSTRAINT program_exercises_exercise_id_fkey;

ALTER TABLE public.program_exercises
  ADD CONSTRAINT program_exercises_exercise_id_fkey
  FOREIGN KEY (exercise_id) REFERENCES public.exercises (id);

DO $policy$
DECLARE
  policy_expr text;
BEGIN
  SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid)
  INTO policy_expr
  FROM pg_catalog.pg_policy pol
  WHERE pol.polrelid = 'public.exercises'::regclass
    AND pol.polname = 'exercises_select_authenticated';

  IF policy_expr IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'exercise_policy_schema';
  END IF;
END
$policy$;

CREATE OR REPLACE FUNCTION public.normalize_exercise_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $norm$
  SELECT pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.lower(pg_catalog.btrim(COALESCE(p_name, ''))),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$norm$;

REVOKE ALL ON FUNCTION public.normalize_exercise_name(text) FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY exercises_select_authenticated ON public.exercises;

ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exercises_select_visible ON public.exercises;
CREATE POLICY exercises_select_visible ON public.exercises
  FOR SELECT TO authenticated
  USING (owner_user_id IS NULL OR owner_user_id = auth.uid());

DROP POLICY IF EXISTS exercises_insert_own ON public.exercises;
CREATE POLICY exercises_insert_own ON public.exercises
  FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS exercises_update_own ON public.exercises;
CREATE POLICY exercises_update_own ON public.exercises
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

DROP POLICY IF EXISTS exercises_delete_own ON public.exercises;

CREATE OR REPLACE FUNCTION public.seed_standard_exercises(p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $seed$
DECLARE
  item jsonb;
  raw_name text;
  clean_name text;
  normalized text;
  category text;
  equipment_type text;
  exercise_type text;
  inserted integer := 0;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '30s', true);

  IF pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_exercise_name';
  END IF;

  FOR item IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_items)
  LOOP
    category := NULL;
    equipment_type := NULL;
    exercise_type := NULL;
    IF pg_catalog.jsonb_typeof(item) = 'string' THEN
      raw_name := item #>> '{}';
    ELSIF pg_catalog.jsonb_typeof(item) = 'object' THEN
      raw_name := item->>'name';
      category := COALESCE(item->>'category', item->>'muscle');
      equipment_type := COALESCE(item->>'equipment_type', item->>'equipment');
      exercise_type := item->>'exercise_type';
    ELSE
      RAISE EXCEPTION 'invalid_exercise_name';
    END IF;

    clean_name := pg_catalog.btrim(raw_name);
    normalized := public.normalize_exercise_name(clean_name);
    category := NULLIF(pg_catalog.btrim(category), '');
    equipment_type := NULLIF(pg_catalog.lower(pg_catalog.btrim(equipment_type)), '');
    exercise_type := NULLIF(pg_catalog.btrim(exercise_type), '');
    IF clean_name IS NULL
       OR pg_catalog.char_length(clean_name) < 1
       OR pg_catalog.char_length(clean_name) > 80
       OR normalized = '' THEN
      RAISE EXCEPTION 'invalid_exercise_name';
    END IF;
    IF exercise_type IS NULL THEN
      IF equipment_type = 'bodyweight' THEN
        exercise_type := 'bodyweight';
      ELSIF equipment_type IS NOT NULL THEN
        exercise_type := 'weighted';
      END IF;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('exercise-name:' || normalized, 0)
    );

    IF EXISTS (
      SELECT 1
      FROM public.exercises
      WHERE public.normalize_exercise_name(name) = normalized
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.exercises (
      name,
      owner_user_id,
      category,
      exercise_type,
      equipment_type,
      warmup_enabled,
      min_weight,
      weight_increment
    )
    VALUES (
      clean_name,
      NULL,
      category,
      exercise_type,
      equipment_type,
      false,
      NULL,
      NULL
    );
    inserted := inserted + 1;
  END LOOP;

  RETURN inserted;
END;
$seed$;

REVOKE ALL ON FUNCTION public.seed_standard_exercises(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_custom_exercise(p_name text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $custom$
DECLARE
  uid uuid := auth.uid();
  clean_name text;
  normalized text;
  existing_id bigint;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '30s', true);

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  clean_name := pg_catalog.btrim(p_name);
  normalized := public.normalize_exercise_name(clean_name);
  IF clean_name IS NULL
     OR pg_catalog.char_length(clean_name) < 1
     OR pg_catalog.char_length(clean_name) > 80
     OR normalized = '' THEN
    RAISE EXCEPTION 'invalid_import: exercise_name';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('exercise-name:' || normalized, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.exercises
    WHERE owner_user_id IS NULL
      AND public.normalize_exercise_name(name) = normalized
  ) THEN
    RAISE EXCEPTION 'use_catalog_exercise';
  END IF;

  SELECT id
  INTO existing_id
  FROM public.exercises
  WHERE owner_user_id = uid
    AND public.normalize_exercise_name(name) = normalized
  ORDER BY id
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.exercises
    WHERE public.normalize_exercise_name(name) = normalized
  ) THEN
    RAISE EXCEPTION 'exercise_name_taken';
  END IF;

  BEGIN
    INSERT INTO public.exercises (
      name,
      owner_user_id,
      category,
      exercise_type,
      equipment_type,
      warmup_enabled,
      min_weight,
      weight_increment
    )
    VALUES (clean_name, uid, NULL, NULL, NULL, false, NULL, NULL)
    RETURNING id INTO existing_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'exercise_name_taken';
  END;

  RETURN existing_id;
END;
$custom$;

REVOKE ALL ON FUNCTION public.create_custom_exercise(text) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
