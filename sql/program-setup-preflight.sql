-- READ ONLY. NOT AN INSTALL STEP.
-- Review this before applying the program-setup migrations.
-- Do not remove default_transaction_read_only.
-- Does not call save_imported_program, save_owned_program,
-- activate_owned_program, copy_starter_program, or handle_new_user.
-- Does not read rows from auth.users.
-- Compare fingerprints and counts with the read-only result taken immediately
-- before a later apply. The 2026-10-29 11:44 backup is the older baseline.
-- A finished-session count above 30 can be later workout history.
-- A count below 30 is a stop. This script does not decide ready_to_apply
-- by itself: read stop_if.

BEGIN;

SET LOCAL default_transaction_read_only = on;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL datestyle = 'ISO, MDY';
SET LOCAL extra_float_digits = 1;
SET LOCAL bytea_output = 'hex';

SELECT jsonb_build_object(
  'preflight', 'program-setup',
  'read_only', current_setting('transaction_read_only'),
  'server_version', current_setting('server_version'),
  'current_user', CURRENT_USER,
  'programs_owner', (
    SELECT pg_catalog.pg_get_userbyid(relowner)
    FROM pg_catalog.pg_class
    WHERE oid = 'public.programs'::regclass
  ),
  'owner_matches_current_user', (
    SELECT pg_catalog.pg_get_userbyid(relowner)::text = CURRENT_USER::text
    FROM pg_catalog.pg_class
    WHERE oid = 'public.programs'::regclass
  ),
  'programs_force_rls', (
    SELECT relforcerowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.programs'::regclass
  ),
  'authenticated_can_create_in_public', has_schema_privilege('authenticated', 'public', 'CREATE'),
  'save_imported_present', to_regprocedure('public.save_imported_program(jsonb)') IS NOT NULL,
  'save_imported_security_definer', (
    SELECT prosecdef
    FROM pg_proc
    WHERE oid = to_regprocedure('public.save_imported_program(jsonb)')
  ),
  'save_owned_present', to_regprocedure('public.save_owned_program(jsonb, boolean)') IS NOT NULL,
  'activate_owned_present', to_regprocedure('public.activate_owned_program(bigint)') IS NOT NULL,
  'enforce_activation_present', to_regprocedure('public.enforce_program_activation()') IS NOT NULL,
  'handle_new_user_calls_starter', COALESCE((
    SELECT position('copy_starter_program' IN prosrc) > 0
    FROM pg_proc
    WHERE oid = to_regprocedure('public.handle_new_user()')
  ), false),
  'starter_wrapper_present', to_regprocedure('public.copy_starter_program_for_current_user()') IS NOT NULL,
  'starter_wrapper_authenticated_execute', CASE
    WHEN to_regprocedure('public.copy_starter_program_for_current_user()') IS NULL THEN false
    ELSE has_function_privilege(
      'authenticated',
      'public.copy_starter_program_for_current_user()',
      'EXECUTE'
    )
  END,
  'authenticated_programs_insert', has_table_privilege('authenticated', 'public.programs', 'INSERT'),
  'authenticated_programs_update', has_table_privilege('authenticated', 'public.programs', 'UPDATE'),
  'authenticated_programs_delete', has_table_privilege('authenticated', 'public.programs', 'DELETE'),
  'authenticated_is_active_update', has_column_privilege('authenticated', 'public.programs', 'is_active', 'UPDATE'),
  'authenticated_name_update', has_column_privilege('authenticated', 'public.programs', 'name', 'UPDATE'),
  'programs_update_own', EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'programs'
      AND policyname = 'programs_update_own'
  ),
  'one_active_index', EXISTS (
    SELECT 1
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'programs_one_active_per_user_uidx'
  ),
  'service_role_exists', to_regrole('service_role') IS NOT NULL,
  'finished_sessions', (SELECT count(*)::integer FROM public.workout_sessions WHERE finished_at IS NOT NULL),
  'workout_sets', (SELECT count(*)::integer FROM public.workout_sets),
  'active_programs', (SELECT count(*)::integer FROM public.programs WHERE is_active),
  'inactive_programs', (SELECT count(*)::integer FROM public.programs WHERE NOT is_active),
  'program_days', (SELECT count(*)::integer FROM public.program_days),
  'program_exercises', (SELECT count(*)::integer FROM public.program_exercises),
  'exercises', (SELECT count(*)::integer FROM public.exercises),
  'sessions_fingerprint', (
    SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), ''))
    FROM public.workout_sessions s
  ),
  'sets_fingerprint', (
    SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), ''))
    FROM public.workout_sets s
  ),
  'programs_fingerprint', (
    SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), ''))
    FROM public.programs s
  ),
  'program_days_fingerprint', (
    SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), ''))
    FROM public.program_days s
  ),
  'program_exercises_fingerprint', (
    SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), ''))
    FROM public.program_exercises s
  ),
  'stop_if', (
    SELECT COALESCE(jsonb_agg(reason ORDER BY reason), '[]'::jsonb)
    FROM (
      SELECT 'programs_owner_is_not_current_user'::text AS reason
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class
        WHERE oid = 'public.programs'::regclass
          AND pg_catalog.pg_get_userbyid(relowner)::text = CURRENT_USER::text
      )
      UNION ALL
      SELECT 'save_imported_program_missing'
      WHERE to_regprocedure('public.save_imported_program(jsonb)') IS NULL
      UNION ALL
      SELECT 'save_imported_program_is_security_definer'
      WHERE COALESCE((
        SELECT prosecdef
        FROM pg_proc
        WHERE oid = to_regprocedure('public.save_imported_program(jsonb)')
      ), false)
      UNION ALL
      SELECT 'one_active_index_missing'
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'programs_one_active_per_user_uidx'
      )
      UNION ALL
      SELECT 'activation_function_already_present'
      WHERE to_regprocedure('public.save_owned_program(jsonb, boolean)') IS NOT NULL
        OR to_regprocedure('public.activate_owned_program(bigint)') IS NOT NULL
        OR to_regprocedure('public.enforce_program_activation()') IS NOT NULL
      UNION ALL
      SELECT 'finished_sessions_below_baseline'
      WHERE (
        SELECT count(*)
        FROM public.workout_sessions
        WHERE finished_at IS NOT NULL
      ) < 30
      UNION ALL
      SELECT 'starter_still_callable'
      WHERE COALESCE((
        SELECT has_function_privilege('authenticated', oid, 'EXECUTE')
          AND position('starter_program_disabled' IN prosrc) = 0
        FROM pg_proc
        WHERE oid = to_regprocedure('public.copy_starter_program_for_current_user()')
      ), false)
    ) reasons
  )
) AS program_setup_preflight;

COMMIT;
