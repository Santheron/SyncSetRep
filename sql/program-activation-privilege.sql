-- NOT APPLIED.
-- Do not apply this while public.handle_new_user or public.copy_starter_program
-- still writes programs.is_active. Those paths do not set
-- syncsetrep.program_activation.
-- Apply it only after new accounts no longer receive a starter and after
-- public.save_owned_program and public.activate_owned_program are installed.
-- This file does not insert, update, or delete existing rows.
-- Authenticated users keep UPDATE on public.programs so a name change still
-- works. A change to is_active, or an insert that stores is_active true,
-- raises program_activation_rpc_required unless the current transaction set
-- syncsetrep.program_activation to on.
-- The reviewed activation functions set that value for their own transaction.
-- A role that can run arbitrary SQL can set the same value. The app client
-- cannot, because a PostgREST table update does not set it.
-- The programs.one_active partial unique index remains in place.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.enforce_program_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $enforce_activation$
DECLARE
  activation text := pg_catalog.current_setting('syncsetrep.program_activation', true);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_active AND activation IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'program_activation_rpc_required';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND activation IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'program_activation_rpc_required';
  END IF;

  RETURN NEW;
END;
$enforce_activation$;

REVOKE ALL ON FUNCTION public.enforce_program_activation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enforce_program_activation() TO authenticated;

DROP TRIGGER IF EXISTS programs_activation_rpc ON public.programs;

CREATE TRIGGER programs_activation_rpc
  BEFORE INSERT OR UPDATE ON public.programs
  FOR EACH ROW
  EXECUTE PROCEDURE public.enforce_program_activation();

COMMIT;
