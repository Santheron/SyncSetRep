-- NOT AN INSTALL STEP.
-- Restores the starter-calling body of public.handle_new_user from
-- sql/multi-user-phase1-schema.sql.
-- Does not insert, update, or delete existing rows.
-- Does not fire the signup trigger by itself.
-- Apply this only to undo sql/program-signup-no-starter.sql on a database
-- whose signup function already created a starter before that change.
-- Do not apply it to a database that is already profile-only.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, preferred_weight_unit)
  VALUES (
    NEW.id,
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'display_name', '')), ''),
    'lb'
  )
  ON CONFLICT (id) DO NOTHING;

  BEGIN
    PERFORM public.copy_starter_program(NEW.id, NULL);
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'copy_starter_program failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMIT;
