-- NOT APPLIED.
-- Do not run this file on production until a separate approval.
-- Drops program_exercises.equipment_targets, its check, its owner trigger,
-- equipment_targets_json_valid, enforce_equipment_target_owners,
-- and save_equipment_targets(jsonb) only when every stored target is null.
-- A stored target raises equipment_targets_rollback_blocked and changes nothing.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.program_exercises
    WHERE equipment_targets IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'equipment_targets_rollback_blocked';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS program_exercises_equipment_target_owners ON public.program_exercises;

DROP FUNCTION IF EXISTS public.enforce_equipment_target_owners();

DROP FUNCTION IF EXISTS public.save_equipment_targets(jsonb);

ALTER TABLE public.program_exercises
  DROP CONSTRAINT IF EXISTS program_exercises_equipment_targets_check;

ALTER TABLE public.program_exercises
  DROP COLUMN IF EXISTS equipment_targets;

DROP FUNCTION IF EXISTS public.equipment_targets_json_valid(jsonb);

COMMIT;

SELECT 'equipment_targets_rolled_back' AS result;
