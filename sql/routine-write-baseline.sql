-- NOT APPLIED.
-- Read-only pre-install collision and dependency check.
-- Run this before sql/load-mode.sql, after the live day-order constraint
-- is already in place. Do not rerun sql/ai-import-day-order.sql.
-- This file does not execute functions and does not change privileges.
-- It raises routine_write_function_present when a target name already has
-- one signature, and routine_write_overload when a target name has more
-- than one signature.
-- It raises routine_write_baseline_differs when a policy, trigger, grant,
-- foreign key, column, or constraint differs from the verified baseline.
-- The only success result is routine_write_baseline_ready.

BEGIN;

SET LOCAL default_transaction_read_only = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $baseline$
DECLARE
  target_names text[] := ARRAY[
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
  required_privileges text[] := ARRAY[
    'DELETE',
    'INSERT',
    'REFERENCES',
    'SELECT',
    'TRIGGER',
    'TRUNCATE',
    'UPDATE'
  ];
  function_name text;
  privilege_name text;
  installed_count bigint;
  signature_list text;
  policy_names text;
  policy_expr text;
  policy_roles text;
  policy_command text;
  trigger_names text;
  fk_action "char";
  constraint_def text;
BEGIN
  FOREACH function_name IN ARRAY target_names LOOP
    SELECT count(*),
           string_agg(
             pg_catalog.pg_get_function_identity_arguments(proc.oid),
             ' | ' ORDER BY proc.oid
           )
    INTO installed_count, signature_list
    FROM pg_catalog.pg_proc proc
    WHERE proc.pronamespace = 'public'::regnamespace
      AND proc.proname = function_name;

    IF installed_count > 1 THEN
      RAISE EXCEPTION 'routine_write_overload: % (%)', function_name, signature_list;
    END IF;
    IF installed_count = 1 THEN
      RAISE EXCEPTION 'routine_write_function_present: % (%)', function_name, signature_list;
    END IF;
  END LOOP;

  SELECT string_agg(pol.polname, ',' ORDER BY pol.polname)
  INTO policy_names
  FROM pg_catalog.pg_policy pol
  WHERE pol.polrelid = 'public.exercises'::regclass;

  IF policy_names IS DISTINCT FROM 'exercises_select_authenticated' THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: exercise policies %',
      COALESCE(policy_names, '<none>');
  END IF;

  SELECT pg_catalog.pg_get_expr(pol.polqual, pol.polrelid),
         COALESCE((
           SELECT string_agg(pg_catalog.pg_get_userbyid(role_id), ',' ORDER BY 1)
           FROM unnest(pol.polroles) AS role_id
         ), 'PUBLIC'),
         pol.polcmd::text
  INTO policy_expr, policy_roles, policy_command
  FROM pg_catalog.pg_policy pol
  WHERE pol.polrelid = 'public.exercises'::regclass
    AND pol.polname = 'exercises_select_authenticated';

  IF policy_expr IS DISTINCT FROM 'true'
    OR policy_roles IS DISTINCT FROM 'authenticated'
    OR policy_command IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION
      'routine_write_baseline_differs: exercises_select_authenticated expr=% roles=% cmd=%',
      policy_expr, policy_roles, policy_command;
  END IF;

  SELECT string_agg(
    pg_catalog.quote_ident(cls.relname) || '.' || pg_catalog.quote_ident(trg.tgname),
    ',' ORDER BY cls.relname, trg.tgname
  )
  INTO trigger_names
  FROM pg_catalog.pg_trigger trg
  JOIN pg_catalog.pg_class cls ON cls.oid = trg.tgrelid
  JOIN pg_catalog.pg_namespace nsp ON nsp.oid = cls.relnamespace
  WHERE nsp.nspname = 'public'
    AND cls.relname IN ('exercises', 'program_days', 'program_exercises', 'workout_sets')
    AND NOT trg.tgisinternal;

  IF trigger_names IS NOT NULL THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: triggers %', trigger_names;
  END IF;

  FOREACH privilege_name IN ARRAY required_privileges LOOP
    IF NOT has_table_privilege('authenticated', 'public.exercises', privilege_name) THEN
      RAISE EXCEPTION
        'routine_write_baseline_differs: authenticated lacks % on exercises',
        privilege_name;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.exercises', 'SELECT') THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: anon can select exercises';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.exercises', 'SELECT') THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: service_role lacks SELECT on exercises';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute attribute
    JOIN pg_catalog.pg_class cls ON cls.oid = attribute.attrelid
    JOIN pg_catalog.pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = 'public'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND (
        (cls.relname = 'workout_sets' AND attribute.attname IN ('load_mode', 'assistance', 'weight_unit'))
        OR (cls.relname = 'program_exercises' AND attribute.attname = 'load_mode')
        OR (cls.relname = 'program_days' AND attribute.attname = 'archived_at')
        OR (cls.relname = 'exercises' AND attribute.attname = 'owner_user_id')
      )
  ) THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: a target column already exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname IN ('workout_sets_tracked_load_check', 'program_exercises_load_mode_check')
  ) THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: a tracking check already exists';
  END IF;

  SELECT con.confdeltype
  INTO fk_action
  FROM pg_catalog.pg_constraint con
  WHERE con.conname = 'program_exercises_exercise_id_fkey';
  IF fk_action IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: program_exercises_exercise_id_fkey %', fk_action;
  END IF;

  SELECT con.confdeltype
  INTO fk_action
  FROM pg_catalog.pg_constraint con
  WHERE con.conname = 'program_exercises_program_day_id_fkey';
  IF fk_action IS DISTINCT FROM 'c' THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: program_exercises_program_day_id_fkey %', fk_action;
  END IF;

  SELECT con.confdeltype
  INTO fk_action
  FROM pg_catalog.pg_constraint con
  WHERE con.conname = 'workout_sets_exercise_id_fkey';
  IF fk_action IS DISTINCT FROM 'a' THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: workout_sets_exercise_id_fkey %', fk_action;
  END IF;

  SELECT con.confdeltype
  INTO fk_action
  FROM pg_catalog.pg_constraint con
  WHERE con.conname = 'program_template_exercises_exercise_id_fkey';
  IF fk_action IS DISTINCT FROM 'a' THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: program_template_exercises_exercise_id_fkey %', fk_action;
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(con.oid)
  INTO constraint_def
  FROM pg_catalog.pg_constraint con
  WHERE con.conname = 'program_days_program_id_day_order_key';
  IF constraint_def IS DISTINCT FROM 'UNIQUE NULLS NOT DISTINCT (program_id, day_order)' THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: day order %', COALESCE(constraint_def, '<absent>');
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(con.oid)
  INTO constraint_def
  FROM pg_catalog.pg_constraint con
  WHERE con.conname = 'exercises_name_key';
  IF constraint_def IS DISTINCT FROM 'UNIQUE (name)' THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: exercise name key %', COALESCE(constraint_def, '<absent>');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class cls
    JOIN pg_catalog.pg_namespace nsp ON nsp.oid = cls.relnamespace
    WHERE nsp.nspname = 'public'
      AND cls.relname = 'exercises'
      AND cls.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'routine_write_baseline_differs: exercises row security is off';
  END IF;
END
$baseline$;

SELECT 'routine_write_baseline_ready' AS result;

COMMIT;
