-- NOT APPLIED.
-- Replaces public.handle_new_user so a newly inserted auth.users row receives
-- a profile and does not receive a program.
-- Does not insert, update, or delete existing profiles, programs, days,
-- exercises, sessions, or sets.
-- Does not drop public.copy_starter_program or public.copy_starter_program_for_current_user.
-- Does not create, drop, or replace on_auth_user_created. The existing
-- AFTER INSERT trigger keeps calling public.handle_new_user.
-- Existing accounts stay as they are because the trigger runs only after insert.
-- If production already uses the profile-only function, applying this file
-- leaves that behavior in place.

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

  RETURN NEW;
END;
$$;

COMMIT;
