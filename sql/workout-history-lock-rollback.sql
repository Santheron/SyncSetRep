-- NOT APPLIED.
-- Removes only the five restrictive policies added by
-- sql/workout-history-lock.sql. The original owner policies stay.
-- Does not insert, update, or delete rows. Does not change functions,
-- grants, foreign keys, or program policies.
-- Raises history_lock_absent when any of the five policies is missing,
-- and then rolls back so a partial set is not dropped.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_policy
    WHERE polname IN (
      'workout_sessions_delete_unfinished',
      'workout_sessions_update_unfinished',
      'workout_sets_delete_unfinished',
      'workout_sets_update_unfinished',
      'workout_sets_insert_unfinished'
    )
  ) <> 5 THEN
    RAISE EXCEPTION 'history_lock_absent';
  END IF;
END $$;

DROP POLICY workout_sessions_delete_unfinished ON public.workout_sessions;
DROP POLICY workout_sessions_update_unfinished ON public.workout_sessions;
DROP POLICY workout_sets_delete_unfinished ON public.workout_sets;
DROP POLICY workout_sets_update_unfinished ON public.workout_sets;
DROP POLICY workout_sets_insert_unfinished ON public.workout_sets;

SELECT 'history_lock_rolled_back' AS result;

COMMIT;
