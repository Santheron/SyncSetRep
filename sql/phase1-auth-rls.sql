-- Run this in the Supabase SQL editor.
-- Does NOT delete existing workout/cardio/body-metric rows.
-- Does NOT guess or assign a user UUID.
-- After this runs, existing rows stay with user_id NULL and are hidden
-- until you run sql/phase2-assign-existing-rows.sql with your auth user UUID.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text,
  preferred_weight_unit text NOT NULL DEFAULT 'lb',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS preferred_weight_unit text DEFAULT 'lb',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Nullable ownership columns (existing rows stay unassigned)
-- ---------------------------------------------------------------------------
ALTER TABLE public.workout_sessions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id);

CREATE INDEX IF NOT EXISTS workout_sessions_user_id_idx
  ON public.workout_sessions (user_id);

ALTER TABLE public.cardio_sessions
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id);

CREATE INDEX IF NOT EXISTS cardio_sessions_user_id_idx
  ON public.cardio_sessions (user_id);

-- workout_sets stay owned through workout_sessions. No redundant user_id.

DO $$
BEGIN
  IF to_regclass('public.body_metrics') IS NULL THEN
    CREATE TABLE public.body_metrics (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid REFERENCES auth.users (id),
      recorded_at timestamptz NOT NULL DEFAULT now(),
      bodyweight numeric,
      waist numeric,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  ELSE
    ALTER TABLE public.body_metrics
      ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS body_metrics_user_id_idx
  ON public.body_metrics (user_id);

ALTER TABLE public.workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cardio_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 3. Drop existing policies on these tables (including open anon policies)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'profiles',
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

-- ---------------------------------------------------------------------------
-- 4. Revoke anonymous access to personal and shared tables
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.workout_sessions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.workout_sets FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.cardio_sessions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.body_metrics FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.program_days FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.program_exercises FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.exercises FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workout_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workout_sets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cardio_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.body_metrics TO authenticated;
GRANT SELECT ON TABLE public.program_days TO authenticated;
GRANT SELECT ON TABLE public.program_exercises TO authenticated;
GRANT SELECT ON TABLE public.exercises TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS policies
-- ---------------------------------------------------------------------------
CREATE POLICY "profiles_select_own"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_insert_own"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "workout_sessions_select_own"
  ON public.workout_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "workout_sessions_insert_own"
  ON public.workout_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "workout_sessions_update_own"
  ON public.workout_sessions
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "workout_sessions_delete_own"
  ON public.workout_sessions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "workout_sets_select_own"
  ON public.workout_sets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions sessions
      WHERE sessions.id = workout_session_id
        AND sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "workout_sets_insert_own"
  ON public.workout_sets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions sessions
      WHERE sessions.id = workout_session_id
        AND sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "workout_sets_update_own"
  ON public.workout_sets
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions sessions
      WHERE sessions.id = workout_session_id
        AND sessions.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions sessions
      WHERE sessions.id = workout_session_id
        AND sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "workout_sets_delete_own"
  ON public.workout_sets
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions sessions
      WHERE sessions.id = workout_session_id
        AND sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "cardio_sessions_select_own"
  ON public.cardio_sessions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "cardio_sessions_insert_own"
  ON public.cardio_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "cardio_sessions_update_own"
  ON public.cardio_sessions
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "cardio_sessions_delete_own"
  ON public.cardio_sessions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "body_metrics_select_own"
  ON public.body_metrics
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "body_metrics_insert_own"
  ON public.body_metrics
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "body_metrics_update_own"
  ON public.body_metrics
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "body_metrics_delete_own"
  ON public.body_metrics
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "program_days_select_authenticated"
  ON public.program_days
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "program_exercises_select_authenticated"
  ON public.program_exercises
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "exercises_select_authenticated"
  ON public.exercises
  FOR SELECT
  TO authenticated
  USING (true);

-- ---------------------------------------------------------------------------
-- 6. Create a profile row automatically after signup
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, preferred_weight_unit)
  VALUES (
    NEW.id,
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'display_name', '')), ''),
    'lb'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();

COMMIT;
