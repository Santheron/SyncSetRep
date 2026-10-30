-- NOT APPLIED.
-- Rollback for sql/load-mode.sql. Do not run this file on production.
-- Drops record_tracked_set, the tracking checks, and the new columns only
-- when every load_mode, assistance, and weight_unit value is NULL.
-- A non-null value on a workout set or routine prescription is meaningful
-- tracking data. This file then raises load_mode_rollback_blocked and
-- drops nothing. The whole file is one transaction.
-- Does not change workout_sets.weight.
-- NULL load_mode rows keep their recorded weight, including zero and
-- negative numbers. Finished historical weights are not rewritten.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $load_guard$
DECLARE
  tracked_sets bigint := 0;
  tracked_prescriptions bigint := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.workout_sets'::regclass
      AND attname = 'load_mode'
      AND NOT attisdropped
  ) THEN
    SELECT count(*)
    INTO tracked_sets
    FROM public.workout_sets
    WHERE load_mode IS NOT NULL
       OR assistance IS NOT NULL
       OR weight_unit IS NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.program_exercises'::regclass
      AND attname = 'load_mode'
      AND NOT attisdropped
  ) THEN
    SELECT count(*)
    INTO tracked_prescriptions
    FROM public.program_exercises
    WHERE load_mode IS NOT NULL;
  END IF;

  IF tracked_sets > 0 OR tracked_prescriptions > 0 THEN
    RAISE EXCEPTION
      'load_mode_rollback_blocked: % workout set(s) and % routine prescription(s) store load_mode, assistance, or weight_unit. Rollback would drop that tracking data. The tracking columns were not dropped.',
      tracked_sets,
      tracked_prescriptions;
  END IF;
END
$load_guard$;

DROP FUNCTION IF EXISTS public.record_tracked_set(
  bigint, bigint, integer, text, numeric, numeric, text, integer, integer, boolean
);

ALTER TABLE public.workout_sets
  DROP CONSTRAINT IF EXISTS workout_sets_tracked_load_check;

ALTER TABLE public.program_exercises
  DROP CONSTRAINT IF EXISTS program_exercises_load_mode_check;

ALTER TABLE public.workout_sets
  DROP COLUMN IF EXISTS load_mode,
  DROP COLUMN IF EXISTS assistance,
  DROP COLUMN IF EXISTS weight_unit;

ALTER TABLE public.program_exercises
  DROP COLUMN IF EXISTS load_mode;

COMMIT;
