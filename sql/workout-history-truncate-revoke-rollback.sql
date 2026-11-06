-- NOT APPLIED.
-- Restores the authenticated TRUNCATE grant removed by
-- sql/workout-history-truncate-revoke.sql, and restores the postgres
-- default so later public tables again grant TRUNCATE to anon and
-- authenticated. Does not grant TRUNCATE to anon on the existing tables.
-- Does not insert, update, delete, or truncate rows. Does not change
-- policies or functions.
-- Raises history_truncate_revoke_absent when authenticated already has
-- TRUNCATE on any of the nine tables, and then rolls back.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  target regclass;
  targets regclass[] := ARRAY[
    'public.body_metrics',
    'public.cardio_sessions',
    'public.exercises',
    'public.profiles',
    'public.program_days',
    'public.program_exercises',
    'public.programs',
    'public.workout_sessions',
    'public.workout_sets'
  ];
BEGIN
  FOREACH target IN ARRAY targets LOOP
    IF has_table_privilege('authenticated', target, 'TRUNCATE') THEN
      RAISE EXCEPTION 'history_truncate_revoke_absent';
    END IF;
    IF has_table_privilege('anon', target, 'TRUNCATE') THEN
      RAISE EXCEPTION 'history_truncate_anon_present';
    END IF;
  END LOOP;
END $$;

GRANT TRUNCATE ON TABLE
  public.body_metrics,
  public.cardio_sessions,
  public.exercises,
  public.profiles,
  public.program_days,
  public.program_exercises,
  public.programs,
  public.workout_sessions,
  public.workout_sets
TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT TRUNCATE ON TABLES TO anon, authenticated;

DO $$
DECLARE
  target regclass;
  targets regclass[] := ARRAY[
    'public.body_metrics',
    'public.cardio_sessions',
    'public.exercises',
    'public.profiles',
    'public.program_days',
    'public.program_exercises',
    'public.programs',
    'public.workout_sessions',
    'public.workout_sets'
  ];
BEGIN
  FOREACH target IN ARRAY targets LOOP
    IF NOT has_table_privilege('authenticated', target, 'TRUNCATE') THEN
      RAISE EXCEPTION 'history_truncate_not_restored';
    END IF;
    IF has_table_privilege('anon', target, 'TRUNCATE') THEN
      RAISE EXCEPTION 'history_truncate_anon_present';
    END IF;
  END LOOP;
END $$;

SELECT 'history_truncate_restored' AS result;

COMMIT;
