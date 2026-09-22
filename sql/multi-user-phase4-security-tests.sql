-- Multi-user Phase 4: RLS security tests (read/write probes only)
-- Run AFTER Phase 3, with Account A and Account B UUIDs.
--
-- The SQL editor runs as a superuser by default, which bypasses RLS.
-- These blocks switch to the authenticated role with a fake JWT claim
-- so policies actually apply. Roll back each block.
--
-- Replace:
--   ACCOUNT_A_UUID
--   ACCOUNT_B_UUID
--   ACCOUNT_B_SESSION_ID   (a workout_sessions.id owned by B)

-- A cannot read B private rows
BEGIN;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'ACCOUNT_A_UUID', 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

SELECT 'A workout_sessions visible' AS probe, count(*) FROM public.workout_sessions;
SELECT 'A programs visible' AS probe, count(*) FROM public.programs;
SELECT 'A cardio visible' AS probe, count(*) FROM public.cardio_sessions;
SELECT 'A body_metrics visible' AS probe, count(*) FROM public.body_metrics;
SELECT 'A profiles visible' AS probe, count(*) FROM public.profiles;
SELECT 'A exercises visible' AS probe, count(*) FROM public.exercises;

ROLLBACK;

-- A cannot insert a set into B's session
BEGIN;
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', 'ACCOUNT_A_UUID', 'role', 'authenticated')::text,
  true
);
SET LOCAL ROLE authenticated;

INSERT INTO public.workout_sets (
  workout_session_id, exercise_id, set_number, weight, reps, is_completed
) VALUES (
  'ACCOUNT_B_SESSION_ID', 1, 99, 0, 0, false
);

ROLLBACK;

-- Anonymous client must not see private training data
BEGIN;
SET LOCAL ROLE anon;

SELECT 'anon workout_sessions' AS probe, count(*) FROM public.workout_sessions;
SELECT 'anon programs' AS probe, count(*) FROM public.programs;
SELECT 'anon program_days' AS probe, count(*) FROM public.program_days;
SELECT 'anon program_exercises' AS probe, count(*) FROM public.program_exercises;
SELECT 'anon cardio' AS probe, count(*) FROM public.cardio_sessions;
SELECT 'anon body_metrics' AS probe, count(*) FROM public.body_metrics;
SELECT 'anon profiles' AS probe, count(*) FROM public.profiles;

ROLLBACK;
