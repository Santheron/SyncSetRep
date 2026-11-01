-- NOT AN INSTALL STEP.
-- Restores starter assignment from sql/multi-user-phase1-schema.sql.
-- Applying this file makes public.copy_starter_program able to insert an
-- active program and grants EXECUTE on the current-user wrapper again.
-- It does not itself insert, update, or delete existing rows.
-- It does not fire the signup trigger.
-- Do not apply it on a database that should let new accounts choose a
-- program. Do not apply it while the activation privilege trigger is
-- installed: the restored function runs as its owner and would pass that
-- trigger.

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
SET search_path = public
AS $$
DECLARE
  template_row public.program_templates%ROWTYPE;
  existing_id bigint;
  new_program_id bigint;
  day_rec public.program_template_days%ROWTYPE;
  new_day_id bigint;
BEGIN
  IF target_user_id IS NULL THEN
    RAISE EXCEPTION 'target_user_id is required';
  END IF;

  SELECT id
  INTO existing_id
  FROM public.programs
  WHERE user_id = target_user_id
    AND is_active
  ORDER BY id
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    RETURN existing_id;
  END IF;

  SELECT id
  INTO existing_id
  FROM public.programs
  WHERE user_id = target_user_id
  ORDER BY created_at DESC, id DESC
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    UPDATE public.programs
    SET is_active = (id = existing_id),
        updated_at = now()
    WHERE user_id = target_user_id;
    RETURN existing_id;
  END IF;

  IF template_slug IS NOT NULL THEN
    SELECT *
    INTO template_row
    FROM public.program_templates
    WHERE slug = template_slug
    LIMIT 1;
  ELSE
    SELECT *
    INTO template_row
    FROM public.program_templates
    WHERE is_default
    ORDER BY id
    LIMIT 1;
  END IF;

  IF template_row.id IS NULL THEN
    RAISE EXCEPTION 'No starter program template found';
  END IF;

  INSERT INTO public.programs (user_id, name, slug, is_active)
  VALUES (target_user_id, template_row.name, template_row.slug, true)
  RETURNING id INTO new_program_id;

  FOR day_rec IN
    SELECT *
    FROM public.program_template_days
    WHERE template_id = template_row.id
    ORDER BY day_order, id
  LOOP
    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (new_program_id, day_rec.name, day_rec.subtitle, day_rec.day_order)
    RETURNING id INTO new_day_id;

    INSERT INTO public.program_exercises (
      program_day_id,
      exercise_id,
      exercise_order,
      target_sets,
      min_reps,
      max_reps,
      notes
    )
    SELECT
      new_day_id,
      te.exercise_id,
      te.exercise_order,
      te.target_sets,
      te.min_reps,
      te.max_reps,
      te.notes
    FROM public.program_template_exercises te
    WHERE te.template_day_id = day_rec.id
    ORDER BY te.exercise_order, te.id;
  END LOOP;

  RETURN new_program_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.copy_starter_program_for_current_user()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN public.copy_starter_program(auth.uid(), NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.copy_starter_program(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.copy_starter_program_for_current_user() TO authenticated;

COMMIT;
