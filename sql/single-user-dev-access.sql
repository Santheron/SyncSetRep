-- Single-user development access
-- Paste this entire file into the Supabase SQL Editor and run it once.
--
-- This does NOT delete workout history, program data, cardio, or body metrics.
-- user_id columns stay in place for a future multi-user version.
-- They are made nullable and ignored by the current app.
--
-- Temporary: anon and authenticated clients can read/write personal tables
-- without signing in. Restore user-specific RLS later before adding accounts.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Keep ownership columns, but do not require them
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workout_sessions'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.workout_sessions
      ALTER COLUMN user_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cardio_sessions'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.cardio_sessions
      ALTER COLUMN user_id DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'body_metrics'
      AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.body_metrics
      ALTER COLUMN user_id DROP NOT NULL;
  END IF;
END $$;

-- Body fat is optional. Existing rows keep NULL.
DO $$
BEGIN
  IF to_regclass('public.body_metrics') IS NOT NULL THEN
    ALTER TABLE public.body_metrics
      ADD COLUMN IF NOT EXISTS body_fat numeric;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Collapse accidental duplicate sets for the SAME session/exercise/set
--    This does not delete unique history. It only removes extra copies of
--    the same logical set so the unique constraint can be added.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  duplicate_groups integer;
  removed_rows integer;
BEGIN
  SELECT COUNT(*)
  INTO duplicate_groups
  FROM (
    SELECT workout_session_id, exercise_id, set_number
    FROM public.workout_sets
    GROUP BY workout_session_id, exercise_id, set_number
    HAVING COUNT(*) > 1
  ) grouped;

  RAISE NOTICE 'workout_sets duplicate groups before cleanup: %', duplicate_groups;

  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY workout_session_id, exercise_id, set_number
        ORDER BY
          (COALESCE(is_completed, false) IS TRUE) DESC,
          id DESC
      ) AS rn
    FROM public.workout_sets
  )
  DELETE FROM public.workout_sets
  WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

  GET DIAGNOSTICS removed_rows = ROW_COUNT;
  RAISE NOTICE 'workout_sets extra duplicate rows removed: %', removed_rows;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS workout_sets_session_exercise_set_uidx
  ON public.workout_sets (workout_session_id, exercise_id, set_number);

-- ---------------------------------------------------------------------------
-- 3. Temporary open RLS for the single-user development app
-- ---------------------------------------------------------------------------
ALTER TABLE public.workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cardio_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'workout_sessions',
        'workout_sets',
        'cardio_sessions',
        'body_metrics',
        'program_days',
        'program_exercises',
        'exercises'
      )
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I.%I',
      pol.policyname,
      pol.schemaname,
      pol.tablename
    );
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workout_sessions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workout_sets TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cardio_sessions TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.body_metrics TO anon, authenticated;
GRANT SELECT ON TABLE public.program_days TO anon, authenticated;
GRANT SELECT ON TABLE public.program_exercises TO anon, authenticated;
GRANT SELECT ON TABLE public.exercises TO anon, authenticated;

CREATE POLICY "dev_single_user_workout_sessions"
  ON public.workout_sessions
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "dev_single_user_workout_sets"
  ON public.workout_sets
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "dev_single_user_cardio_sessions"
  ON public.cardio_sessions
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "dev_single_user_body_metrics"
  ON public.body_metrics
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "dev_single_user_program_days_select"
  ON public.program_days
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "dev_single_user_program_exercises_select"
  ON public.program_exercises
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "dev_single_user_exercises_select"
  ON public.exercises
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMIT;
