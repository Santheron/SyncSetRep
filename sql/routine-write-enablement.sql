-- NOT APPLIED.
-- Do not run this file on production until a separate rollout approval.
-- Run sql/routine-write-permission-precheck.sql first and stop if it raises.
-- Schema install order, already revoked and not granted by those files:
--   sql/load-mode.sql
--   sql/program-day-archive.sql
--   sql/exercise-ownership.sql
--   sql/routine-edit.sql
-- This file only grants EXECUTE to authenticated on the four write RPCs:
--   record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)
--   create_custom_exercise(text)
--   update_owned_program(jsonb)
--   save_manual_program(jsonb)
-- It first revokes PUBLIC, anon, authenticated, and service_role on those
-- four signatures, then grants authenticated only. A direct grant on the
-- same signature is replaced. Another signature is rejected before any
-- revoke. Helper functions stay revoked.
-- It does not change tables, policies, history, or phone flags.
-- It does not touch program activation, starter programs, or Edge Functions.
-- Re-running a schema file fails on ADD COLUMN and rolls back, so that
-- failure does not remove this grant. Do not skip the column changes and
-- run a schema file again: its revoke would remove this grant. Run this
-- file again only if that rollout is still approved.
-- Rollback: sql/routine-write-enablement-rollback.sql revokes EXECUTE only.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $signatures$
DECLARE
  write_signatures text[] := ARRAY[
    'public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)',
    'public.create_custom_exercise(text)',
    'public.update_owned_program(jsonb)',
    'public.save_manual_program(jsonb)'
  ];
  write_names text[] := ARRAY[
    'record_tracked_set',
    'create_custom_exercise',
    'update_owned_program',
    'save_manual_program'
  ];
  signature text;
  function_name text;
BEGIN
  FOREACH signature IN ARRAY write_signatures LOOP
    IF to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION 'routine_write_signature_missing: %', signature;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY write_names LOOP
    IF (
      SELECT count(*)
      FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = function_name
    ) IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'routine_write_overload: %', function_name;
    END IF;
  END LOOP;
END
$signatures$;

REVOKE ALL ON FUNCTION public.record_tracked_set(
  bigint, bigint, integer, text, numeric, numeric, text, integer, integer, boolean
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_custom_exercise(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_owned_program(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_manual_program(jsonb) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.record_tracked_set(
  bigint, bigint, integer, text, numeric, numeric, text, integer, integer, boolean
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_custom_exercise(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_owned_program(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_manual_program(jsonb) TO authenticated;

SELECT 'routine_write_permissions_enabled' AS result;

COMMIT;
