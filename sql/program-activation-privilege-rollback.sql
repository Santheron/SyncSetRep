-- NOT AN INSTALL STEP.
-- Drops the proposed activation trigger and its function.
-- Restores table-level UPDATE on public.programs for authenticated.
-- That grant covers every column again.
-- Program rows, days, exercises, and logged workout history stay as they are.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TRIGGER IF EXISTS programs_activation_rpc ON public.programs;
DROP FUNCTION IF EXISTS public.enforce_program_activation();

GRANT UPDATE ON TABLE public.programs TO authenticated;

COMMIT;
