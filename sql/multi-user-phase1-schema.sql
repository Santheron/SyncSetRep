-- Multi-user Phase 1: schema + starter-program template
-- Paste this entire file into the Supabase SQL Editor and run it once.
--
-- SAFE:
--   Does NOT drop or truncate tables
--   Does NOT delete workout / cardio / body-metric / program rows
--   Does NOT assign user_id
--   Does NOT change existing program_days ids 1-5
--   Does NOT enable strict RLS on private training tables
--   Does NOT revoke the current single-user anon policies
--
-- This only:
--   1. Adds user-owned programs support
--   2. Snapshots the current 5-day routine into read-only template tables
--   3. Adds a SECURITY DEFINER function that COPIES that template for a user
--   4. Creates/updates profiles + signup trigger
--
-- Original program_days stay unowned (program_id NULL) until Phase 2.
-- New users must never edit those original rows.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name text,
  preferred_weight_unit text NOT NULL DEFAULT 'lb',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS preferred_weight_unit text DEFAULT 'lb',
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. User-owned programs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.programs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS programs_user_id_idx
  ON public.programs (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS programs_one_active_per_user_uidx
  ON public.programs (user_id)
  WHERE is_active;

ALTER TABLE public.program_days
  ADD COLUMN IF NOT EXISTS program_id bigint REFERENCES public.programs (id);

CREATE INDEX IF NOT EXISTS program_days_program_id_idx
  ON public.program_days (program_id);

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.programs TO authenticated;

DO $$
DECLARE
  seq text;
BEGIN
  seq := pg_get_serial_sequence('public.programs', 'id');
  IF seq IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO authenticated', seq);
  END IF;
END $$;

DROP POLICY IF EXISTS programs_select_own ON public.programs;
DROP POLICY IF EXISTS programs_insert_own ON public.programs;
DROP POLICY IF EXISTS programs_update_own ON public.programs;
DROP POLICY IF EXISTS programs_delete_own ON public.programs;

CREATE POLICY programs_select_own
  ON public.programs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY programs_insert_own
  ON public.programs
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY programs_update_own
  ON public.programs
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY programs_delete_own
  ON public.programs
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Read-only starter templates (not queried by the old app)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.program_templates (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS program_templates_one_default_uidx
  ON public.program_templates ((true))
  WHERE is_default;

CREATE TABLE IF NOT EXISTS public.program_template_days (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id bigint NOT NULL REFERENCES public.program_templates (id) ON DELETE CASCADE,
  day_order integer NOT NULL,
  name text NOT NULL,
  subtitle text,
  UNIQUE (template_id, day_order)
);

CREATE TABLE IF NOT EXISTS public.program_template_exercises (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_day_id bigint NOT NULL REFERENCES public.program_template_days (id) ON DELETE CASCADE,
  exercise_id bigint NOT NULL REFERENCES public.exercises (id),
  exercise_order integer NOT NULL,
  target_sets integer NOT NULL,
  min_reps integer NOT NULL,
  max_reps integer NOT NULL,
  notes text
);

ALTER TABLE public.program_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_template_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.program_template_exercises ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.program_templates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.program_template_days FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.program_template_exercises FROM PUBLIC, anon, authenticated;

INSERT INTO public.program_templates (slug, name, is_default)
VALUES ('syncsetrep-starter', 'SyncSetRep Starter', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.program_template_days (template_id, day_order, name, subtitle)
SELECT t.id, pd.day_order, pd.name, pd.subtitle
FROM public.program_templates t
JOIN public.program_days pd
  ON pd.program_id IS NULL
WHERE t.slug = 'syncsetrep-starter'
  AND NOT EXISTS (
    SELECT 1
    FROM public.program_template_days existing
    WHERE existing.template_id = t.id
  );

INSERT INTO public.program_template_exercises (
  template_day_id,
  exercise_id,
  exercise_order,
  target_sets,
  min_reps,
  max_reps,
  notes
)
SELECT
  td.id,
  pe.exercise_id,
  pe.exercise_order,
  pe.target_sets,
  pe.min_reps,
  pe.max_reps,
  pe.notes
FROM public.program_templates t
JOIN public.program_template_days td
  ON td.template_id = t.id
JOIN public.program_days pd
  ON pd.program_id IS NULL
 AND pd.day_order = td.day_order
JOIN public.program_exercises pe
  ON pe.program_day_id = pd.id
WHERE t.slug = 'syncsetrep-starter'
  AND NOT EXISTS (
    SELECT 1
    FROM public.program_template_exercises existing
    WHERE existing.template_day_id = td.id
  );

DO $$
DECLARE
  template_days integer;
  template_exercises integer;
  source_days integer;
  source_exercises integer;
BEGIN
  SELECT count(*) INTO source_days
  FROM public.program_days
  WHERE program_id IS NULL;

  SELECT count(*) INTO source_exercises
  FROM public.program_exercises pe
  JOIN public.program_days pd ON pd.id = pe.program_day_id
  WHERE pd.program_id IS NULL;

  SELECT count(*) INTO template_days
  FROM public.program_template_days td
  JOIN public.program_templates t ON t.id = td.template_id
  WHERE t.slug = 'syncsetrep-starter';

  SELECT count(*) INTO template_exercises
  FROM public.program_template_exercises te
  JOIN public.program_template_days td ON td.id = te.template_day_id
  JOIN public.program_templates t ON t.id = td.template_id
  WHERE t.slug = 'syncsetrep-starter';

  IF source_days <> 5 OR template_days <> 5 THEN
    RAISE EXCEPTION
      'Starter template day snapshot mismatch. source_days=%, template_days=%. No claim/RLS changes were made, but Phase 1 aborted so the template is not silently wrong.',
      source_days, template_days;
  END IF;

  IF source_exercises <> template_exercises THEN
    RAISE EXCEPTION
      'Starter template exercise snapshot mismatch. source_exercises=%, template_exercises=%.',
      source_exercises, template_exercises;
  END IF;

  RAISE NOTICE 'Starter template snapshot OK: % days, % exercises', template_days, template_exercises;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Copy a template into independent user-owned rows
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.copy_starter_program(
  target_user_id uuid,
  template_slug text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  template_row public.program_templates%ROWTYPE;
  existing_id bigint;
  new_program_id bigint;
  day_rec public.program_template_days%ROWTYPE;
  new_day_id bigint;
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required';
  END IF;

  SELECT id
  INTO existing_id
  FROM public.programs
  WHERE user_id = target_user_id
    AND is_active
  ORDER BY id
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  SELECT id
  INTO existing_id
  FROM public.programs
  WHERE user_id = target_user_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    UPDATE public.programs
    SET is_active = (id = existing_id),
        updated_at = now()
    WHERE user_id = target_user_id;
    RETURN existing_id;
  END IF;

  IF template_slug IS NOT NULL THEN
    SELECT *
    INTO template_row
    FROM public.program_templates
    WHERE slug = template_slug
    LIMIT 1;
  ELSE
    SELECT *
    INTO template_row
    FROM public.program_templates
    WHERE is_default
    ORDER BY id
    LIMIT 1;
  END IF;

  IF template_row.id IS NULL THEN
    RAISE EXCEPTION 'No starter program template found';
  END IF;

  INSERT INTO public.programs (user_id, name, slug, is_active)
  VALUES (target_user_id, template_row.name, template_row.slug, true)
  RETURNING id INTO new_program_id;

  FOR day_rec IN
    SELECT *
    FROM public.program_template_days
    WHERE template_id = template_row.id
    ORDER BY day_order, id
  LOOP
    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (new_program_id, day_rec.name, day_rec.subtitle, day_rec.day_order)
    RETURNING id INTO new_day_id;

    INSERT INTO public.program_exercises (
      program_day_id,
      exercise_id,
      exercise_order,
      target_sets,
      min_reps,
      max_reps,
      notes
    )
    SELECT
      new_day_id,
      te.exercise_id,
      te.exercise_order,
      te.target_sets,
      te.min_reps,
      te.max_reps,
      te.notes
    FROM public.program_template_exercises te
    WHERE te.template_day_id = day_rec.id
    ORDER BY te.exercise_order, te.id;
  END LOOP;

  RETURN new_program_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.copy_starter_program_for_current_user()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN public.copy_starter_program(auth.uid(), NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.copy_starter_program(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.copy_starter_program_for_current_user() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Create profile + starter program after signup
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

  BEGIN
    PERFORM public.copy_starter_program(NEW.id, NULL);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'copy_starter_program failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();

-- Keep existing profile policies if present; add them if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_select_own'
  ) THEN
    CREATE POLICY profiles_select_own
      ON public.profiles
      FOR SELECT
      TO authenticated
      USING (id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_insert_own'
  ) THEN
    CREATE POLICY profiles_insert_own
      ON public.profiles
      FOR INSERT
      TO authenticated
      WITH CHECK (id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'profiles_update_own'
  ) THEN
    CREATE POLICY profiles_update_own
      ON public.profiles
      FOR UPDATE
      TO authenticated
      USING (id = auth.uid())
      WITH CHECK (id = auth.uid());
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.body_metrics TO authenticated;

COMMIT;
