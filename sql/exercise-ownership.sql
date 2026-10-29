-- NOT APPLIED.
-- Do not run this file on production.
-- Adds exercises.owner_user_id. NULL is the shared catalog.
-- A non-null value is private to that auth.uid().
-- Existing rows stay NULL. This file does not UPDATE exercises.
-- It does not reuse or change an exercise id.
-- Shared catalog rows stay select-only for authenticated.
-- Authenticated can insert, update, and delete only rows they own.
-- seed_standard_exercises inserts missing shared names and is not granted
-- to authenticated. The second call inserts nothing.
-- A planned name that already exists, including as a custom row, is skipped
-- and is not converted into a shared row.
-- create_custom_exercise inserts owner = auth.uid() and returns the same id
-- for the same owner and normalized name.
-- If that normalized name is already a shared catalog row, it raises
-- use_catalog_exercise instead of creating another row.
-- The phone must not call these functions while
-- CUSTOM_EXERCISE_WRITES_ENABLED is false.
-- Rollback: sql/exercise-ownership-rollback.sql.
-- That rollback recreates the disposable fixture policy
-- exercises_select_authenticated. Production policy names differ.
-- Do not run the rollback on production.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.exercises
  ADD COLUMN owner_user_id uuid REFERENCES auth.users (id);

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

REVOKE ALL ON FUNCTION public.normalize_exercise_name(text) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS exercises_select_authenticated ON public.exercises;

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
CREATE POLICY exercises_delete_own ON public.exercises
  FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());

GRANT INSERT, UPDATE, DELETE ON TABLE public.exercises TO authenticated;

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
    IF pg_catalog.jsonb_typeof(item) = 'string' THEN
      raw_name := item #>> '{}';
    ELSIF pg_catalog.jsonb_typeof(item) = 'object' THEN
      raw_name := item->>'name';
    ELSE
      RAISE EXCEPTION 'invalid_exercise_name';
    END IF;

    clean_name := pg_catalog.btrim(raw_name);
    normalized := public.normalize_exercise_name(clean_name);
    IF clean_name IS NULL
       OR pg_catalog.char_length(clean_name) < 1
       OR pg_catalog.char_length(clean_name) > 80
       OR normalized = '' THEN
      RAISE EXCEPTION 'invalid_exercise_name';
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

    INSERT INTO public.exercises (name, owner_user_id)
    VALUES (clean_name, NULL);
    inserted := inserted + 1;
  END LOOP;

  RETURN inserted;
END;
$seed$;

REVOKE ALL ON FUNCTION public.seed_standard_exercises(jsonb) FROM PUBLIC, anon, authenticated;

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

  INSERT INTO public.exercises (name, owner_user_id)
  VALUES (clean_name, uid)
  RETURNING id INTO existing_id;

  RETURN existing_id;
END;
$custom$;

REVOKE ALL ON FUNCTION public.create_custom_exercise(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_custom_exercise(text) TO authenticated;

COMMIT;
