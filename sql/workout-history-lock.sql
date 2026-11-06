-- NOT APPLIED.
-- Stops an authenticated request from deleting or rewriting a finished
-- workout session or its sets. Unfinished sessions can still be discarded,
-- logged, and finished.
-- Does not change programs, program_days, or program_exercises.
-- A day that still has a session cannot be deleted: program_days and
-- workout_sessions do not cascade. routine_write_days already deletes a
-- day only when that day has no sessions, and it does not delete history.
-- Does not insert, update, or delete rows. Does not replace functions.
-- Does not grant or revoke table or function privileges.
-- The table owner and any role with BYPASSRLS, including service_role on
-- the hosted project, still bypass these policies.
-- Apply only after sql/workout-history-lock-preflight.sql shows the
-- existing owner policies, 32 finished sessions, and the known fingerprints.
-- A second run raises history_lock_already_present and rolls back.
-- Undo only with sql/workout-history-lock-rollback.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy
    WHERE polname IN (
      'workout_sessions_delete_unfinished',
      'workout_sessions_update_unfinished',
      'workout_sets_delete_unfinished',
      'workout_sets_update_unfinished',
      'workout_sets_insert_unfinished'
    )
  ) THEN
    RAISE EXCEPTION 'history_lock_already_present';
  END IF;

  IF NOT (
    SELECT relrowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.workout_sessions'::regclass
  ) OR NOT (
    SELECT relrowsecurity
    FROM pg_catalog.pg_class
    WHERE oid = 'public.workout_sets'::regclass
  ) THEN
    RAISE EXCEPTION 'history_lock_rls_disabled';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_policy
    WHERE polpermissive
      AND (
        (polrelid = 'public.workout_sessions'::regclass AND polname IN (
          'workout_sessions_delete_own',
          'workout_sessions_update_own'
        ))
        OR (polrelid = 'public.workout_sets'::regclass AND polname IN (
          'workout_sets_delete_own',
          'workout_sets_update_own',
          'workout_sets_insert_own'
        ))
      )
  ) <> 5 THEN
    RAISE EXCEPTION 'history_lock_policy_missing';
  END IF;
END $$;

-- The old row must be unfinished. WITH CHECK stays open so the existing
-- finish statement can set finished_at. The owner policy still requires
-- the new user_id to be auth.uid(). A finished row no longer matches,
-- so it cannot be cleared and then deleted.
CREATE POLICY workout_sessions_update_unfinished
  ON public.workout_sessions
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (finished_at IS NULL)
  WITH CHECK (true);

CREATE POLICY workout_sessions_delete_unfinished
  ON public.workout_sessions
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (finished_at IS NULL);

-- Direct set deletes, rewrites, and moves into a finished session stop.
-- Inserts into a finished session stop. Logging an unfinished session
-- still passes. record_tracked_set is unchanged and still raises
-- history_locked for a finished session.
CREATE POLICY workout_sets_delete_unfinished
  ON public.workout_sets
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions AS session_row
      WHERE session_row.id = workout_sets.workout_session_id
        AND session_row.finished_at IS NULL
    )
  );

CREATE POLICY workout_sets_update_unfinished
  ON public.workout_sets
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions AS session_row
      WHERE session_row.id = workout_sets.workout_session_id
        AND session_row.finished_at IS NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions AS session_row
      WHERE session_row.id = workout_sets.workout_session_id
        AND session_row.finished_at IS NULL
    )
  );

CREATE POLICY workout_sets_insert_unfinished
  ON public.workout_sets
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workout_sessions AS session_row
      WHERE session_row.id = workout_sets.workout_session_id
        AND session_row.finished_at IS NULL
    )
  );

SELECT 'history_lock_installed' AS result;

COMMIT;
