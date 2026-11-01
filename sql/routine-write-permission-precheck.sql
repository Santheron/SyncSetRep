-- NOT APPLIED.
-- Read-only permission check. Do not run this on production until the schema
-- files below have been applied there under a separate approval.
-- Run after sql/load-mode.sql, sql/program-day-archive.sql,
-- sql/exercise-ownership.sql, and sql/routine-edit.sql.
-- Run before sql/routine-write-enablement.sql.
-- This file grants nothing and revokes nothing.
-- It raises routine_write_permission_open when anon, authenticated,
-- service_role, or PUBLIC can execute a new write RPC or one of its helpers.
-- It raises routine_write_overload when a name has more than one signature.
-- It raises routine_write_signature_missing when an expected signature is absent.
-- PostgreSQL grants EXECUTE to PUBLIC by default. Default privileges can
-- also grant anon, authenticated, or service_role. A direct grant is
-- separate from PUBLIC, and each signature has its own ACL. CREATE OR
-- REPLACE does not clear an old grant, so this check reads the live ACL.

BEGIN;

SET LOCAL default_transaction_read_only = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $precheck$
DECLARE
  expected_names text[] := ARRAY[
    'record_tracked_set',
    'create_custom_exercise',
    'update_owned_program',
    'save_manual_program',
    'normalize_exercise_name',
    'seed_standard_exercises',
    'resolve_routine_exercise',
    'routine_write_days',
    'routine_normalize_days',
    'routine_require_int'
  ];
  expected_signatures text[] := ARRAY[
    'public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)',
    'public.create_custom_exercise(text)',
    'public.update_owned_program(jsonb)',
    'public.save_manual_program(jsonb)',
    'public.normalize_exercise_name(text)',
    'public.seed_standard_exercises(jsonb)',
    'public.resolve_routine_exercise(uuid,jsonb)',
    'public.routine_write_days(uuid,bigint,jsonb,boolean)',
    'public.routine_normalize_days(jsonb,boolean)',
    'public.routine_require_int(text,integer,integer,text)'
  ];
  roles text[] := ARRAY['anon', 'authenticated', 'service_role', 'public'];
  signature text;
  role_name text;
  function_name text;
BEGIN
  FOREACH signature IN ARRAY expected_signatures LOOP
    IF to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION 'routine_write_signature_missing: %', signature;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY expected_names LOOP
    IF (
      SELECT count(*)
      FROM pg_catalog.pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname = function_name
    ) > 1 THEN
      RAISE EXCEPTION 'routine_write_overload: %', function_name;
    END IF;
  END LOOP;

  FOREACH signature IN ARRAY expected_signatures LOOP
    FOREACH role_name IN ARRAY roles LOOP
      IF has_function_privilege(role_name, signature, 'EXECUTE') THEN
        RAISE EXCEPTION 'routine_write_permission_open: % can execute %', role_name, signature;
      END IF;
    END LOOP;
  END LOOP;
END
$precheck$;

SELECT 'routine_write_permissions_closed' AS result;

COMMIT;
