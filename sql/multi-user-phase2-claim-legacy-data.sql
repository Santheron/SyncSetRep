-- Multi-user Phase 2: claim legacy SyncSetRep data
--
-- DO NOT RUN THIS until:
--   1. Phase 1 has been applied
--   2. You have created/signed into YOUR real SyncSetRep account
--   3. You have copied your auth.users UUID
--   4. You have run the PREVIEW queries below and the counts look right
--
-- How to get your UUID:
--   Supabase Dashboard → Authentication → Users → copy the User UID
--   or run:
--     SELECT id, email, created_at FROM auth.users ORDER BY created_at;
--
-- This does NOT:
--   - delete workout history, sets, cardio, body metrics, or original program days
--   - overwrite rows that already have a user_id / program_id
--   - invent a UUID
--
-- It only claims currently unowned legacy rows.

-- ===========================================================================
-- PREVIEW (run this first, by itself)
-- ===========================================================================
SELECT 'workout_sessions' AS table_name,
       count(*) AS total,
       count(*) FILTER (WHERE user_id IS NULL) AS will_claim
FROM public.workout_sessions
UNION ALL
SELECT 'workout_sets (via sessions, no user_id column)',
       count(*),
       (
         SELECT count(*)
         FROM public.workout_sets ws
         JOIN public.workout_sessions s ON s.id = ws.workout_session_id
         WHERE s.user_id IS NULL
       )
FROM public.workout_sets
UNION ALL
SELECT 'cardio_sessions',
       count(*),
       count(*) FILTER (WHERE user_id IS NULL)
FROM public.cardio_sessions
UNION ALL
SELECT 'body_metrics',
       count(*),
       count(*) FILTER (WHERE user_id IS NULL)
FROM public.body_metrics
UNION ALL
SELECT 'program_days (unowned originals)',
       count(*),
       count(*) FILTER (WHERE program_id IS NULL)
FROM public.program_days
UNION ALL
SELECT 'program_exercises on unowned days',
       count(*),
       (
         SELECT count(*)
         FROM public.program_exercises pe
         JOIN public.program_days pd ON pd.id = pe.program_day_id
         WHERE pd.program_id IS NULL
       )
FROM public.program_exercises;

SELECT id, program_day_id, user_id, started_at, finished_at
FROM public.workout_sessions
WHERE user_id IS NULL
ORDER BY id;

SELECT id, day_order, name, subtitle, program_id
FROM public.program_days
WHERE program_id IS NULL
ORDER BY day_order, id;

-- Expected from the 2026-09-21 audit (may grow if you train before claiming):
--   workout_sessions: 15 unowned (14 finished, 1 unfinished id 63)
--   workout_sets: 226 owned through those sessions
--   cardio_sessions: 2 unowned
--   body_metrics: run the preview; anon cannot read this table
--   program_days: 5 unowned (ids 1-5)
--   program_exercises: 27 on those days

-- ===========================================================================
-- CLAIM (run only after preview looks right)
-- Replace the UUID string below with YOUR real auth.users id.
-- Do not invent one. Do not paste an email address.
-- ===========================================================================

DO $$
DECLARE
  -- >>> PASTE YOUR REAL AUTH UUID BETWEEN THE QUOTES ON THE NEXT LINE. <<<
  -- Do not leave this all-zero placeholder. Do not invent a UUID.
  legacy_user_id constant uuid := '00000000-0000-0000-0000-000000000000';

  keep_program_id bigint;
  unused_copy_days integer := 0;
  unused_copy_exercises integer := 0;
  claimed_sessions integer := 0;
  claimed_cardio integer := 0;
  claimed_metrics integer := 0;
  claimed_days integer := 0;
