-- READ ONLY. NOT AN INSTALL STEP.
-- Do not remove SET TRANSACTION READ ONLY.
-- Confirms the routine-edit bodies are still the pre-preserve versions,
-- program_exercises.rest_seconds exists, and routine-write permissions
-- are not granted by this script.
-- Does not call a write RPC. Does not read auth.users rows.
-- Compare the returned fingerprints and counts with the review baseline.
-- A finished-session count above 32 can be later workout history.
-- A count below 32 is a stop.

BEGIN;

SET TRANSACTION READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL datestyle = 'ISO, MDY';
SET LOCAL extra_float_digits = 1;
SET LOCAL bytea_output = 'hex';

SELECT jsonb_build_object(
  'baseline', jsonb_build_object(
  'preflight', 'routine-rest-preserve',
  'read_only', current_setting('transaction_read_only'),
  'server_version', current_setting('server_version'),
  'current_user', CURRENT_USER,
  'is_superuser', (
    SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = CURRENT_USER
  ),
  'time_zone', current_setting('TimeZone'),
  'datestyle', current_setting('DateStyle'),
  'extra_float_digits', current_setting('extra_float_digits'),
  'bytea_output', current_setting('bytea_output'),
  'finished_sessions', (SELECT count(*) FROM public.workout_sessions WHERE finished_at IS NOT NULL),
  'unfinished_sessions', (SELECT count(*) FROM public.workout_sessions WHERE finished_at IS NULL),
  'sets', (SELECT count(*) FROM public.workout_sets),
  'active_programs', (SELECT count(*) FROM public.programs WHERE is_active),
  'inactive_programs', (SELECT count(*) FROM public.programs WHERE NOT is_active),
  'program_days', (SELECT count(*) FROM public.program_days),
  'program_exercises', (SELECT count(*) FROM public.program_exercises),
  'exercises', (SELECT count(*) FROM public.exercises),
  'profiles', (SELECT count(*) FROM public.profiles),
  'cutoff_sessions', (
    SELECT count(*) FROM public.workout_sessions
    WHERE finished_at IS NOT NULL AND finished_at < '2026-10-30 10:54:16+00'
  ),
  'cutoff_sets', (
    SELECT count(*)
    FROM public.workout_sets AS set_row
    JOIN public.workout_sessions AS session_row ON session_row.id = set_row.workout_session_id
    WHERE session_row.finished_at IS NOT NULL
      AND session_row.finished_at < '2026-10-30 10:54:16+00'
  ),
  'rest_null', (SELECT count(*) FROM public.program_exercises WHERE rest_seconds IS NULL),
  'rest_not_null', (SELECT count(*) FROM public.program_exercises WHERE rest_seconds IS NOT NULL)
  ),
  'fingerprints', jsonb_build_object(
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
  'preexisting_program_exercises_fingerprint', (
    SELECT md5(COALESCE(string_agg((to_jsonb(s) - 'rest_seconds')::text, ',' ORDER BY s.id), ''))
    FROM public.program_exercises s
  )
  ),
  'schema', jsonb_build_object(
  'update_owned_program', (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.update_owned_program(jsonb)')),
  'routine_normalize_days', (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.routine_normalize_days(jsonb,boolean)')),
  'routine_write_days', (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.routine_write_days(uuid,bigint,jsonb,boolean)')),
  'save_imported_program', (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.save_imported_program(jsonb)')),
  'enforce_program_activation', (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.enforce_program_activation()')),
  'save_owned_program', (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.save_owned_program(jsonb, boolean)')),
  'activate_owned_program', (SELECT md5(prosrc) FROM pg_catalog.pg_proc WHERE oid = to_regprocedure('public.activate_owned_program(bigint)')),
  'normalize_has_rest', (
    SELECT position('rest_seconds' in prosrc) > 0
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.routine_normalize_days(jsonb,boolean)')
  ),
  'write_has_rest', (
    SELECT position('rest_seconds' in prosrc) > 0
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.routine_write_days(uuid,bigint,jsonb,boolean)')
  ),
  'write_has_marker', (
    SELECT position('routine_rest_preserve' in prosrc) > 0
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.routine_write_days(uuid,bigint,jsonb,boolean)')
  ),
  'update_has_rest', (
    SELECT position('rest_seconds' in prosrc) > 0
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.update_owned_program(jsonb)')
  ),
  'public_function_count', (
    SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::regnamespace
  ),
  'rest_column', (
    SELECT jsonb_build_object(
      'present', true,
      'not_null', att.attnotnull,
      'default', pg_catalog.pg_get_expr(def.adbin, def.adrelid),
      'check', (
        SELECT pg_catalog.pg_get_constraintdef(con.oid)
        FROM pg_catalog.pg_constraint con
        WHERE con.conname = 'program_exercises_rest_seconds_range'
      )
    )
    FROM pg_catalog.pg_attribute att
    LEFT JOIN pg_catalog.pg_attrdef def
      ON def.adrelid = att.attrelid AND def.adnum = att.attnum
    WHERE att.attrelid = 'public.program_exercises'::regclass
      AND att.attname = 'rest_seconds'
      AND NOT att.attisdropped
  ),
  'activation_trigger', (
    SELECT pg_catalog.pg_get_triggerdef(trg.oid)
    FROM pg_catalog.pg_trigger trg
    WHERE trg.tgname = 'programs_activation_rpc'
      AND trg.tgrelid = 'public.programs'::regclass
      AND NOT trg.tgisinternal
  ),
  'name_constraint', (
    SELECT pg_catalog.pg_get_constraintdef(con.oid)
    FROM pg_catalog.pg_constraint con
    WHERE con.conname = 'exercises_name_key'
  ),
  'policies_md5', (
    SELECT md5(COALESCE(string_agg(format(
      '%s:%s:%s:%s:%s',
      c.relname, pol.polname, pol.polcmd,
      COALESCE(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), ''),
      COALESCE(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '')
    ), ',' ORDER BY c.relname, pol.polname), ''))
    FROM pg_catalog.pg_policy pol
    JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
    WHERE c.oid IN (
      'public.programs'::regclass,
      'public.program_days'::regclass,
      'public.program_exercises'::regclass,
      'public.workout_sessions'::regclass,
      'public.workout_sets'::regclass
    )
  ),
  'foreign_keys_md5', (
    SELECT md5(COALESCE(string_agg(format(
      '%s:%s', src.relname, pg_catalog.pg_get_constraintdef(con.oid)
    ), ',' ORDER BY src.relname, con.conname), ''))
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class src ON src.oid = con.conrelid
    WHERE con.contype = 'f'
      AND (
        con.conrelid IN (
          'public.programs'::regclass,
          'public.program_days'::regclass,
          'public.program_exercises'::regclass,
          'public.workout_sessions'::regclass,
          'public.workout_sets'::regclass
        )
        OR con.confrelid IN (
          'public.programs'::regclass,
          'public.program_days'::regclass,
          'public.program_exercises'::regclass
        )
      )
  ),
  'history_delete', jsonb_build_object(
    'sessions', has_table_privilege('authenticated', 'public.workout_sessions', 'DELETE'),
    'sets', has_table_privilege('authenticated', 'public.workout_sets', 'DELETE'),
    'programs', has_table_privilege('authenticated', 'public.programs', 'DELETE'),
    'program_days', has_table_privilege('authenticated', 'public.program_days', 'DELETE'),
    'program_exercises', has_table_privilege('authenticated', 'public.program_exercises', 'DELETE')
  )
  )
) AS preflight;

COMMIT;
