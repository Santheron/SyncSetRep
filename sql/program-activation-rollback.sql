-- NOT AN INSTALL STEP.
-- Drops the two proposed functions only.
-- Programs, days, exercises, and logged workout history stay as they are.
-- A current-program change that already committed stays in place.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP FUNCTION IF EXISTS public.activate_owned_program(bigint);
DROP FUNCTION IF EXISTS public.save_owned_program(jsonb, boolean);

COMMIT;
