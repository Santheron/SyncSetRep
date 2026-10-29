-- NOT AN INSTALL STEP.
-- Drops the proposed activation trigger and its function.
-- Program rows, days, exercises, and logged workout history stay as they are.
-- Direct updates of is_active become possible again for roles that already
-- hold UPDATE on public.programs.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TRIGGER IF EXISTS programs_activation_rpc ON public.programs;
DROP FUNCTION IF EXISTS public.enforce_program_activation();

COMMIT;
