-- NOT APPLIED.
-- Do not run this file on production until a separate approval.
-- Allows program_exercises.target_sets, min_reps, and max_reps to be NULL.
-- Replaces public.save_owned_program(jsonb, boolean) so a missing set or rep
-- count is stored as NULL. A supplied number must still be 1 through 12 sets
-- and 1 through 100 reps. This file does not invent 3 sets or 8 reps.
-- Day count may be 1 through 8.
-- A repeated client_request_id returns the stored program and does not insert
-- another one. When that repeat asks to make the program current, this file
-- activates the stored program. A repeat that does not ask leaves is_active
-- unchanged.
-- An exercise id must be a shared catalog exercise or owned by the signed-in
-- user. Another account's private exercise is rejected before any insert.
-- Requires the idempotent save_owned_program, client_request_id, planned_weight,
-- planned_weight_unit, rest_seconds, exercises.owner_user_id, and
-- activate_owned_program(bigint).
-- Does not replace save_imported_program, update_owned_program,
-- save_manual_program, activate_owned_program, or record_tracked_set.
-- Does not read or write workout_sessions or workout_sets.
-- Does not grant or revoke privileges. CREATE OR REPLACE keeps the current ACL.
-- A second run raises unspecified_targets_already_present.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF to_regprocedure('public.save_owned_program(jsonb, boolean)') IS NULL THEN
    RAISE EXCEPTION 'save_owned_program_required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.save_owned_program(jsonb, boolean)')
      AND strpos(prosrc, 'unspecified_targets_v1') > 0
  ) THEN
    RAISE EXCEPTION 'unspecified_targets_already_present';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'programs'
      AND column_name = 'client_request_id'
  ) THEN
    RAISE EXCEPTION 'client_request_id_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'exercises'
      AND column_name = 'owner_user_id'
  ) THEN
    RAISE EXCEPTION 'exercise_owner_required';
  END IF;

  IF to_regprocedure('public.activate_owned_program(bigint)') IS NULL THEN
    RAISE EXCEPTION 'activate_owned_program_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'program_exercises'
      AND column_name = 'planned_weight'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'program_exercises'
      AND column_name = 'planned_weight_unit'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'program_exercises'
      AND column_name = 'rest_seconds'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'program_exercises_planned_weight_check'
      AND conrelid = 'public.program_exercises'::regclass
  ) THEN
    RAISE EXCEPTION 'planned_weight_required';
  END IF;
END
$guard$;

