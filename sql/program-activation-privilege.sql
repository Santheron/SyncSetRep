-- NOT APPLIED.
-- Restricts who can change public.programs.is_active.
-- Apply this only after all of the following are true:
--   sql/program-signup-no-starter.sql is applied,
--   sql/program-starter-disable.sql is applied,
--   sql/program-activation.sql is applied by the owner of public.programs.
-- Do not apply this while public.handle_new_user or public.copy_starter_program
-- still inserts or updates programs.is_active. Those functions run as their
-- owner, and this trigger allows the table owner to write is_active.
-- This file does not insert, update, or delete existing rows.
-- Authenticated users keep INSERT and DELETE. RLS policies stay as they are.
-- A policy cannot limit one column, so is_active is limited here instead.
-- Authenticated users keep UPDATE on name, slug, and updated_at.
-- They lose table-level UPDATE, which also removes UPDATE on is_active,
-- user_id, id, and created_at.
-- A direct insert that stores is_active true, including an insert that omits
-- the column and therefore uses the default, raises
-- program_activation_rpc_required unless the current user owns the table.
-- A direct change of user_id raises program_owner_change_forbidden for every
-- role, including the table owner.
-- Setting a custom GUC does not authorize either write.
-- public.save_imported_program stays SECURITY INVOKER. It inserts is_active
-- false and locks the caller's active row. UPDATE on name is enough for that
-- lock. public.save_owned_program and public.activate_owned_program stay
-- SECURITY DEFINER and run as the table owner, so this trigger allows their
-- is_active writes. Both still filter every row with auth.uid().

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

REVOKE UPDATE ON TABLE public.programs FROM authenticated;
GRANT UPDATE (name, slug, updated_at) ON TABLE public.programs TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_program_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $enforce_activation$
DECLARE
  table_owner text := (
    SELECT pg_catalog.pg_get_userbyid(relowner)::text
    FROM pg_catalog.pg_class
    WHERE oid = 'public.programs'::pg_catalog.regclass
  );
  owner_write boolean := CURRENT_USER::text = table_owner;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'program_owner_change_forbidden';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.is_active AND NOT owner_write THEN
    RAISE EXCEPTION 'program_activation_rpc_required';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.is_active IS DISTINCT FROM OLD.is_active
     AND NOT owner_write THEN
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
