-- NOT APPLIED.
-- Revokes the rollout grants from sql/routine-write-enablement.sql.
-- Does not drop functions, columns, policies, or rows.
-- After this file, anon, authenticated, service_role, and PUBLIC cannot
-- execute the four write RPCs. The table owner can still execute them.
-- Use this to stop new calls without trying to roll back stored data.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

REVOKE ALL ON FUNCTION public.record_tracked_set(
  bigint, bigint, integer, text, numeric, numeric, text, integer, integer, boolean
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_custom_exercise(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_owned_program(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_manual_program(jsonb) FROM PUBLIC, anon, authenticated, service_role;

SELECT 'routine_write_permissions_closed' AS result;

COMMIT;
