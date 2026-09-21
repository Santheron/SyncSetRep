-- Cardio logging for the single-user (no-login) app
-- Paste this entire file into the Supabase SQL Editor and run it once.
--
-- WHY: live anon INSERT/SELECT on public.cardio_sessions currently fails with
--   42501 permission denied
--   hint: GRANT SELECT, INSERT ON public.cardio_sessions TO anon;
--
-- This does NOT:
--   - delete cardio rows
--   - touch workout_sessions / workout_sets
--   - change user_id values
--   - reintroduce authentication
--
-- It only restores anon/authenticated table privileges and the same open
-- single-user RLS policy already used by workout_sessions.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Inspect the live table (read-only notices)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
BEGIN
  RAISE NOTICE '--- cardio_sessions columns ---';
  FOR rec IN
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cardio_sessions'
    ORDER BY ordinal_position
  LOOP
    RAISE NOTICE '  % | % | nullable=% | default=%',
      rec.column_name, rec.data_type, rec.is_nullable, rec.column_default;
  END LOOP;

  RAISE NOTICE '--- cardio_sessions privileges ---';
  FOR rec IN
    SELECT grantee, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'cardio_sessions'
      AND grantee IN ('anon', 'authenticated', 'PUBLIC')
    ORDER BY grantee, privilege_type
  LOOP
    RAISE NOTICE '  %: %', rec.grantee, rec.privilege_type;
  END LOOP;

  RAISE NOTICE '--- cardio_sessions policies ---';
  FOR rec IN
    SELECT policyname, roles, cmd
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cardio_sessions'
  LOOP
    RAISE NOTICE '  % | % | %', rec.policyname, rec.roles, rec.cmd;
  END LOOP;

  RAISE NOTICE '--- cardio_sessions check constraints ---';
  FOR rec IN
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'cardio_sessions'
      AND con.contype = 'c'
  LOOP
    RAISE NOTICE '  % | %', rec.conname, rec.def;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Keep user_id if present, but do not require it
-- ---------------------------------------------------------------------------
DO $$
BEGIN
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
END $$;

-- ---------------------------------------------------------------------------
-- 3. Table privileges (this is the live 42501 failure)
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cardio_sessions TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS: add the open single-user policy if anon cannot insert yet
--    Does not drop other tables' policies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.cardio_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cardio_sessions'
      AND cmd IN ('ALL', 'INSERT')
      AND 'anon' = ANY (roles)
  ) THEN
    EXECUTE $sql$
      CREATE POLICY "dev_single_user_cardio_sessions"
      ON public.cardio_sessions
      FOR ALL
      TO anon, authenticated
      USING (true)
      WITH CHECK (true)
    $sql$;
    RAISE NOTICE 'Created policy dev_single_user_cardio_sessions';
  ELSE
    RAISE NOTICE 'Skipped cardio RLS policy; anon INSERT/ALL policy already exists';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. If activity_type is constrained, allow the current app activity list.
--    Existing rows are not rewritten.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'cardio_sessions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%activity_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.cardio_sessions DROP CONSTRAINT %I', rec.conname);
    RAISE NOTICE 'Dropped activity_type check constraint %', rec.conname;
  END LOOP;
END $$;

COMMIT;