ALTER TABLE public.program_exercises
  ALTER COLUMN target_sets DROP NOT NULL,
  ALTER COLUMN min_reps DROP NOT NULL,
  ALTER COLUMN max_reps DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.save_owned_program(
  p_program jsonb,
  p_make_current boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $save_owned$
DECLARE
  -- first_save_idempotent
  -- unspecified_targets_v1
  uid uuid := auth.uid();
  make_current boolean := COALESCE(p_make_current, false);
  new_program_id bigint;
  existing_program_id bigint;
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
  request_id uuid := NULL;
  request_text text;
  rest_text text;
  rest_seconds integer;
  weight_text text;
  weight_provided boolean;
  unit_provided boolean;
  planned_weight numeric;
  planned_weight_unit text;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '30s', true);

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF pg_catalog.jsonb_typeof(p_program) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'invalid_import: program';
  END IF;

  IF p_program ? 'client_request_id'
     AND pg_catalog.jsonb_typeof(p_program->'client_request_id') IS DISTINCT FROM 'null' THEN
    IF pg_catalog.jsonb_typeof(p_program->'client_request_id') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'invalid_import: client_request_id';
    END IF;
    request_text := pg_catalog.lower(pg_catalog.btrim(p_program->>'client_request_id'));
    IF request_text IS NULL
       OR request_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'invalid_import: client_request_id';
    END IF;
    request_id := request_text::uuid;
  END IF;

  IF request_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('program-active:' || uid::text, 0)
    );
    PERFORM 1
    FROM public.programs
    WHERE user_id = uid
    ORDER BY id
    FOR UPDATE;
    SELECT programs.id
    INTO existing_program_id
    FROM public.programs AS programs
    WHERE programs.user_id = uid
      AND programs.client_request_id = request_id;
    IF existing_program_id IS NOT NULL THEN
      IF make_current THEN
        PERFORM public.activate_owned_program(existing_program_id);
      END IF;
      RETURN existing_program_id;
    END IF;
  END IF;

  FOR payload_key IN
    SELECT pg_catalog.jsonb_object_keys(p_program)
  LOOP
    IF payload_key NOT IN ('name', 'days', 'client_request_id') THEN
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
  IF day_count < 1 OR day_count > 8 THEN
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
        IF payload_key NOT IN (
          'exercise_id',
          'target_sets',
          'min_reps',
          'max_reps',
          'notes',
          'rest_seconds',
          'planned_weight',
          'planned_weight_unit'
        ) THEN
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
      exercise_id := exercise_text::bigint;
      target_sets := NULL;
      min_reps := NULL;
      max_reps := NULL;

      IF exercise_item ? 'target_sets'
         AND pg_catalog.jsonb_typeof(exercise_item->'target_sets') IS DISTINCT FROM 'null' THEN
        IF pg_catalog.jsonb_typeof(exercise_item->'target_sets') NOT IN ('number', 'string')
           OR sets_text IS NULL
           OR sets_text !~ '^[0-9]+$' THEN
          RAISE EXCEPTION 'invalid_import: sets';
        END IF;
        sets_text := pg_catalog.ltrim(sets_text, '0');
        IF sets_text = '' THEN
          sets_text := '0';
        END IF;
        IF pg_catalog.char_length(sets_text) > 2 THEN
          RAISE EXCEPTION 'invalid_import: sets';
        END IF;
        target_sets := sets_text::integer;
        IF target_sets < 1 OR target_sets > 12 THEN
          RAISE EXCEPTION 'invalid_import: sets';
        END IF;
      END IF;

      IF (min_text IS NULL) IS DISTINCT FROM (max_text IS NULL) THEN
        RAISE EXCEPTION 'invalid_import: reps';
      END IF;
      IF min_text IS NOT NULL THEN
        IF pg_catalog.jsonb_typeof(exercise_item->'min_reps') NOT IN ('number', 'string')
           OR pg_catalog.jsonb_typeof(exercise_item->'max_reps') NOT IN ('number', 'string')
           OR min_text !~ '^[0-9]+$'
           OR max_text !~ '^[0-9]+$' THEN
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
        min_reps := min_text::integer;
        max_reps := max_text::integer;
        IF min_reps < 1 OR min_reps > 100 OR max_reps < 1 OR max_reps > 100 THEN
          RAISE EXCEPTION 'invalid_import: reps';
        END IF;
        IF min_reps > max_reps THEN
          RAISE EXCEPTION 'invalid_import: inverted_reps';
        END IF;
      END IF;
      IF exercise_id = ANY (seen_ids) THEN
        RAISE EXCEPTION 'invalid_import: duplicate_exercise';
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.exercises
        WHERE id = exercise_id
          AND (owner_user_id IS NULL OR owner_user_id = uid)
      ) THEN
        IF EXISTS (
          SELECT 1
          FROM public.exercises
          WHERE id = exercise_id
        ) THEN
          RAISE EXCEPTION 'invalid_import: exercise_owner';
        END IF;
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

      rest_seconds := NULL;
      IF exercise_item ? 'rest_seconds'
         AND pg_catalog.jsonb_typeof(exercise_item->'rest_seconds') IS DISTINCT FROM 'null' THEN
        IF pg_catalog.jsonb_typeof(exercise_item->'rest_seconds') NOT IN ('number', 'string') THEN
          RAISE EXCEPTION 'invalid_import: rest';
        END IF;
        rest_text := exercise_item->>'rest_seconds';
        IF rest_text IS NULL OR rest_text !~ '^[0-9]+$' THEN
          RAISE EXCEPTION 'invalid_import: rest';
        END IF;
        rest_text := pg_catalog.ltrim(rest_text, '0');
        IF rest_text = '' THEN
          rest_text := '0';
        END IF;
        IF pg_catalog.char_length(rest_text) > 3 THEN
          RAISE EXCEPTION 'invalid_import: rest';
        END IF;
        rest_seconds := rest_text::integer;
        IF rest_seconds > 600 THEN
          RAISE EXCEPTION 'invalid_import: rest';
        END IF;
      END IF;

      weight_provided := exercise_item ? 'planned_weight';
      unit_provided := exercise_item ? 'planned_weight_unit';
      planned_weight := NULL;
      planned_weight_unit := NULL;
      IF unit_provided AND NOT weight_provided THEN
        RAISE EXCEPTION 'invalid_import: planned_weight';
      END IF;
      IF weight_provided
         AND pg_catalog.jsonb_typeof(exercise_item->'planned_weight') IS DISTINCT FROM 'null' THEN
        IF pg_catalog.jsonb_typeof(exercise_item->'planned_weight') NOT IN ('number', 'string') THEN
          RAISE EXCEPTION 'invalid_import: planned_weight';
        END IF;
        weight_text := pg_catalog.btrim(exercise_item->>'planned_weight');
        IF weight_text IS NULL
           OR pg_catalog.char_length(weight_text) > 40
           OR weight_text !~ '^[0-9]+(\.[0-9]+)?$' THEN
          RAISE EXCEPTION 'invalid_import: planned_weight';
        END IF;
        planned_weight := weight_text::numeric;
        IF planned_weight < 0 OR planned_weight > 2000 THEN
          RAISE EXCEPTION 'invalid_import: planned_weight';
        END IF;
      END IF;
      IF weight_provided
         AND unit_provided
         AND pg_catalog.jsonb_typeof(exercise_item->'planned_weight_unit') IS DISTINCT FROM 'null' THEN
        IF planned_weight IS NULL THEN
          RAISE EXCEPTION 'invalid_import: planned_weight';
        END IF;
        IF pg_catalog.jsonb_typeof(exercise_item->'planned_weight_unit') IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'invalid_import: planned_weight_unit';
        END IF;
        planned_weight_unit := pg_catalog.btrim(exercise_item->>'planned_weight_unit');
        IF planned_weight_unit IS NULL OR planned_weight_unit NOT IN ('lb', 'kg') THEN
          RAISE EXCEPTION 'invalid_import: planned_weight_unit';
        END IF;
      END IF;

      seen_ids := pg_catalog.array_append(seen_ids, exercise_id);
      normalized_exercise := pg_catalog.jsonb_build_object(
        'exercise_id', exercise_id,
        'target_sets', target_sets,
        'min_reps', min_reps,
        'max_reps', max_reps,
        'notes', notes,
        'rest_seconds', rest_seconds,
        'planned_weight', planned_weight,
        'planned_weight_unit', planned_weight_unit
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

  existing_program_id := NULL;
  IF request_id IS NOT NULL THEN
    SELECT programs.id
    INTO existing_program_id
    FROM public.programs AS programs
    WHERE programs.user_id = uid
      AND programs.client_request_id = request_id;
    IF existing_program_id IS NOT NULL THEN
      IF make_current THEN
        PERFORM public.activate_owned_program(existing_program_id);
      END IF;
      RETURN existing_program_id;
    END IF;
  END IF;

  IF make_current AND EXISTS (
    SELECT 1
    FROM public.programs
    WHERE user_id = uid
      AND is_active
  ) THEN
    RAISE EXCEPTION 'active_program_exists';
  END IF;

  BEGIN
    INSERT INTO public.programs (user_id, name, slug, is_active, client_request_id)
    VALUES (uid, program_name, NULL, make_current, request_id)
    RETURNING id INTO new_program_id;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS constraint_name = CONSTRAINT_NAME;
      existing_program_id := NULL;
      IF request_id IS NOT NULL THEN
        SELECT programs.id
        INTO existing_program_id
        FROM public.programs AS programs
        WHERE programs.user_id = uid
          AND programs.client_request_id = request_id;
        IF existing_program_id IS NOT NULL THEN
          IF make_current THEN
            PERFORM public.activate_owned_program(existing_program_id);
          END IF;
          RETURN existing_program_id;
        END IF;
      END IF;
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
      rest_seconds := NULLIF(exercise_item->>'rest_seconds', '')::integer;
      planned_weight := NULLIF(exercise_item->>'planned_weight', '')::numeric;
      planned_weight_unit := NULLIF(pg_catalog.btrim(exercise_item->>'planned_weight_unit'), '');

      INSERT INTO public.program_exercises (
        program_day_id,
        exercise_id,
        exercise_order,
        target_sets,
        min_reps,
        max_reps,
        notes,
        rest_seconds,
        planned_weight,
        planned_weight_unit
      )
      VALUES (
        new_day_id,
        exercise_id,
        exercise_index,
        target_sets,
        min_reps,
        max_reps,
        notes,
        rest_seconds,
        planned_weight,
        planned_weight_unit
      );
    END LOOP;
  END LOOP;

  RETURN new_program_id;
END;
$save_owned$;

SELECT 'unspecified_targets_installed';

COMMIT;
