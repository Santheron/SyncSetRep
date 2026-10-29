-- Read-only shape check for sql/program-activation.sql.
-- Run it only after that file is applied. It does not call either function.
-- It does not read logged workout history and it does not compare backups.
-- Before the functions exist, post_activation_functions_ok is false.

BEGIN;

SET LOCAL default_transaction_read_only = on;

WITH owned_save AS (
  SELECT proc.prosecdef, proc.proconfig, proc.prosrc
  FROM pg_proc proc
  WHERE proc.oid = to_regprocedure('public.save_owned_program(jsonb, boolean)')
),
owned_activate AS (
  SELECT proc.prosecdef, proc.proconfig, proc.prosrc
  FROM pg_proc proc
  WHERE proc.oid = to_regprocedure('public.activate_owned_program(bigint)')
),
facts AS (
  SELECT
    to_regprocedure('public.save_owned_program(jsonb, boolean)') IS NOT NULL AS save_present,
    to_regprocedure('public.activate_owned_program(bigint)') IS NOT NULL AS activate_present,
    (SELECT prosecdef FROM owned_save) AS save_security_definer,
    (SELECT prosecdef FROM owned_activate) AS activate_security_definer,
    EXISTS (
      SELECT 1
      FROM owned_save
      CROSS JOIN LATERAL unnest(COALESCE(proconfig, ARRAY[]::text[])) AS cfg
      WHERE replace(cfg, ' ', '') IN ('search_path=', 'search_path=""')
    ) AS save_search_path_empty,
    EXISTS (
      SELECT 1
      FROM owned_activate
      CROSS JOIN LATERAL unnest(COALESCE(proconfig, ARRAY[]::text[])) AS cfg
      WHERE replace(cfg, ' ', '') IN ('search_path=', 'search_path=""')
    ) AS activate_search_path_empty,
    COALESCE((SELECT prosrc LIKE '%active_program_exists%' FROM owned_save), false) AS rejects_second_current,
    COALESCE((SELECT prosrc LIKE '%active_program_count%' FROM owned_activate), false) AS checks_one_current,
    CASE
      WHEN to_regprocedure('public.save_owned_program(jsonb, boolean)') IS NULL THEN false
      ELSE has_function_privilege('authenticated', 'public.save_owned_program(jsonb, boolean)', 'EXECUTE')
    END AS save_authenticated_execute,
    CASE
      WHEN to_regprocedure('public.activate_owned_program(bigint)') IS NULL THEN false
      ELSE has_function_privilege('authenticated', 'public.activate_owned_program(bigint)', 'EXECUTE')
    END AS activate_authenticated_execute,
    CASE
      WHEN to_regprocedure('public.save_owned_program(jsonb, boolean)') IS NULL THEN true
      ELSE NOT has_function_privilege('anon', 'public.save_owned_program(jsonb, boolean)', 'EXECUTE')
    END AS save_anon_revoked,
    CASE
      WHEN to_regprocedure('public.activate_owned_program(bigint)') IS NULL THEN true
      ELSE NOT has_function_privilege('anon', 'public.activate_owned_program(bigint)', 'EXECUTE')
    END AS activate_anon_revoked
)
SELECT
  save_present
  AND activate_present
  AND save_security_definer IS FALSE
  AND activate_security_definer IS FALSE
  AND save_search_path_empty
  AND activate_search_path_empty
  AND rejects_second_current
  AND checks_one_current
  AND save_authenticated_execute
  AND activate_authenticated_execute
  AND save_anon_revoked
  AND activate_anon_revoked
  AS post_activation_functions_ok
FROM facts;

COMMIT;
