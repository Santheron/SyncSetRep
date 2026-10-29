-- Read-only post-check for sql/ai-import-save-program.sql.
-- Run this after that file is applied and before any import call.
-- Do not call save_imported_program or consume_ai_import_quota.
-- save_program_body_md5 is md5(prosrc), the exact stored function body.
-- save_program_definition_md5 is md5(pg_get_functiondef(oid)), measured on PostgreSQL 17.11.
-- Both hashes belong to the hardened SECURITY INVOKER function with an empty search_path.
-- The five workout fingerprints are the verified 2026-10-29 11:44 backup.

BEGIN;

SET LOCAL default_transaction_read_only = on;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL datestyle = 'ISO, MDY';
SET LOCAL extra_float_digits = 1;
SET LOCAL bytea_output = 'hex';

WITH save_proc AS (
  SELECT
    proc.prosecdef,
    proc.proconfig,
    proc.prosrc,
    pg_get_function_identity_arguments(proc.oid) AS identity_arguments,
    lang.lanname AS language_name,
    md5(proc.prosrc) AS body_md5,
    md5(pg_get_functiondef(proc.oid)) AS definition_md5
  FROM pg_proc proc
  JOIN pg_language lang ON lang.oid = proc.prolang
  WHERE proc.oid = to_regprocedure('public.save_imported_program(jsonb)')
),
facts AS (
  SELECT
    to_regprocedure('public.save_imported_program(jsonb)') IS NOT NULL AS save_function_present,
    (SELECT prosecdef FROM save_proc) AS security_definer,
    (SELECT identity_arguments FROM save_proc) AS identity_arguments,
    (SELECT language_name FROM save_proc) AS language_name,
    (SELECT body_md5 FROM save_proc) AS body_md5,
    (SELECT definition_md5 FROM save_proc) AS definition_md5,
    EXISTS (
      SELECT 1
      FROM save_proc
      CROSS JOIN LATERAL unnest(COALESCE(proconfig, ARRAY[]::text[])) AS cfg
      WHERE replace(cfg, ' ', '') IN ('search_path=', 'search_path=""')
    ) AS search_path_empty,
    CASE
      WHEN to_regprocedure('public.save_imported_program(jsonb)') IS NULL THEN false
      ELSE has_function_privilege('authenticated', 'public.save_imported_program(jsonb)', 'EXECUTE')
    END AS authenticated_execute,
    CASE
      WHEN to_regprocedure('public.save_imported_program(jsonb)') IS NULL THEN false
      ELSE has_function_privilege('anon', 'public.save_imported_program(jsonb)', 'EXECUTE')
    END AS anon_execute,
    CASE
      WHEN to_regprocedure('public.save_imported_program(jsonb)') IS NULL THEN false
      ELSE has_function_privilege('public', 'public.save_imported_program(jsonb)', 'EXECUTE')
    END AS public_execute,
    CASE
      WHEN to_regrole('service_role') IS NULL
        OR to_regprocedure('public.save_imported_program(jsonb)') IS NULL THEN NULL
      ELSE has_function_privilege('service_role', 'public.save_imported_program(jsonb)', 'EXECUTE')
    END AS service_role_execute,
    (SELECT count(*) FROM public.ai_import_attempts) AS quota_attempt_count,
    (SELECT count(*)::integer FROM public.workout_sessions WHERE finished_at IS NOT NULL) AS finished_sessions,
    (SELECT count(*)::integer FROM public.workout_sets) AS workout_sets,
    (SELECT count(*)::integer FROM public.programs WHERE is_active) AS active_programs,
    (SELECT count(*)::integer FROM public.programs WHERE NOT is_active) AS inactive_programs,
    (SELECT count(*)::integer FROM public.program_days) AS program_days,
    (SELECT count(*)::integer FROM public.program_exercises) AS program_exercises,
    (SELECT is_active FROM public.programs WHERE id = 1) AS program_1_active,
    (SELECT count(*)::integer FROM public.program_days WHERE program_id = 1) AS program_1_days,
    (
      SELECT count(*)::integer
      FROM public.program_exercises exercise
      JOIN public.program_days day ON day.id = exercise.program_day_id
      WHERE day.program_id = 1
    ) AS program_1_exercises,
    (SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')) FROM public.workout_sessions s) AS sessions_fingerprint,
    (SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')) FROM public.workout_sets s) AS sets_fingerprint,
    (SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')) FROM public.programs s) AS programs_fingerprint,
    (SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')) FROM public.program_days s) AS program_days_fingerprint,
    (SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')) FROM public.program_exercises s) AS program_exercises_fingerprint
)
SELECT jsonb_pretty(jsonb_build_object(
  'save_function_present', save_function_present,
  'security_definer', security_definer,
  'identity_arguments', identity_arguments,
  'language_name', language_name,
  'search_path_empty', search_path_empty,
  'body_md5', body_md5,
  'expected_body_md5', 'ab614932badcedfc0c71eb1ee6d00087',
  'definition_md5', definition_md5,
  'expected_definition_md5', '6275a18bdc001065d7ad77c0c4d52fbb',
  'authenticated_execute', authenticated_execute,
  'anon_execute', anon_execute,
  'public_execute', public_execute,
  'service_role_execute', service_role_execute,
  'quota_attempt_count', quota_attempt_count,
  'finished_sessions', finished_sessions,
  'workout_sets', workout_sets,
  'active_programs', active_programs,
  'inactive_programs', inactive_programs,
  'program_days', program_days,
  'program_exercises', program_exercises,
  'program_1_active', program_1_active,
  'program_1_days', program_1_days,
  'program_1_exercises', program_1_exercises,
  'sessions_fingerprint', sessions_fingerprint,
  'sets_fingerprint', sets_fingerprint,
  'programs_fingerprint', programs_fingerprint,
  'program_days_fingerprint', program_days_fingerprint,
  'program_exercises_fingerprint', program_exercises_fingerprint,
  'post_save_ok', (
    save_function_present
    AND security_definer IS FALSE
    AND identity_arguments = 'p_program jsonb'
    AND language_name = 'plpgsql'
    AND search_path_empty
    AND body_md5 = 'ab614932badcedfc0c71eb1ee6d00087'
    AND definition_md5 = '6275a18bdc001065d7ad77c0c4d52fbb'
    AND authenticated_execute
    AND anon_execute IS FALSE
    AND public_execute IS FALSE
    AND finished_sessions = 30
    AND workout_sets = 471
    AND active_programs = 1
    AND inactive_programs = 0
    AND program_days = 5
    AND program_exercises = 27
    AND program_1_active IS TRUE
    AND program_1_days = 5
    AND program_1_exercises = 27
    AND sessions_fingerprint = '493fb5410117b8c21bdf889dfb4a2ff6'
    AND sets_fingerprint = '07760919db4138a0e91c4fb110f5696f'
    AND programs_fingerprint = '25ab74a046240dd3edb1fb2aafc933bb'
    AND program_days_fingerprint = '2cc75fb013e74313c15e06d57fe9c3fe'
    AND program_exercises_fingerprint = '90aff33890119d3aa04472f3612260bd'
  )
)) AS save_program_postcheck
FROM facts;

COMMIT;
