-- NOT APPLIED.
-- Rollback for sql/exercise-ownership.sql. Do not run this file on production.
-- Drops the seed and custom-exercise functions and owner_user_id.
-- Exercise ids and names stay. Dropping owner_user_id removes the record of
-- which user owned a custom row. It does not delete those rows.
-- The policy recreated below is the disposable fixture policy
-- exercises_select_authenticated USING (true).
-- Production policy names and grants differ. A revoke of INSERT, UPDATE, and
-- DELETE is correct for this fixture because this migration added them.
-- Do not run this rollback on production.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP FUNCTION IF EXISTS public.create_custom_exercise(text);
DROP FUNCTION IF EXISTS public.seed_standard_exercises(jsonb);
DROP FUNCTION IF EXISTS public.normalize_exercise_name(text);

DROP POLICY IF EXISTS exercises_select_visible ON public.exercises;
DROP POLICY IF EXISTS exercises_insert_own ON public.exercises;
DROP POLICY IF EXISTS exercises_update_own ON public.exercises;
DROP POLICY IF EXISTS exercises_delete_own ON public.exercises;

CREATE POLICY exercises_select_authenticated ON public.exercises
  FOR SELECT TO authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON TABLE public.exercises FROM authenticated;

ALTER TABLE public.exercises
  DROP COLUMN IF EXISTS owner_user_id;

COMMIT;
