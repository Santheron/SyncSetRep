-- NOT APPLIED.
-- Stops automatic starter assignment without dropping the functions.
-- Apply this after sql/program-signup-no-starter.sql and before
-- sql/program-activation.sql.
-- A leftover public.handle_new_user call still resolves, raises
-- starter_program_disabled, and writes no program. The existing signup
-- exception handler turns that into a warning.
-- Does not insert, update, or delete existing rows.
-- Does not drop on_auth_user_created.
-- Requires the anon and authenticated roles.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.copy_starter_program(
  target_user_id uuid,
  template_slug text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $disable_starter$
BEGIN
  RAISE EXCEPTION 'starter_program_disabled';
END;
$disable_starter$;

CREATE OR REPLACE FUNCTION public.copy_starter_program_for_current_user()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $disable_starter_current$
BEGIN
  RAISE EXCEPTION 'starter_program_disabled';
END;
$disable_starter_current$;

REVOKE ALL ON FUNCTION public.copy_starter_program(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.copy_starter_program_for_current_user() FROM PUBLIC, anon, authenticated;

COMMIT;
