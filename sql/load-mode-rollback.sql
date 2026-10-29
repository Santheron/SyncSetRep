-- NOT APPLIED.
-- Rollback for sql/load-mode.sql. Do not run this file on production.
-- Drops record_tracked_set, the tracking checks, and the new columns.
-- Does not change workout_sets.weight.
-- A weight written by record_tracked_set on an unfinished session stays.
-- Finished sets are not rewritten by the forward migration or this rollback.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

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
