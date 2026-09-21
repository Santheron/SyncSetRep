-- Phase 2: Assign existing unowned rows to YOUR account
-- REVIEW ONLY. Do not run until:
--   1. Phase 1 SQL has been applied
--   2. You have signed up / signed in in the app
--   3. You have copied your user UUID from Supabase → Authentication → Users
--
-- After Phase 1, sign up / sign in in the app, then look up your UUID:
--   Supabase → Authentication → Users
-- or run:
--   SELECT id, email FROM auth.users ORDER BY created_at;
--
-- Replace EVERY occurrence of YOUR_USER_UUID below with that UUID.
-- Do not guess. Do not put an email address into workout rows.
--
-- This does NOT delete rows. It only sets user_id on currently unassigned rows.
-- After you confirm the counts look right, you can optionally make user_id
-- required (see the commented ALTER statements at the bottom).

-- Preview unassigned counts first:
SELECT 'workout_sessions' AS table_name,
       count(*) FILTER (WHERE user_id IS NULL) AS unassigned,
       count(*) AS total
FROM public.workout_sessions
UNION ALL
SELECT 'cardio_sessions',
       count(*) FILTER (WHERE user_id IS NULL),
       count(*)
FROM public.cardio_sessions
UNION ALL
SELECT 'body_metrics',
       count(*) FILTER (WHERE user_id IS NULL),
       count(*)
FROM public.body_metrics;

BEGIN;

UPDATE public.workout_sessions
SET user_id = 'YOUR_USER_UUID'::uuid
WHERE user_id IS NULL;

UPDATE public.cardio_sessions
SET user_id = 'YOUR_USER_UUID'::uuid
WHERE user_id IS NULL;

UPDATE public.body_metrics
SET user_id = 'YOUR_USER_UUID'::uuid
WHERE user_id IS NULL;

COMMIT;

-- Confirm assignment:
SELECT 'workout_sessions' AS table_name,
       count(*) FILTER (WHERE user_id = 'YOUR_USER_UUID'::uuid) AS assigned_to_you,
       count(*) FILTER (WHERE user_id IS NULL) AS still_unassigned
FROM public.workout_sessions
UNION ALL
SELECT 'cardio_sessions',
       count(*) FILTER (WHERE user_id = 'YOUR_USER_UUID'::uuid),
       count(*) FILTER (WHERE user_id IS NULL)
FROM public.cardio_sessions
UNION ALL
SELECT 'body_metrics',
       count(*) FILTER (WHERE user_id = 'YOUR_USER_UUID'::uuid),
       count(*) FILTER (WHERE user_id IS NULL)
FROM public.body_metrics;

-- Optional, only after the confirmation query shows 0 still_unassigned:
-- ALTER TABLE public.workout_sessions ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE public.cardio_sessions ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE public.body_metrics ALTER COLUMN user_id SET NOT NULL;
