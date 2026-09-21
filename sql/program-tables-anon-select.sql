-- Smallest fix: let the single-user (no-login) app READ the current program.
-- Does NOT touch workout_sessions or workout_sets.
-- Does NOT insert/update/delete program rows.
-- Does NOT grant write access to anon.
--
-- Paste this entire file into the Supabase SQL Editor and run it once.

BEGIN;

GRANT SELECT ON TABLE public.program_days TO anon, authenticated;
GRANT SELECT ON TABLE public.program_exercises TO anon, authenticated;
GRANT SELECT ON TABLE public.exercises TO anon, authenticated;

DO $$
DECLARE
  pol record;
BEGIN
  RAISE NOTICE 'Existing program_days policies:';
  FOR pol IN
    SELECT policyname, roles, cmd
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'program_days'
  LOOP
    RAISE NOTICE '  % | % | %', pol.policyname, pol.roles, pol.cmd;
  END LOOP;

  RAISE NOTICE 'Existing program_exercises policies:';
  FOR pol IN
    SELECT policyname, roles, cmd
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'program_exercises'
  LOOP
    RAISE NOTICE '  % | % | %', pol.policyname, pol.roles, pol.cmd;
  END LOOP;

  RAISE NOTICE 'Existing exercises policies:';
  FOR pol IN
    SELECT policyname, roles, cmd
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'exercises'
  LOOP
    RAISE NOTICE '  % | % | %', pol.policyname, pol.roles, pol.cmd;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'program_days'
      AND cmd = 'SELECT'
      AND 'anon' = ANY (roles)
  ) THEN
    EXECUTE $sql$
      CREATE POLICY "program_days_read"
      ON public.program_days
      FOR SELECT
      TO anon, authenticated
      USING (true)
    $sql$;
    RAISE NOTICE 'Created policy program_days_read';
  ELSE
    RAISE NOTICE 'Skipped program_days_read; anon SELECT policy already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'program_exercises'
      AND cmd = 'SELECT'
      AND 'anon' = ANY (roles)
  ) THEN
    EXECUTE $sql$
      CREATE POLICY "program_exercises_read"
      ON public.program_exercises
      FOR SELECT
      TO anon, authenticated
      USING (true)
    $sql$;
    RAISE NOTICE 'Created policy program_exercises_read';
  ELSE
    RAISE NOTICE 'Skipped program_exercises_read; anon SELECT policy already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'exercises'
      AND cmd = 'SELECT'
      AND 'anon' = ANY (roles)
  ) THEN
    EXECUTE $sql$
      CREATE POLICY "exercises_read"
      ON public.exercises
      FOR SELECT
      TO anon, authenticated
      USING (true)
    $sql$;
    RAISE NOTICE 'Created policy exercises_read';
  ELSE
    RAISE NOTICE 'Skipped exercises_read; anon SELECT policy already exists';
  END IF;
END $$;

COMMIT;
