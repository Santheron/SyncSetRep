-- NOT APPLIED.
-- Read-only permission check for a partial schema install.
-- Run this after each schema file, before starting the next one:
--   sql/load-mode.sql
--   sql/program-day-archive.sql
--   sql/exercise-ownership.sql
--   sql/routine-edit.sql
-- A missing write RPC is inaccessible and is reported as absent.
-- An installed write RPC must have no EXECUTE for anon, authenticated,
-- service_role, or PUBLIC. This file then reports that signature as closed.
-- An extra or unexpected signature raises routine_write_overload.
-- An installed EXECUTE grant raises routine_write_permission_open.
-- This file grants nothing and changes nothing.
-- It does not prove the install is complete. After all four schema files,
-- sql/routine-write-permission-precheck.sql must also return
-- routine_write_permissions_closed. A missing function makes that file raise
-- routine_write_signature_missing instead.

BEGIN;

SET LOCAL default_transaction_read_only = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $step$
DECLARE
  write_names text[] := ARRAY[
    'record_tracked_set',
    'create_custom_exercise',
    'update_owned_program',
    'save_manual_program'
  ];
  expected_signatures text[] := ARRAY[
    'public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)',
    'public.create_custom_exercise(text)',
    'public.update_owned_program(jsonb)',
    'public.save_manual_program(jsonb)'
  ];
  roles text[] := ARRAY['anon', 'authenticated', 'service_role', 'public'];
  function_index integer;
  function_name text;
  signature text;
  role_name text;
  installed_count bigint;
BEGIN
  FOR function_index IN 1 .. array_length(write_names, 1) LOOP
    function_name := write_names[function_index];
    signature := expected_signatures[function_index];

    SELECT count(*)
    INTO installed_count
    FROM pg_catalog.pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname = function_name;

    IF installed_count > 1
      OR (installed_count = 1 AND to_regprocedure(signature) IS NULL) THEN
      RAISE EXCEPTION 'routine_write_overload: %', function_name;
    END IF;

    IF installed_count = 1 THEN
      FOREACH role_name IN ARRAY roles LOOP
        IF has_function_privilege(role_name, signature, 'EXECUTE') THEN
          RAISE EXCEPTION 'routine_write_permission_open: % can execute %', role_name, signature;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$step$;

SELECT 'routine_write_step_closed'
  || ':record_tracked_set=' || CASE
    WHEN to_regprocedure('public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)') IS NULL
      THEN 'absent' ELSE 'closed' END
  || ':create_custom_exercise=' || CASE
    WHEN to_regprocedure('public.create_custom_exercise(text)') IS NULL
      THEN 'absent' ELSE 'closed' END
  || ':update_owned_program=' || CASE
    WHEN to_regprocedure('public.update_owned_program(jsonb)') IS NULL
      THEN 'absent' ELSE 'closed' END
  || ':save_manual_program=' || CASE
    WHEN to_regprocedure('public.save_manual_program(jsonb)') IS NULL
      THEN 'absent' ELSE 'closed' END
  AS result;

COMMIT;
