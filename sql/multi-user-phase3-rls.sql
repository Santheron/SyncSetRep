-- Multi-user Phase 3: strict authenticated RLS
--
-- DO NOT RUN THIS until:
--   1. Phase 1 schema is applied
--   2. You created your real account
--   3. Phase 2 claimed legacy rows
--   4. Confirm queries show 0 unowned workout/cardio/metric/program rows
--
-- After this runs:
--   - anon cannot read or write private training data
--   - authenticated users can only access their own rows
--   - exercises remain a shared catalog, SELECT for authenticated only
--
-- This does NOT delete or rewrite workout history.

BEGIN;

-- Refuse to lock the database if legacy rows are still unowned.
DO $$
DECLARE
  unowned_sessions integer;
  unowned_cardio integer;
  unowned_metrics integer;
  unowned_days integer;
BEGIN
  SELECT count(*) INTO unowned_sessions
  FROM public.workout_sessions
  WHERE user_id IS NULL;

  SELECT count(*) INTO unowned_cardio
  FROM public.cardio_sessions
  WHERE user_id IS NULL;

  SELECT count(*) INTO unowned_metrics
  FROM public.body_metrics
  WHERE user_id IS NULL;

  SELECT count(*) INTO unowned_days
  FROM public.program_days
  WHERE program_id IS NULL;

  IF unowned_sessions > 0 OR unowned_cardio > 0 OR unowned_metrics > 0 OR unowned_days > 0 THEN
    RAISE EXCEPTION
      'Refusing Phase 3 RLS. Unowned rows remain: sessions=%, cardio=%, body_metrics=%, program_days=%. Run Phase 2 claim first.',
      unowned_sessions, unowned_cardio, unowned_metrics, unowned_days;
  END IF;
END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cardio_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_metrics ENABLE ROW LEVEL SECURITY;

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
        'programs',
        'program_days',
        'program_exercises',
        'exercises',
        'workout_sessions',
        'workout_sets',
        'cardio_sessions',
        'body_metrics'
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

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.programs FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.program_days FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.program_exercises FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.exercises FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.workout_sessions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.workout_sets FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.cardio_sessions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.body_metrics FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.program_templates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.program_template_days FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.program_template_exercises FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.programs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.program_days TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.program_exercises TO authenticated;
GRANT SELECT ON TABLE public.exercises TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workout_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workout_sets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cardio_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.body_metrics TO authenticated;

DO $$
DECLARE
  seq text;
  rel text;
BEGIN
  FOREACH rel IN ARRAY ARRAY[
    'programs',
    'program_days',
    'program_exercises',
    'workout_sessions',
    'workout_sets',
    'cardio_sessions',
    'body_metrics'
  ]
  LOOP
    seq := pg_get_serial_sequence('public.' || rel, 'id');
    IF seq IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon', seq);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', seq);
    END IF;
  END LOOP;
END $$;

-- profiles
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY profiles_insert_own
  ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update_own
  ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- programs
CREATE POLICY programs_select_own
  ON public.programs
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY programs_insert_own
  ON public.programs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY programs_update_own
  ON public.programs
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY programs_delete_own
  ON public.programs
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- program_days owned through programs
CREATE POLICY program_days_select_own
  ON public.program_days
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.programs p
      WHERE p.id = program_days.program_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY program_days_insert_own
  ON public.program_days
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.programs p
      WHERE p.id = program_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY program_days_update_own
  ON public.program_days
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.programs p
      WHERE p.id = program_days.program_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.programs p
      WHERE p.id = program_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY program_days_delete_own
  ON public.program_days
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.programs p
      WHERE p.id = program_days.program_id
        AND p.user_id = auth.uid()
    )
  );

-- program_exercises owned through program_days -> programs
CREATE POLICY program_exercises_select_own
  ON public.program_exercises
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.program_days pd
      JOIN public.programs p ON p.id = pd.program_id
      WHERE pd.id = program_exercises.program_day_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY program_exercises_insert_own
  ON public.program_exercises
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.program_days pd
      JOIN public.programs p ON p.id = pd.program_id
      WHERE pd.id = program_day_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY program_exercises_update_own
  ON public.program_exercises
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.program_days pd
      JOIN public.programs p ON p.id = pd.program_id
      WHERE pd.id = program_exercises.program_day_id
        AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.program_days pd
      JOIN public.programs p ON p.id = pd.program_id
      WHERE pd.id = program_day_id
        AND p.user_id = auth.uid()
    )
  );

CREATE POLICY program_exercises_delete_own
  ON public.program_exercises
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.program_days pd
      JOIN public.programs p ON p.id = pd.program_id
      WHERE pd.id = program_exercises.program_day_id
        AND p.user_id = auth.uid()
    )
  );

-- Shared exercise catalog
CREATE POLICY exercises_select_authenticated
  ON public.exercises
  FOR SELECT TO authenticated
  USING (true);

-- workout_sessions
CREATE POLICY workout_sessions_select_own
  ON public.workout_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY workout_sessions_insert_own
  ON public.workout_sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY workout_sessions_update_own
  ON public.workout_sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY workout_sessions_delete_own
  ON public.workout_sessions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- workout_sets owned through workout_sessions
CREATE POLICY workout_sets_select_own
  ON public.workout_sets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions sessions
      WHERE sessions.id = workout_session_id
        AND sessions.user_id = auth.uid()
    )
  );

CREATE POLICY workout_sets_insert_own
  ON public.workout_sets
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions sessions
      WHERE sessions.id = workout_session_id
        AND sessions.user_id = auth.uid()
    )
  );

CREATE POLICY workout_sets_update_own
  ON public.workout_sets
  FOR UPDATE TO authenticated
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

CREATE POLICY workout_sets_delete_own
  ON public.workout_sets
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions sessions
      WHERE sessions.id = workout_session_id
        AND sessions.user_id = auth.uid()
    )
  );

-- cardio
CREATE POLICY cardio_sessions_select_own
  ON public.cardio_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY cardio_sessions_insert_own
  ON public.cardio_sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY cardio_sessions_update_own
  ON public.cardio_sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY cardio_sessions_delete_own
  ON public.cardio_sessions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- body metrics
CREATE POLICY body_metrics_select_own
  ON public.body_metrics
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY body_metrics_insert_own
  ON public.body_metrics
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY body_metrics_update_own
  ON public.body_metrics
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY body_metrics_delete_own
  ON public.body_metrics
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

COMMIT;

-- Optional, only after confirm queries still show 0 unowned rows:
-- ALTER TABLE public.workout_sessions ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE public.cardio_sessions ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE public.body_metrics ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE public.program_days ALTER COLUMN program_id SET NOT NULL;
