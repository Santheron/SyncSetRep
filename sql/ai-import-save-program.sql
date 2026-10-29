-- NOT APPLIED.
-- Saves one inactive program, its days, and its exercises in the caller's transaction.
-- SECURITY INVOKER: owner policies and table grants stay in force.
-- The caller user comes from auth.uid(). A user id in the payload is rejected.
-- The active program row is locked and is not changed.
-- Any failed check or insert raises, and the statement rolls back every row from this call.
-- Does not read or write history. Does not write rest_seconds.
-- Requires sql/ai-import-day-order.sql first, so two programs may both use day_order 1.

BEGIN;

CREATE OR REPLACE FUNCTION public.save_imported_program(p_program jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $save$
DECLARE
  uid uuid := auth.uid();
  active_id bigint;
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
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF jsonb_typeof(p_program) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_import: program';
  END IF;

  FOR payload_key IN
    SELECT jsonb_object_keys(p_program)
  LOOP
    IF payload_key NOT IN ('name', 'days') THEN
      RAISE EXCEPTION 'invalid_import: program_field';
    END IF;
  END LOOP;

  SELECT id
  INTO active_id
  FROM public.programs
  WHERE user_id = uid
    AND is_active
  ORDER BY id
  LIMIT 1
  FOR UPDATE;

  IF active_id IS NULL THEN
    RAISE EXCEPTION 'active_program_required';
  END IF;

  program_name := btrim(p_program->>'name');
  IF program_name IS NULL
     OR char_length(program_name) < 1
     OR char_length(program_name) > 80 THEN
    RAISE EXCEPTION 'invalid_import: program_name';
  END IF;

  IF jsonb_typeof(p_program->'days') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_import: days';
  END IF;

  day_count := jsonb_array_length(p_program->'days');
  IF day_count < 1 OR day_count > 7 THEN
    RAISE EXCEPTION 'invalid_import: day_count';
  END IF;

  FOR day_item IN
    SELECT value FROM jsonb_array_elements(p_program->'days')
  LOOP
    IF jsonb_typeof(day_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_import: day';
    END IF;

    FOR payload_key IN
      SELECT jsonb_object_keys(day_item)
    LOOP
      IF payload_key NOT IN ('name', 'subtitle', 'exercises') THEN
        RAISE EXCEPTION 'invalid_import: day_field';
      END IF;
    END LOOP;

    day_name := btrim(day_item->>'name');
    IF day_name IS NULL OR char_length(day_name) < 1 OR char_length(day_name) > 60 THEN
      RAISE EXCEPTION 'invalid_import: day_name';
    END IF;

    IF day_item ? 'subtitle'
       AND jsonb_typeof(day_item->'subtitle') IS DISTINCT FROM 'string'
       AND jsonb_typeof(day_item->'subtitle') IS DISTINCT FROM 'null' THEN
      RAISE EXCEPTION 'invalid_import: subtitle';
    END IF;

    IF jsonb_typeof(day_item->'exercises') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'invalid_import: exercises';
    END IF;

    exercise_count := jsonb_array_length(day_item->'exercises');
    IF exercise_count > 12 THEN
      RAISE EXCEPTION 'invalid_import: exercises_per_day';
    END IF;
    total_exercises := total_exercises + exercise_count;

    seen_ids := ARRAY[]::bigint[];
    FOR exercise_item IN
      SELECT value FROM jsonb_array_elements(day_item->'exercises')
    LOOP
      IF jsonb_typeof(exercise_item) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'invalid_import: exercise';
      END IF;

      FOR payload_key IN
        SELECT jsonb_object_keys(exercise_item)
      LOOP
        IF payload_key NOT IN ('exercise_id', 'target_sets', 'min_reps', 'max_reps', 'notes') THEN
          RAISE EXCEPTION 'invalid_import: exercise_field';
        END IF;
      END LOOP;

      exercise_text := exercise_item->>'exercise_id';
      sets_text := exercise_item->>'target_sets';
      min_text := exercise_item->>'min_reps';
      max_text := exercise_item->>'max_reps';

      IF exercise_text IS NULL OR exercise_text !~ '^[1-9][0-9]*$' THEN
        RAISE EXCEPTION 'invalid_import: exercise_id';
      END IF;
      IF sets_text IS NULL OR sets_text !~ '^[0-9]+$' THEN
        RAISE EXCEPTION 'invalid_import: sets';
      END IF;
      IF min_text IS NULL OR min_text !~ '^[0-9]+$' OR max_text IS NULL OR max_text !~ '^[0-9]+$' THEN
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
         AND jsonb_typeof(exercise_item->'notes') IS DISTINCT FROM 'string'
         AND jsonb_typeof(exercise_item->'notes') IS DISTINCT FROM 'null' THEN
        RAISE EXCEPTION 'invalid_import: notes';
      END IF;
      notes := NULLIF(btrim(exercise_item->>'notes'), '');
      IF notes IS NOT NULL AND char_length(notes) > 280 THEN
        RAISE EXCEPTION 'invalid_import: notes';
      END IF;

      seen_ids := array_append(seen_ids, exercise_id);
    END LOOP;
  END LOOP;

  IF total_exercises > 40 THEN
    RAISE EXCEPTION 'invalid_import: exercise_count';
  END IF;

  INSERT INTO public.programs (user_id, name, slug, is_active)
  VALUES (uid, program_name, NULL, false)
  RETURNING id INTO new_program_id;

  day_index := 0;
  FOR day_item IN
    SELECT value FROM jsonb_array_elements(p_program->'days')
  LOOP
    day_index := day_index + 1;
    day_name := btrim(day_item->>'name');
    IF day_item ? 'subtitle' AND jsonb_typeof(day_item->'subtitle') = 'string' THEN
      day_subtitle := NULLIF(btrim(day_item->>'subtitle'), '');
    ELSE
      day_subtitle := NULL;
    END IF;

    INSERT INTO public.program_days (program_id, name, subtitle, day_order)
    VALUES (new_program_id, day_name, day_subtitle, day_index)
    RETURNING id INTO new_day_id;

    exercise_index := 0;
    seen_ids := ARRAY[]::bigint[];
    FOR exercise_item IN
      SELECT value FROM jsonb_array_elements(day_item->'exercises')
    LOOP
      exercise_index := exercise_index + 1;
      exercise_id := (exercise_item->>'exercise_id')::bigint;
      target_sets := (exercise_item->>'target_sets')::integer;
      min_reps := (exercise_item->>'min_reps')::integer;
      max_reps := (exercise_item->>'max_reps')::integer;
      notes := NULLIF(btrim(exercise_item->>'notes'), '');

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
$save$;

REVOKE ALL ON FUNCTION public.save_imported_program(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_imported_program(jsonb) TO authenticated;

COMMIT;
