-- NOT APPLIED. This is not an installation step.
-- Drops the save function only. Saved programs, days, exercises, and history stay.

BEGIN;

DROP FUNCTION IF EXISTS public.save_imported_program(jsonb);

COMMIT;