BEGIN
  IF legacy_user_id = '00000000-0000-0000-0000-000000000000' THEN
    RAISE EXCEPTION
      'Replace 00000000-0000-0000-0000-000000000000 with your real auth.users UUID before claiming.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = legacy_user_id) THEN
    RAISE EXCEPTION
      'No auth.users row exists for %. Create/sign into your SyncSetRep account first.',
      legacy_user_id;
  END IF;

  INSERT INTO public.profiles (id, display_name, preferred_weight_unit)
  SELECT
    u.id,
    NULLIF(TRIM(COALESCE(u.raw_user_meta_data->>'display_name', split_part(u.email, '@', 1), '')), ''),
    'lb'
  FROM auth.users u
  WHERE u.id = legacy_user_id
  ON CONFLICT (id) DO NOTHING;

  -- If signup already copied a starter program, reuse that programs row
  -- after deleting unused copied days. Original days 1-5 stay intact.
  SELECT id
  INTO keep_program_id
  FROM public.programs
  WHERE user_id = legacy_user_id
  ORDER BY is_active DESC, created_at ASC, id ASC
  LIMIT 1;

  IF keep_program_id IS NULL THEN
    INSERT INTO public.programs (user_id, name, slug, is_active)
    VALUES (legacy_user_id, 'SyncSetRep', 'syncsetrep-legacy', true)
    RETURNING id INTO keep_program_id;
  END IF;

  UPDATE public.programs
  SET is_active = (id = keep_program_id),
      updated_at = now()
  WHERE user_id = legacy_user_id;

  SELECT count(*)
  INTO unused_copy_exercises
  FROM public.program_exercises pe
  JOIN public.program_days pd ON pd.id = pe.program_day_id
  WHERE pd.program_id IN (
          SELECT id FROM public.programs WHERE user_id = legacy_user_id
        )
    AND NOT EXISTS (
          SELECT 1
          FROM public.workout_sessions ws
          WHERE ws.program_day_id = pd.id
        );

  SELECT count(*)
  INTO unused_copy_days
  FROM public.program_days pd
  WHERE pd.program_id IN (
          SELECT id FROM public.programs WHERE user_id = legacy_user_id
        )
    AND NOT EXISTS (
          SELECT 1
          FROM public.workout_sessions ws
          WHERE ws.program_day_id = pd.id
        );

  DELETE FROM public.program_exercises pe
  USING public.program_days pd
  WHERE pe.program_day_id = pd.id
    AND pd.program_id IN (
          SELECT id FROM public.programs WHERE user_id = legacy_user_id
        )
    AND NOT EXISTS (
          SELECT 1
          FROM public.workout_sessions ws
          WHERE ws.program_day_id = pd.id
        );

  DELETE FROM public.program_days pd
  WHERE pd.program_id IN (
          SELECT id FROM public.programs WHERE user_id = legacy_user_id
        )
    AND NOT EXISTS (
          SELECT 1
          FROM public.workout_sessions ws
          WHERE ws.program_day_id = pd.id
        );

  UPDATE public.program_days
  SET program_id = keep_program_id
  WHERE program_id IS NULL;

  GET DIAGNOSTICS claimed_days = ROW_COUNT;

  UPDATE public.workout_sessions
  SET user_id = legacy_user_id
  WHERE user_id IS NULL;

  GET DIAGNOSTICS claimed_sessions = ROW_COUNT;

  UPDATE public.cardio_sessions
  SET user_id = legacy_user_id
  WHERE user_id IS NULL;

  GET DIAGNOSTICS claimed_cardio = ROW_COUNT;

  UPDATE public.body_metrics
  SET user_id = legacy_user_id
  WHERE user_id IS NULL;

  GET DIAGNOSTICS claimed_metrics = ROW_COUNT;

  DELETE FROM public.programs p
  WHERE p.user_id = legacy_user_id
    AND p.id <> keep_program_id
    AND NOT EXISTS (
      SELECT 1 FROM public.program_days d WHERE d.program_id = p.id
    );

  RAISE NOTICE
    'Claim complete for %. keep_program_id=%. unused_starter_days_removed=%. unused_starter_exercises_removed=%. claimed_days=%. claimed_sessions=%. claimed_cardio=%. claimed_metrics=%.',
    legacy_user_id,
    keep_program_id,
    unused_copy_days,
    unused_copy_exercises,
    claimed_days,
    claimed_sessions,
    claimed_cardio,
    claimed_metrics;
END $$;

-- ===========================================================================
-- CONFIRM (run after the claim block)
-- Replace the UUID here too.
-- ===========================================================================
-- SELECT 'workout_sessions' AS table_name,
--        count(*) FILTER (WHERE user_id = 'PASTE_YOUR_AUTH_USER_UUID_HERE'::uuid) AS owned_by_you,
--        count(*) FILTER (WHERE user_id IS NULL) AS still_unowned
-- FROM public.workout_sessions
-- UNION ALL
-- SELECT 'cardio_sessions',
--        count(*) FILTER (WHERE user_id = 'PASTE_YOUR_AUTH_USER_UUID_HERE'::uuid),
--        count(*) FILTER (WHERE user_id IS NULL)
-- FROM public.cardio_sessions
-- UNION ALL
-- SELECT 'body_metrics',
--        count(*) FILTER (WHERE user_id = 'PASTE_YOUR_AUTH_USER_UUID_HERE'::uuid),
--        count(*) FILTER (WHERE user_id IS NULL)
-- FROM public.body_metrics
-- UNION ALL
-- SELECT 'program_days',
--        count(*) FILTER (
--          WHERE program_id IN (
--            SELECT id FROM public.programs
--            WHERE user_id = 'PASTE_YOUR_AUTH_USER_UUID_HERE'::uuid
--          )
--        ),
--        count(*) FILTER (WHERE program_id IS NULL)
-- FROM public.program_days;
