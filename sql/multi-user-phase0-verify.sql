-- Multi-user Phase 0: READ-ONLY verification
-- Paste this into the Supabase SQL Editor. It does not INSERT/UPDATE/DELETE.
-- Safe to run before or after Phase 1 / Phase 2.

-- ---------------------------------------------------------------------------
-- Tables / columns that matter for ownership
-- ---------------------------------------------------------------------------
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles',
    'programs',
    'program_days',
    'program_exercises',
    'program_templates',
    'program_template_days',
    'program_template_exercises',
    'exercises',
    'workout_sessions',
    'workout_sets',
    'cardio_sessions',
    'body_metrics'
  )
ORDER BY table_name, ordinal_position;

-- ---------------------------------------------------------------------------
-- Live row counts
-- ---------------------------------------------------------------------------
SELECT 'workout_sessions' AS table_name,
       count(*) AS total,
       count(*) FILTER (WHERE user_id IS NULL) AS unowned_user_id
FROM public.workout_sessions
UNION ALL
SELECT 'workout_sets', count(*), NULL
FROM public.workout_sets
UNION ALL
SELECT 'cardio_sessions', count(*),
       count(*) FILTER (WHERE user_id IS NULL)
FROM public.cardio_sessions
UNION ALL
SELECT 'body_metrics', count(*),
       count(*) FILTER (WHERE user_id IS NULL)
FROM public.body_metrics
UNION ALL
SELECT 'program_days', count(*), NULL
FROM public.program_days
UNION ALL
SELECT 'program_exercises', count(*), NULL
FROM public.program_exercises
UNION ALL
SELECT 'exercises', count(*), NULL
FROM public.exercises;

-- Unfinished workouts that must keep their IDs
SELECT id, program_day_id, user_id, started_at, finished_at, exercise_overrides
FROM public.workout_sessions
WHERE finished_at IS NULL
ORDER BY id;

-- Current program days (legacy SyncSetRep routine is currently global)
SELECT id, day_order, name, subtitle
FROM public.program_days
ORDER BY day_order, id;

-- Auth users (empty until you create your SyncSetRep account)
SELECT id, email, created_at
FROM auth.users
ORDER BY created_at;

-- Current policies that Phase 3 will replace
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'profiles',
    'programs',
    'program_days',
    'program_exercises',
    'exercises',
    'workout_sessions',
    'workout_sets',
    'cardio_sessions',
    'body_metrics'
  )
ORDER BY tablename, policyname;
