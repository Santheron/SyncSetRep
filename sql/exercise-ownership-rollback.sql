-- NOT APPLIED.
-- Rollback for sql/exercise-ownership.sql. Do not run this file on production.
-- Drops the seed and custom-exercise functions.
-- Drops owner_user_id only when every value is NULL.
-- If any custom exercise still records an owner, this file raises
-- exercise_owner_rollback_blocked and changes nothing. The whole file is
-- one transaction, so the policy and foreign key stay as they were.
-- Exercise ids and names stay either way. This file does not delete rows.
-- When the column is empty, it restores exercises_select_authenticated
-- FOR SELECT TO authenticated USING (true). That is the production policy
-- from the 2026-10-29 backup.
-- Does not revoke table privileges. Production already has GRANT ALL on
-- public.exercises for authenticated, and the forward migration added none.
-- Restores program_exercises_exercise_id_fkey ON DELETE CASCADE.
-- Leaves exercises_name_key in place.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $owner_guard$
DECLARE
  owned_rows bigint := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.exercises'::regclass
      AND attname = 'owner_user_id'
      AND NOT attisdropped
  ) THEN
    SELECT count(*)
    INTO owned_rows
    FROM public.exercises
    WHERE owner_user_id IS NOT NULL;

    IF owned_rows > 0 THEN
      RAISE EXCEPTION
        'exercise_owner_rollback_blocked: % custom exercise(s) have owner_user_id. Rollback would forget which account owns them. owner_user_id was not dropped.',
        owned_rows;
    END IF;
  END IF;
END
$owner_guard$;

DROP FUNCTION IF EXISTS public.create_custom_exercise(text);
DROP FUNCTION IF EXISTS public.seed_standard_exercises(jsonb);
DROP FUNCTION IF EXISTS public.normalize_exercise_name(text);

DROP POLICY IF EXISTS exercises_select_visible ON public.exercises;
DROP POLICY IF EXISTS exercises_insert_own ON public.exercises;
DROP POLICY IF EXISTS exercises_update_own ON public.exercises;
DROP POLICY IF EXISTS exercises_delete_own ON public.exercises;

DO $policy$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy pol
    WHERE pol.polrelid = 'public.exercises'::regclass
      AND pol.polname = 'exercises_select_authenticated'
  ) THEN
    RAISE EXCEPTION 'exercise_policy_restore_blocked';
  END IF;
END
$policy$;

CREATE POLICY exercises_select_authenticated ON public.exercises
  FOR SELECT TO authenticated
  USING (true);

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

  IF delete_action IS DISTINCT FROM 'a' THEN
    RAISE EXCEPTION 'exercise_fk_restore_schema';
  END IF;
END
$fk$;

ALTER TABLE public.program_exercises
  DROP CONSTRAINT program_exercises_exercise_id_fkey;

ALTER TABLE public.program_exercises
  ADD CONSTRAINT program_exercises_exercise_id_fkey
  FOREIGN KEY (exercise_id) REFERENCES public.exercises (id) ON DELETE CASCADE;

ALTER TABLE public.exercises
  DROP COLUMN IF EXISTS owner_user_id;

COMMIT;
