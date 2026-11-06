-- NOT APPLIED.
-- Revokes the direct authenticated TRUNCATE grant on the public tables
-- that have it. TRUNCATE ignores row level security, so the history-lock
-- policies do not stop it. The app discards unfinished workouts with
-- DELETE, so DELETE, INSERT, UPDATE, and SELECT stay in place.
-- anon has no TRUNCATE grant on these tables and does not receive one.
-- service_role and the table owner keep TRUNCATE. postgres default
-- privileges in public stop granting TRUNCATE to anon and authenticated
-- on tables created later. Existing default privileges owned by
-- supabase_admin are left unchanged.
-- Does not insert, update, delete, or truncate rows. Does not change
-- policies, functions, or the history-lock migration.
-- A second run raises history_truncate_already_revoked and rolls back.
-- Undo only with sql/workout-history-truncate-revoke-rollback.sql.

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
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
    WHERE member.rolname = 'authenticated'
  ) THEN
    RAISE EXCEPTION 'history_truncate_inherited';
  END IF;

  FOREACH target IN ARRAY targets LOOP
    IF NOT has_table_privilege('authenticated', target, 'TRUNCATE') THEN
      RAISE EXCEPTION 'history_truncate_already_revoked';
    END IF;
    IF has_table_privilege('anon', target, 'TRUNCATE') THEN
      RAISE EXCEPTION 'history_truncate_anon_present';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
      WHERE relation.oid = target
        AND acl.privilege_type = 'TRUNCATE'
        AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION 'history_truncate_public_grant';
    END IF;
  END LOOP;
END $$;

REVOKE TRUNCATE ON TABLE
  public.body_metrics,
  public.cardio_sessions,
  public.exercises,
  public.profiles,
  public.program_days,
  public.program_exercises,
  public.programs,
  public.workout_sessions,
  public.workout_sets
FROM authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM authenticated, anon;

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
      RAISE EXCEPTION 'history_truncate_still_effective';
    END IF;
    IF NOT has_table_privilege('authenticated', target, 'SELECT')
      OR NOT has_table_privilege('authenticated', target, 'INSERT')
      OR NOT has_table_privilege('authenticated', target, 'DELETE') THEN
      RAISE EXCEPTION 'history_truncate_removed_dml';
    END IF;
    -- programs keeps table UPDATE revoked. Column UPDATE for name, slug,
    -- and updated_at is unchanged because this file does not touch it.
    IF target = 'public.programs'::regclass THEN
      IF has_table_privilege('authenticated', target, 'UPDATE') THEN
        RAISE EXCEPTION 'history_truncate_programs_update_changed';
      END IF;
    ELSIF NOT has_table_privilege('authenticated', target, 'UPDATE') THEN
      RAISE EXCEPTION 'history_truncate_removed_dml';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl AS defaults
    CROSS JOIN LATERAL pg_catalog.aclexplode(defaults.defaclacl) AS acl
    LEFT JOIN pg_catalog.pg_roles AS grantee ON grantee.oid = acl.grantee
    WHERE defaults.defaclrole = 'postgres'::regrole
      AND defaults.defaclnamespace = 'public'::regnamespace
      AND defaults.defaclobjtype = 'r'
      AND acl.privilege_type = 'TRUNCATE'
      AND (
        acl.grantee = 0
        OR grantee.rolname IN ('anon', 'authenticated')
      )
  ) THEN
    RAISE EXCEPTION 'history_truncate_default_remains';
  END IF;
END $$;

SELECT 'history_truncate_revoked' AS result;

COMMIT;
