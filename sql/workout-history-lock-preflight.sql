-- READ ONLY. NOT AN INSTALL STEP.
-- Do not remove SET TRANSACTION READ ONLY.
-- Confirms historical fingerprints, routine-write privileges, delete
-- grants, foreign-key delete actions, and the current session policies
-- before sql/workout-history-lock.sql is considered.
-- Does not call a write RPC. Does not read auth.users rows.
-- A finished-session count below 32 is a stop.

BEGIN;

SET TRANSACTION READ ONLY;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL datestyle = 'ISO, MDY';
SET LOCAL extra_float_digits = 1;
SET LOCAL bytea_output = 'hex';

SELECT jsonb_build_object(
  'baseline', jsonb_build_object(
    'preflight', 'workout-history-lock',
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
    'public_function_count', (
      SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::regnamespace
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
    'activation_trigger', (
      SELECT pg_catalog.pg_get_triggerdef(trg.oid)
      FROM pg_catalog.pg_trigger trg
      WHERE trg.tgname = 'programs_activation_rpc'
        AND trg.tgrelid = 'public.programs'::regclass
        AND NOT trg.tgisinternal
    ),
    'workout_triggers', (
      SELECT COALESCE(jsonb_agg(trg.tgname ORDER BY trg.tgname), '[]'::jsonb)
      FROM pg_catalog.pg_trigger trg
      WHERE trg.tgrelid IN (
        'public.workout_sessions'::regclass,
        'public.workout_sets'::regclass
      )
        AND NOT trg.tgisinternal
    ),
    'rls', (
      SELECT jsonb_object_agg(
        rel.relname,
        jsonb_build_object(
          'enabled', rel.relrowsecurity,
          'forced', rel.relforcerowsecurity
        )
      )
      FROM pg_catalog.pg_class rel
      WHERE rel.oid IN (
        'public.workout_sessions'::regclass,
        'public.workout_sets'::regclass,
        'public.programs'::regclass,
        'public.program_days'::regclass,
        'public.program_exercises'::regclass
      )
    ),
    'roles', (
      SELECT jsonb_object_agg(
        rolname,
        jsonb_build_object('bypassrls', rolbypassrls, 'superuser', rolsuper)
      )
      FROM pg_catalog.pg_roles
      WHERE rolname IN ('authenticated', 'anon', 'service_role')
    ),
    'history_delete', jsonb_build_object(
      'sessions', has_table_privilege('authenticated', 'public.workout_sessions', 'DELETE'),
      'sets', has_table_privilege('authenticated', 'public.workout_sets', 'DELETE'),
      'programs', has_table_privilege('authenticated', 'public.programs', 'DELETE'),
      'program_days', has_table_privilege('authenticated', 'public.program_days', 'DELETE'),
      'program_exercises', has_table_privilege('authenticated', 'public.program_exercises', 'DELETE')
    ),
    'history_update', jsonb_build_object(
      'sessions', has_table_privilege('authenticated', 'public.workout_sessions', 'UPDATE'),
      'sets', has_table_privilege('authenticated', 'public.workout_sets', 'UPDATE')
    ),
    'history_truncate', jsonb_build_object(
      'sessions_authenticated', has_table_privilege('authenticated', 'public.workout_sessions', 'TRUNCATE'),
      'sets_authenticated', has_table_privilege('authenticated', 'public.workout_sets', 'TRUNCATE'),
      'sessions_anon', has_table_privilege('anon', 'public.workout_sessions', 'TRUNCATE'),
      'sets_anon', has_table_privilege('anon', 'public.workout_sets', 'TRUNCATE')
    ),
    'anon_delete', jsonb_build_object(
      'sessions', has_table_privilege('anon', 'public.workout_sessions', 'DELETE'),
      'sets', has_table_privilege('anon', 'public.workout_sets', 'DELETE')
    ),
    'function_privileges', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'signature', signature,
        'md5', (
          SELECT md5(prosrc)
          FROM pg_catalog.pg_proc
          WHERE oid = to_regprocedure(signature)
        ),
        'authenticated', has_function_privilege('authenticated', signature, 'EXECUTE'),
        'anon', has_function_privilege('anon', signature, 'EXECUTE'),
        'public', has_function_privilege('public', signature, 'EXECUTE'),
        'service_role', has_function_privilege('service_role', signature, 'EXECUTE')
      ) ORDER BY signature), '[]'::jsonb)
      FROM (
        VALUES
          ('public.record_tracked_set(bigint,bigint,integer,text,numeric,numeric,text,integer,integer,boolean)'),
          ('public.create_custom_exercise(text)'),
          ('public.update_owned_program(jsonb)'),
          ('public.save_manual_program(jsonb)'),
          ('public.normalize_exercise_name(text)'),
          ('public.seed_standard_exercises(jsonb)'),
          ('public.resolve_routine_exercise(uuid,jsonb)'),
          ('public.routine_write_days(uuid,bigint,jsonb,boolean)'),
          ('public.routine_normalize_days(jsonb,boolean)'),
          ('public.routine_require_int(text,integer,integer,text)')
      ) AS listed(signature)
    ),
    'policies', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'table', c.relname,
        'name', pol.polname,
        'command', pol.polcmd,
        'permissive', pol.polpermissive,
        'roles', (
          SELECT COALESCE(jsonb_agg(role_name.rolname ORDER BY role_name.rolname), '[]'::jsonb)
          FROM pg_catalog.pg_roles role_name
          WHERE role_name.oid = ANY (pol.polroles)
        ),
        'using', pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
        'check', pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid)
      ) ORDER BY c.relname, pol.polname), '[]'::jsonb)
      FROM pg_catalog.pg_policy pol
      JOIN pg_catalog.pg_class c ON c.oid = pol.polrelid
      WHERE c.oid IN (
        'public.programs'::regclass,
        'public.program_days'::regclass,
        'public.program_exercises'::regclass,
        'public.workout_sessions'::regclass,
        'public.workout_sets'::regclass
      )
        AND pol.polcmd IN ('d', 'w', 'a')
    ),
    'foreign_keys', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', con.conname,
        'table', src.relname,
        'definition', pg_catalog.pg_get_constraintdef(con.oid),
        'delete_action', con.confdeltype
      ) ORDER BY src.relname, con.conname), '[]'::jsonb)
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
            'public.program_exercises'::regclass,
            'public.workout_sessions'::regclass,
            'public.workout_sets'::regclass
          )
        )
    )
  )
) AS preflight;

COMMIT;
