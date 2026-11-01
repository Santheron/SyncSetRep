-- READ ONLY. NOT AN INSTALL STEP.
-- Review this only after the four program-setup files have been applied.
-- Do not remove default_transaction_read_only.
-- Does not call save_imported_program, save_owned_program,
-- activate_owned_program, copy_starter_program, or handle_new_user.
-- Does not read rows from auth.users.
-- Does not demonstrate a direct table write.
-- post_program_setup_ok is the schema boundary. Compare the fingerprints
-- with the preflight result taken immediately before the apply.
-- service_role_save_execute is reported and is not part of post_program_setup_ok.
-- A service role without a user JWT still fails closed inside the functions
-- because auth.uid() is null.

BEGIN;

SET LOCAL default_transaction_read_only = on;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL datestyle = 'ISO, MDY';
SET LOCAL extra_float_digits = 1;
SET LOCAL bytea_output = 'hex';

WITH owned_save AS (
  SELECT proc.prosecdef, proc.proconfig, proc.prosrc, pg_catalog.pg_get_userbyid(proc.proowner)::text AS owner
  FROM pg_proc proc
  WHERE proc.oid = to_regprocedure('public.save_owned_program(jsonb, boolean)')
),
owned_activate AS (
  SELECT proc.prosecdef, proc.proconfig, proc.prosrc, pg_catalog.pg_get_userbyid(proc.proowner)::text AS owner
  FROM pg_proc proc
  WHERE proc.oid = to_regprocedure('public.activate_owned_program(bigint)')
),
facts AS (
  SELECT
    to_regprocedure('public.save_owned_program(jsonb, boolean)') IS NOT NULL AS save_present,
    to_regprocedure('public.activate_owned_program(bigint)') IS NOT NULL AS activate_present,
    COALESCE((SELECT prosecdef FROM owned_save), false) AS save_security_definer,
    COALESCE((SELECT prosecdef FROM owned_activate), false) AS activate_security_definer,
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
    COALESCE((SELECT prosrc NOT LIKE '%syncsetrep.program_activation%' FROM owned_save), false) AS save_has_no_activation_guc,
    COALESCE((SELECT prosrc NOT LIKE '%syncsetrep.program_activation%' FROM owned_activate), false) AS activate_has_no_activation_guc,
    COALESCE((SELECT prosrc LIKE '%auth.uid()%' FROM owned_save), false) AS save_checks_auth_uid,
    COALESCE((SELECT prosrc LIKE '%auth.uid()%' FROM owned_activate), false) AS activate_checks_auth_uid,
    COALESCE((SELECT owner FROM owned_save), '') <> 'authenticated' AS save_owner_is_not_authenticated,
    COALESCE((SELECT owner FROM owned_activate), '') <> 'authenticated' AS activate_owner_is_not_authenticated,
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
    END AS activate_anon_revoked,
    CASE
      WHEN to_regprocedure('public.save_owned_program(jsonb, boolean)') IS NULL THEN true
      ELSE NOT has_function_privilege('public', 'public.save_owned_program(jsonb, boolean)', 'EXECUTE')
    END AS save_public_revoked,
    to_regprocedure('public.handle_new_user()') IS NOT NULL
      AND NOT COALESCE((
        SELECT position('copy_starter_program' IN prosrc) > 0
        FROM pg_proc
        WHERE oid = to_regprocedure('public.handle_new_user()')
      ), true) AS signup_creates_no_program,
    COALESCE((
      SELECT position('starter_program_disabled' IN prosrc) > 0
        AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')
      FROM pg_proc
      WHERE oid = to_regprocedure('public.copy_starter_program(uuid, text)')
    ), false) AS starter_disabled,
    COALESCE((
      SELECT position('starter_program_disabled' IN prosrc) > 0
        AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')
      FROM pg_proc
      WHERE oid = to_regprocedure('public.copy_starter_program_for_current_user()')
    ), false) AS starter_wrapper_disabled,
    NOT has_column_privilege('authenticated', 'public.programs', 'is_active', 'UPDATE') AS is_active_update_revoked,
    has_column_privilege('authenticated', 'public.programs', 'name', 'UPDATE') AS name_update_kept,
    NOT has_column_privilege('authenticated', 'public.programs', 'user_id', 'UPDATE') AS user_id_update_revoked,
    has_table_privilege('authenticated', 'public.programs', 'INSERT') AS insert_kept,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger
      WHERE tgname = 'programs_activation_rpc'
        AND tgrelid = 'public.programs'::regclass
        AND NOT tgisinternal
    ) AS activation_trigger_present,
    to_regprocedure('public.save_imported_program(jsonb)') IS NOT NULL
      AND NOT COALESCE((
        SELECT prosecdef
        FROM pg_proc
        WHERE oid = to_regprocedure('public.save_imported_program(jsonb)')
      ), true) AS save_imported_remains_invoker,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'programs_one_active_per_user_uidx'
    ) AS one_active_index
)
SELECT
  save_present
  AND activate_present
  AND save_security_definer
  AND activate_security_definer
  AND save_search_path_empty
  AND activate_search_path_empty
  AND save_has_no_activation_guc
  AND activate_has_no_activation_guc
  AND save_checks_auth_uid
  AND activate_checks_auth_uid
  AND save_owner_is_not_authenticated
  AND activate_owner_is_not_authenticated
  AND save_authenticated_execute
  AND activate_authenticated_execute
  AND save_anon_revoked
  AND activate_anon_revoked
  AND save_public_revoked
  AND signup_creates_no_program
  AND starter_disabled
  AND starter_wrapper_disabled
  AND is_active_update_revoked
  AND name_update_kept
  AND user_id_update_revoked
  AND insert_kept
  AND activation_trigger_present
  AND save_imported_remains_invoker
  AND one_active_index
  AS post_program_setup_ok,
  CASE
    WHEN to_regrole('service_role') IS NULL
      OR to_regprocedure('public.save_owned_program(jsonb, boolean)') IS NULL THEN NULL
    ELSE has_function_privilege('service_role', 'public.save_owned_program(jsonb, boolean)', 'EXECUTE')
  END AS service_role_save_execute,
  (SELECT count(*)::integer FROM public.workout_sessions WHERE finished_at IS NOT NULL) AS finished_sessions,
  (SELECT count(*)::integer FROM public.workout_sets) AS workout_sets,
  (SELECT count(*)::integer FROM public.programs WHERE is_active) AS active_programs,
  (SELECT count(*)::integer FROM public.programs WHERE NOT is_active) AS inactive_programs,
  (SELECT count(*)::integer FROM public.program_days) AS program_days,
  (SELECT count(*)::integer FROM public.program_exercises) AS program_exercises,
  (SELECT count(*)::integer FROM public.exercises) AS exercises,
  (
    SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), ''))
    FROM public.workout_sessions s
  ) AS sessions_fingerprint,
  (
    SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), ''))
    FROM public.workout_sets s
  ) AS sets_fingerprint,
  (
    SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), ''))
    FROM public.programs s
  ) AS programs_fingerprint,
  (
    SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), ''))
    FROM public.program_days s
  ) AS program_days_fingerprint,
  (
    SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), ''))
    FROM public.program_exercises s
  ) AS program_exercises_fingerprint
FROM facts;

COMMIT;
