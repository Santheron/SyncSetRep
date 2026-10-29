-- NOT APPLIED.
-- Adds two invoker functions for an explicit current-program choice.
-- Does not replace public.save_imported_program.
-- Does not copy a starter template.
-- Does not read or write logged workout history.
-- save_owned_program inserts one new program. It is inactive unless
-- p_make_current is true and the caller currently has no active program.
-- activate_owned_program changes only is_active and updated_at on the
-- caller's program rows, in an order the one-active index accepts.
-- Both functions lock the caller's programs and take the same transaction
-- advisory lock. The partial unique index remains the database guarantee.
-- Requires programs.updated_at and UNIQUE NULLS NOT DISTINCT
-- (program_id, day_order) on program_days. This file does not create them.
-- Payload checks match the verified save_imported_program limits.
-- lock_timeout and statement_timeout below cover this install transaction.
-- Each function also sets those limits for its own transaction.
-- Each function sets syncsetrep.program_activation for that same transaction.
-- A separate unapplied privilege file can require that setting before
-- is_active changes. This file does not install that restriction.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION public.save_owned_program(
  p_program jsonb,
  p_make_current boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $save_owned$
DECLARE
  uid uuid := auth.uid();
  make_current boolean := COALESCE(p_make_current, false);
  new_program_id bigint;
  new_day_id bigint;
  program_name text;
  day_item jsonb;
  exercise_item jsonb;
  day_index integer := 0;
  exercise_index integer;
  day_count integer;
  exercise_count integer;
  total_exercises integer := 0;
  day_name text;
  day_subtitle text;
  exercise_id bigint;
  exercise_text text;
  sets_text text;
  min_text text;
  max_text text;
  target_sets integer;
  min_reps integer;
  max_reps integer;
  notes text;
  seen_ids bigint[];
  payload_key text;
  normalized_days jsonb := '[]'::jsonb;
  day_exercises jsonb;
  normalized_exercise jsonb;
  constraint_name text;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '30s', true);
  PERFORM pg_catalog.set_config('syncsetrep.program_activation', 'on', true);

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF pg_catalog.jsonb_typeof(p_program) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_import: program';
  END IF;

  FOR payload_key IN
    SELECT pg_catalog.jsonb_object_keys(p_program)
  LOOP
    IF payload_key NOT IN ('name', 'days') THEN
      RAISE EXCEPTION 'invalid_import: program_field';
    END IF;
  END LOOP;

  program_name := pg_catalog.btrim(p_program->>'name');
  IF program_name IS NULL
     OR pg_catalog.char_length(program_name) < 1
     OR pg_catalog.char_length(program_name) > 80 THEN
    RAISE EXCEPTION 'invalid_import: program_name';
  END IF;

  IF pg_catalog.jsonb_typeof(p_program->'days') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_import: days';
  END IF;

  day_count := pg_catalog.jsonb_array_length(p_program->'days');
  IF day_count < 1 OR day_count > 7 THEN
    RAISE EXCEPTION 'invalid_import: day_count';
  END IF;

  FOR day_item IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_program->'days')
  LOOP
    IF pg_catalog.jsonb_typeof(day_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_import: day';
    END IF;

    FOR payload_key IN
      SELECT pg_catalog.jsonb_object_keys(day_item)
    LOOP
      IF payload_key NOT IN ('name', 'subtitle', 'exercises') THEN
        RAISE EXCEPTION 'invalid_import: day_field';
      END IF;
    END LOOP;

    day_name := pg_catalog.btrim(day_item->>'name');
    IF day_name IS NULL OR pg_catalog.char_length(day_name) < 1 OR pg_catalog.char_length(day_name) > 60 THEN
      RAISE EXCEPTION 'invalid_import: day_name';
    END IF;

    day_subtitle := NULL;
    IF day_item ? 'subtitle' AND pg_catalog.jsonb_typeof(day_item->'subtitle') = 'string' THEN
      day_subtitle := NULLIF(pg_catalog.btrim(day_item->>'subtitle'), '');
    ELSIF day_item ? 'subtitle' AND pg_catalog.jsonb_typeof(day_item->'subtitle') IS DISTINCT FROM 'null' THEN
      RAISE EXCEPTION 'invalid_import: subtitle';
    END IF;
    IF day_subtitle IS NOT NULL AND pg_catalog.char_length(day_subtitle) > 2000 THEN
      RAISE EXCEPTION 'invalid_import: subtitle';
    END IF;

    IF pg_catalog.jsonb_typeof(day_item->'exercises') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_import: exercises';
    END IF;

    exercise_count := pg_catalog.jsonb_array_length(day_item->'exercises');
    IF exercise_count > 12 THEN
      RAISE EXCEPTION 'invalid_import: exercises_per_day';
    END IF;
    total_exercises := total_exercises + exercise_count;

    seen_ids := ARRAY[]::bigint[];
    day_exercises := '[]'::jsonb;
    FOR exercise_item IN
      SELECT value FROM pg_catalog.jsonb_array_elements(day_item->'exercises')
    LOOP
      IF pg_catalog.jsonb_typeof(exercise_item) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'invalid_import: exercise';
      END IF;

      FOR payload_key IN
        SELECT pg_catalog.jsonb_object_keys(exercise_item)
      LOOP
        IF payload_key NOT IN ('exercise_id', 'target_sets', 'min_reps', 'max_reps', 'notes') THEN
          RAISE EXCEPTION 'invalid_import: exercise_field';
        END IF;
      END LOOP;

      exercise_text := exercise_item->>'exercise_id';
      sets_text := exercise_item->>'target_sets';
      min_text := exercise_item->>'min_reps';
      max_text := exercise_item->>'max_reps';

      IF exercise_text IS NULL
         OR exercise_text !~ '^[1-9][0-9]*$'
         OR pg_catalog.char_length(exercise_text) > 19 THEN
        RAISE EXCEPTION 'invalid_import: exercise_id';
      END IF;
      IF pg_catalog.char_length(exercise_text) = 19 AND exercise_text > '9223372036854775807' THEN
        RAISE EXCEPTION 'invalid_import: exercise_id';
      END IF;
      IF sets_text IS NULL OR sets_text !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'invalid_import: sets';
      END IF;
      sets_text := pg_catalog.ltrim(sets_text, '0');
      IF sets_text = '' THEN
        sets_text := '0';
      END IF;
      IF pg_catalog.char_length(sets_text) > 2 THEN
        RAISE EXCEPTION 'invalid_import: sets';
      END IF;
      IF min_text IS NULL OR min_text !~ '^[0-9]+$' OR max_text IS NULL OR max_text !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'invalid_import: reps';
      END IF;
      min_text := pg_catalog.ltrim(min_text, '0');
      max_text := pg_catalog.ltrim(max_text, '0');
      IF min_text = '' THEN
        min_text := '0';
      END IF;
      IF max_text = '' THEN
        max_text := '0';
      END IF;
      IF pg_catalog.char_length(min_text) > 3 OR pg_catalog.char_length(max_text) > 3 THEN
        RAISE EXCEPTION 'invalid_import: reps';
      END IF;

      exercise_id := exercise_text::bigint;
      target_sets := sets_text::integer;
      min_reps := min_text::integer;
      max_reps := max_text::integer;

      IF target_sets < 1 OR target_sets > 12 THEN
        RAISE EXCEPTION 'invalid_import: sets';
      END IF;
      IF min_reps < 1 OR min_reps > 100 OR max_reps < 1 OR max_reps > 100 THEN
        RAISE EXCEPTION 'invalid_import: reps';
      END IF;
      IF min_reps > max_reps THEN
        RAISE EXCEPTION 'invalid_import: inverted_reps';
      END IF;
      IF exercise_id = ANY (seen_ids) THEN
        RAISE EXCEPTION 'invalid_import: duplicate_exercise';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.exercises
        WHERE id = exercise_id
      ) THEN
        RAISE EXCEPTION 'invalid_import: unknown_exercise';
      END IF;

      IF exercise_item ? 'notes'
         AND pg_catalog.jsonb_typeof(exercise_item->'notes') IS DISTINCT FROM 'string'
         AND pg_catalog.jsonb_typeof(exercise_item->'notes') IS DISTINCT FROM 'null' THEN
        RAISE EXCEPTION 'invalid_import: notes';
      END IF;
      notes := NULLIF(pg_catalog.btrim(exercise_item->>'notes'), '');
      IF notes IS NOT NULL AND pg_catalog.char_length(notes) > 280 THEN
        RAISE EXCEPTION 'invalid_import: notes';
      END IF;

      seen_ids := pg_catalog.array_append(seen_ids, exercise_id);
      normalized_exercise := pg_catalog.jsonb_build_object(
        'exercise_id', exercise_id,
        'target_sets', target_sets,
        'min_reps', min_reps,
        'max_reps', max_reps,
        'notes', notes
      );
      day_exercises := day_exercises || pg_catalog.jsonb_build_array(normalized_exercise);
    END LOOP;

    normalized_days := normalized_days || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'name', day_name,
        'subtitle', day_subtitle,
        'exercises', day_exercises
      )
    );
  END LOOP;

  IF total_exercises > 40 THEN
    RAISE EXCEPTION 'invalid_import: exercise_count';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('program-active:' || uid::text, 0)
  );

  PERFORM 1
  FROM public.programs
  WHERE user_id = uid
  ORDER BY id
  FOR UPDATE;

  IF make_current AND EXISTS (
    SELECT 1
    FROM public.programs
    WHERE user_id = uid
      AND is_active
  ) THEN
    RAISE EXCEPTION 'active_program_exists';
  END IF;

  BEGIN
    INSERT INTO public.programs (user_id, name, slug, is_active)
    VALUES (uid, program_name, NULL, make_current)
    RETURNING id INTO new_program_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
      IF constraint_name = 'programs_one_active_per_user_uidx' THEN
        RAISE EXCEPTION 'active_program_exists';
      END IF;
      RAISE;
  END;

  day_index := 0;
  FOR day_item IN
    SELECT value FROM pg_catalog.jsonb_array_elements(normalized_days)
  LOOP
    day_index := day_index + 1;
    day_name := day_item->>'name';
    day_subtitle := day_item->>'subtitle';

    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (new_program_id, day_name, day_subtitle, day_index)
    RETURNING id INTO new_day_id;

    exercise_index := 0;
    FOR exercise_item IN
      SELECT value FROM pg_catalog.jsonb_array_elements(day_item->'exercises')
    LOOP
      exercise_index := exercise_index + 1;
      exercise_id := (exercise_item->>'exercise_id')::bigint;
      target_sets := (exercise_item->>'target_sets')::integer;
      min_reps := (exercise_item->>'min_reps')::integer;
      max_reps := (exercise_item->>'max_reps')::integer;
      notes := NULLIF(exercise_item->>'notes', '');

      INSERT INTO public.program_exercises (
        program_day_id,
        exercise_id,
        exercise_order,
        target_sets,
        min_reps,
        max_reps,
        notes
      )
      VALUES (
        new_day_id,
        exercise_id,
        exercise_index,
        target_sets,
        min_reps,
        max_reps,
        notes
      );
    END LOOP;
  END LOOP;

  RETURN new_program_id;
