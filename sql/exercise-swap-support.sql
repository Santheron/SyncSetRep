-- Exercise swapping support for the single-user (no-login) app
-- Paste this entire file into the Supabase SQL Editor and run it once.
--
-- This does NOT:
--   - delete or update workout_sessions rows (except adding a new column)
--   - delete or update workout_sets
--   - rename existing exercises
--   - change the 5-day program unless you later use Replace In Program in the app
--
-- Changes:
--   1. Optional session override map on workout_sessions
--   2. Anon UPDATE on program_exercises (permanent swap only)
--   3. Insert Preacher Curl Machine and Front Military Press if missing

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Session-only override map
--    Keys are program_exercises.id, values are replacement exercises.id.
--    Existing sessions get {}. Historical sets are not modified.
-- ---------------------------------------------------------------------------
ALTER TABLE public.workout_sessions
  ADD COLUMN IF NOT EXISTS exercise_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Permanent program swap needs UPDATE on program_exercises
--    Currently live anon UPDATE fails with 42501.
-- ---------------------------------------------------------------------------
GRANT UPDATE ON TABLE public.program_exercises TO anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'program_exercises'
      AND cmd IN ('ALL', 'UPDATE')
      AND 'anon' = ANY (roles)
  ) THEN
    EXECUTE $sql$
      CREATE POLICY "dev_single_user_program_exercises_update"
      ON public.program_exercises
      FOR UPDATE
      TO anon, authenticated
      USING (true)
      WITH CHECK (true)
    $sql$;
    RAISE NOTICE 'Created policy dev_single_user_program_exercises_update';
  ELSE
    RAISE NOTICE 'Skipped program_exercises UPDATE policy; already exists';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Add substitution targets as NEW rows only. Never rename existing rows.
-- ---------------------------------------------------------------------------
INSERT INTO public.exercises (
  name,
  category,
  exercise_type,
  equipment_type,
  warmup_enabled,
  min_weight,
  weight_increment
)
SELECT
  'Preacher Curl Machine',
  'Biceps',
  'isolation',
  'machine',
  false,
  src.min_weight,
  COALESCE(src.weight_increment, 5)
FROM (SELECT 1) AS seed
LEFT JOIN LATERAL (
  SELECT min_weight, weight_increment
  FROM public.exercises
  WHERE lower(name) IN ('ez-bar curl', 'cable curl', 'hammer curl')
  ORDER BY CASE lower(name)
    WHEN 'ez-bar curl' THEN 0
    WHEN 'cable curl' THEN 1
    ELSE 2
  END
  LIMIT 1
) src ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.exercises existing
  WHERE lower(regexp_replace(existing.name, '[^a-z0-9]+', ' ', 'g'))
      = 'preacher curl machine'
);

INSERT INTO public.exercises (
  name,
  category,
  exercise_type,
  equipment_type,
  warmup_enabled,
  min_weight,
  weight_increment
)
SELECT
  'Front Military Press',
  'Shoulders',
  'compound',
  'machine',
  true,
  src.min_weight,
  COALESCE(src.weight_increment, 5)
FROM (SELECT 1) AS seed
LEFT JOIN LATERAL (
  SELECT min_weight, weight_increment
  FROM public.exercises
  WHERE lower(name) IN ('overhead press', 'lu raise')
  ORDER BY CASE lower(name)
    WHEN 'overhead press' THEN 0
    ELSE 1
  END
  LIMIT 1
) src ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.exercises existing
  WHERE lower(regexp_replace(existing.name, '[^a-z0-9]+', ' ', 'g'))
      = 'front military press'
);

COMMIT;