END;
$save_owned$;

CREATE OR REPLACE FUNCTION public.activate_owned_program(p_program_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $activate_owned$
DECLARE
  uid uuid := auth.uid();
  target_id bigint;
  target_active boolean;
  other_active integer;
  active_count integer;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '30s', true);
  PERFORM pg_catalog.set_config('syncsetrep.program_activation', 'on', true);

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_program_id IS NULL OR p_program_id < 1 THEN
    RAISE EXCEPTION 'program_not_found';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('program-active:' || uid::text, 0)
  );

  PERFORM 1
  FROM public.programs
  WHERE user_id = uid
  ORDER BY id
  FOR UPDATE;

  SELECT id, is_active
  INTO target_id, target_active
  FROM public.programs
  WHERE id = p_program_id
    AND user_id = uid;

  IF target_id IS NULL THEN
    RAISE EXCEPTION 'program_not_found';
  END IF;

  SELECT count(*)::integer
  INTO other_active
  FROM public.programs
  WHERE user_id = uid
    AND is_active
    AND id <> target_id;

  IF target_active AND other_active = 0 THEN
    RETURN target_id;
  END IF;

  UPDATE public.programs
  SET is_active = false,
      updated_at = pg_catalog.now()
  WHERE user_id = uid
    AND id <> target_id
    AND is_active;

  UPDATE public.programs
  SET is_active = true,
      updated_at = pg_catalog.now()
  WHERE user_id = uid
    AND id = target_id;

  SELECT count(*)::integer
  INTO active_count
  FROM public.programs
  WHERE user_id = uid
    AND is_active;

  IF active_count <> 1 THEN
    RAISE EXCEPTION 'active_program_count';
  END IF;

  RETURN target_id;
END;
$activate_owned$;

REVOKE ALL ON FUNCTION public.save_owned_program(jsonb, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.activate_owned_program(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_owned_program(jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_owned_program(bigint) TO authenticated;

COMMIT;
