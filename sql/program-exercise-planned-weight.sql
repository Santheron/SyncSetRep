-- NOT APPLIED.
-- Do not run this file on production until a separate approval.
-- Adds nullable program_exercises.planned_weight numeric and
-- planned_weight_unit text. No default, no NOT NULL, and no backfill.
-- Replaces save_imported_program(jsonb), routine_normalize_days(jsonb, boolean),
-- and routine_write_days(uuid, bigint, jsonb, boolean) only.
-- Does not replace update_owned_program, save_manual_program, save_owned_program,
-- or record_tracked_set. Does not grant or revoke.
-- CREATE OR REPLACE keeps the existing function privileges.
-- A number may be stored with a null unit. A unit without a number is invalid.
-- An omitted planned_weight key keeps the stored plan for that exercise_id.
-- Duplicate exercise_id rows keep the plan from the lowest exercise_order,
-- then the lowest id. The migration does not update existing rows.
-- routine_write_days keeps its workout_sessions NOT EXISTS reads.
-- It does not INSERT, UPDATE, DELETE, or TRUNCATE workout_sessions or workout_sets.
-- A second run raises planned_weight_already_present.
-- Rollback: sql/program-exercise-planned-weight-rollback.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.program_exercises'::regclass
      AND attname IN ('planned_weight', 'planned_weight_unit')
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'planned_weight_already_present';
  END IF;

  IF to_regprocedure('public.save_imported_program(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'save_imported_program_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.program_exercises'::regclass
      AND attname = 'rest_seconds'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'rest_seconds_required';
  END IF;

  IF to_regprocedure('public.routine_write_days(uuid,bigint,jsonb,boolean)') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc
       WHERE oid = to_regprocedure('public.routine_write_days(uuid,bigint,jsonb,boolean)')
         AND prosrc LIKE '%routine_rest_preserve%'
     ) THEN
    RAISE EXCEPTION 'routine_rest_preserve_required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc
    WHERE oid = to_regprocedure('public.routine_write_days(uuid,bigint,jsonb,boolean)')
      AND prosrc LIKE '%planned_weight_preserve%'
  ) THEN
    RAISE EXCEPTION 'planned_weight_already_present';
  END IF;
END
$guard$;

ALTER TABLE public.program_exercises
  ADD COLUMN planned_weight numeric,
  ADD COLUMN planned_weight_unit text;

ALTER TABLE public.program_exercises
  ADD CONSTRAINT program_exercises_planned_weight_check
  CHECK (
    (
      planned_weight IS NULL
      AND planned_weight_unit IS NULL
    )
    OR (
      planned_weight IS NOT NULL
      AND planned_weight >= 0
      AND planned_weight <= 2000
      AND (
        planned_weight_unit IS NULL
        OR planned_weight_unit IN ('lb', 'kg')
      )
    )
  );

CREATE OR REPLACE FUNCTION public.save_imported_program(p_program jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
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
  rest_seconds integer;
  rest_text text;
  planned_weight numeric;
  planned_weight_unit text;
  weight_text text;
  weight_provided boolean;
  unit_provided boolean;
  seen_ids bigint[];
  payload_key text;
  normalized_days jsonb := '[]'::jsonb;
  day_exercises jsonb;
  normalized_exercise jsonb;
BEGIN
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
    -- An empty exercise list is a rest day, matching the TypeScript save plan.
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
        IF payload_key NOT IN ('exercise_id', 'target_sets', 'min_reps', 'max_reps', 'notes', 'rest_seconds', 'planned_weight', 'planned_weight_unit') THEN
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

  INSERT INTO public.programs (user_id, name, slug, is_active)
  VALUES (uid, program_name, NULL, false)
  RETURNING id INTO new_program_id;

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
$save$;

CREATE OR REPLACE FUNCTION public.routine_normalize_days(
  p_days jsonb,
  p_allow_day_id boolean
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $prepare$
DECLARE
  day_item jsonb;
  exercise_item jsonb;
  payload_key text;
  day_count integer;
  exercise_count integer;
  total_exercises integer := 0;
  day_name text;
  day_subtitle text;
  day_text text;
  seen_day_ids bigint[] := ARRAY[]::bigint[];
  seen_keys text[] := ARRAY[]::text[];
  identity_key text;
  exercise_text text;
  custom_name text;
  normalized_name text;
  sets_value integer;
  min_reps integer;
  max_reps integer;
  notes text;
  load_mode text;
  rest_text text;
  rest_seconds integer;
  rest_provided boolean;
  planned_weight numeric;
  planned_weight_unit text;
  weight_text text;
  weight_provided boolean;
  unit_provided boolean;
  has_exercise_id boolean;
  has_custom boolean;
  normalized_days jsonb := '[]'::jsonb;
  day_exercises jsonb;
  normalized_exercise jsonb;
BEGIN
  -- routine_rest_preserve
  -- planned_weight_preserve
  IF pg_catalog.jsonb_typeof(p_days) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_import: days';
  END IF;

  day_count := pg_catalog.jsonb_array_length(p_days);
  IF day_count < 1 OR day_count > 7 THEN
    RAISE EXCEPTION 'invalid_import: day_count';
  END IF;

  FOR day_item IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_days)
  LOOP
    IF pg_catalog.jsonb_typeof(day_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_import: day';
    END IF;

    FOR payload_key IN
      SELECT pg_catalog.jsonb_object_keys(day_item)
    LOOP
      IF p_allow_day_id AND payload_key NOT IN ('day_id', 'name', 'subtitle', 'exercises') THEN
        RAISE EXCEPTION 'invalid_import: day_field';
      END IF;
      IF NOT p_allow_day_id AND payload_key NOT IN ('name', 'subtitle', 'exercises') THEN
        RAISE EXCEPTION 'invalid_import: day_field';
      END IF;
    END LOOP;

    day_text := NULL;
    IF day_item ? 'day_id'
       AND pg_catalog.jsonb_typeof(day_item->'day_id') IS DISTINCT FROM 'null' THEN
      IF pg_catalog.jsonb_typeof(day_item->'day_id') NOT IN ('string', 'number') THEN
        RAISE EXCEPTION 'invalid_import: day_id';
      END IF;
      day_text := day_item->>'day_id';
      IF day_text IS NULL
         OR day_text !~ '^[1-9][0-9]*$'
         OR pg_catalog.char_length(day_text) > 19 THEN
        RAISE EXCEPTION 'invalid_import: day_id';
      END IF;
      IF pg_catalog.char_length(day_text) = 19 AND day_text > '9223372036854775807' THEN
        RAISE EXCEPTION 'invalid_import: day_id';
      END IF;
      IF day_text::bigint = ANY (seen_day_ids) THEN
        RAISE EXCEPTION 'duplicate_day';
      END IF;
      seen_day_ids := pg_catalog.array_append(seen_day_ids, day_text::bigint);
    END IF;

    day_name := pg_catalog.btrim(day_item->>'name');
    IF day_name IS NULL
       OR pg_catalog.char_length(day_name) < 1
       OR pg_catalog.char_length(day_name) > 60 THEN
      RAISE EXCEPTION 'invalid_import: day_name';
    END IF;

    day_subtitle := NULL;
    IF day_item ? 'subtitle' AND pg_catalog.jsonb_typeof(day_item->'subtitle') = 'string' THEN
      day_subtitle := NULLIF(pg_catalog.btrim(day_item->>'subtitle'), '');
    ELSIF day_item ? 'subtitle'
          AND pg_catalog.jsonb_typeof(day_item->'subtitle') IS DISTINCT FROM 'null' THEN
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
    seen_keys := ARRAY[]::text[];
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
          'exercise_id', 'custom_name', 'target_sets', 'min_reps', 'max_reps',
          'notes', 'load_mode', 'rest_seconds', 'planned_weight', 'planned_weight_unit'
        ) THEN
          RAISE EXCEPTION 'invalid_import: exercise_field';
        END IF;
      END LOOP;

      has_exercise_id := exercise_item ? 'exercise_id'
        AND pg_catalog.jsonb_typeof(exercise_item->'exercise_id') IS DISTINCT FROM 'null';
      has_custom := exercise_item ? 'custom_name'
        AND pg_catalog.jsonb_typeof(exercise_item->'custom_name') IS DISTINCT FROM 'null';
      IF has_exercise_id = has_custom THEN
        RAISE EXCEPTION 'invalid_import: exercise_source';
      END IF;

      exercise_text := NULL;
      custom_name := NULL;
      IF has_exercise_id THEN
        IF pg_catalog.jsonb_typeof(exercise_item->'exercise_id') NOT IN ('string', 'number') THEN
          RAISE EXCEPTION 'invalid_import: exercise_id';
        END IF;
        exercise_text := exercise_item->>'exercise_id';
        IF exercise_text IS NULL
           OR exercise_text !~ '^[1-9][0-9]*$'
           OR pg_catalog.char_length(exercise_text) > 19 THEN
          RAISE EXCEPTION 'invalid_import: exercise_id';
        END IF;
        IF pg_catalog.char_length(exercise_text) = 19 AND exercise_text > '9223372036854775807' THEN
          RAISE EXCEPTION 'invalid_import: exercise_id';
        END IF;
        identity_key := 'id:' || exercise_text;
      ELSE
        IF pg_catalog.jsonb_typeof(exercise_item->'custom_name') IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'invalid_import: exercise_name';
        END IF;
        custom_name := pg_catalog.btrim(exercise_item->>'custom_name');
        normalized_name := public.normalize_exercise_name(custom_name);
        IF custom_name IS NULL
           OR pg_catalog.char_length(custom_name) < 1
           OR pg_catalog.char_length(custom_name) > 80
           OR normalized_name = '' THEN
          RAISE EXCEPTION 'invalid_import: exercise_name';
        END IF;
        identity_key := 'name:' || normalized_name;
      END IF;

      IF identity_key = ANY (seen_keys) THEN
        RAISE EXCEPTION 'invalid_import: duplicate_exercise';
      END IF;
      seen_keys := pg_catalog.array_append(seen_keys, identity_key);

      sets_value := public.routine_require_int(exercise_item->>'target_sets', 1, 12, 'invalid_import: sets');
      min_reps := public.routine_require_int(exercise_item->>'min_reps', 1, 100, 'invalid_import: reps');
      max_reps := public.routine_require_int(exercise_item->>'max_reps', 1, 100, 'invalid_import: reps');
      IF min_reps > max_reps THEN
        RAISE EXCEPTION 'invalid_import: inverted_reps';
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

      load_mode := NULL;
      IF exercise_item ? 'load_mode'
         AND pg_catalog.jsonb_typeof(exercise_item->'load_mode') IS DISTINCT FROM 'null' THEN
        IF pg_catalog.jsonb_typeof(exercise_item->'load_mode') IS DISTINCT FROM 'string' THEN
          RAISE EXCEPTION 'invalid_import: load_mode';
        END IF;
        load_mode := exercise_item->>'load_mode';
        IF load_mode NOT IN ('bodyweight', 'added', 'assisted') THEN
          RAISE EXCEPTION 'invalid_import: load_mode';
        END IF;
      END IF;

      rest_provided := exercise_item ? 'rest_seconds';
      rest_seconds := NULL;
      IF rest_provided
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
      normalized_exercise := pg_catalog.jsonb_build_object(
        'exercise_id', exercise_text,
        'custom_name', custom_name,
        'target_sets', sets_value,
        'min_reps', min_reps,
        'max_reps', max_reps,
        'notes', notes,
        'load_mode', load_mode
      );
      IF rest_provided THEN
        normalized_exercise := normalized_exercise
          || pg_catalog.jsonb_build_object('rest_seconds', rest_seconds);
      END IF;
      IF weight_provided THEN
        normalized_exercise := normalized_exercise
          || pg_catalog.jsonb_build_object(
            'planned_weight', planned_weight,
            'planned_weight_unit', planned_weight_unit
          );
      END IF;
      day_exercises := day_exercises || pg_catalog.jsonb_build_array(normalized_exercise);
    END LOOP;

    normalized_days := normalized_days || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'day_id', day_text,
        'name', day_name,
        'subtitle', day_subtitle,
        'exercises', day_exercises
      )
    );
  END LOOP;

  IF total_exercises > 40 THEN
    RAISE EXCEPTION 'invalid_import: exercise_count';
  END IF;

  RETURN normalized_days;
END;
$prepare$;

CREATE OR REPLACE FUNCTION public.routine_write_days(
  p_uid uuid,
  p_program_id bigint,
  p_days jsonb,
  p_replace boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $write$
DECLARE
  day_item jsonb;
  exercise_item jsonb;
  day_index integer := 0;
  exercise_index integer;
  day_text text;
  current_day_id bigint;
  resolved_exercise_id bigint;
  seen_ids bigint[] := ARRAY[]::bigint[];
  payload_ids bigint[] := ARRAY[]::bigint[];
  owned boolean;
  prior_rest jsonb;
  stored_rest integer;
  prior_plan jsonb;
  stored_weight numeric;
  stored_unit text;
BEGIN
  -- routine_rest_preserve
  -- planned_weight_preserve
  IF p_uid IS NULL OR p_uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT true
  INTO owned
  FROM public.programs
  WHERE id = p_program_id
    AND user_id = p_uid
  FOR UPDATE;

  IF owned IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'program_not_found';
  END IF;

  SELECT COALESCE(pg_catalog.array_agg(listed.day_id), ARRAY[]::bigint[])
  INTO payload_ids
  FROM (
    SELECT (value->>'day_id')::bigint AS day_id
    FROM pg_catalog.jsonb_array_elements(p_days)
    WHERE value->>'day_id' IS NOT NULL
  ) AS listed;

  IF p_replace THEN
    UPDATE public.program_days AS day_row
    SET day_order = parked.parked_order
    FROM (
      SELECT id,
             (300000 + pg_catalog.row_number() OVER (ORDER BY id))::integer AS parked_order
      FROM public.program_days
      WHERE program_id = p_program_id
    ) AS parked
    WHERE day_row.id = parked.id;

    DELETE FROM public.program_exercises AS child
    USING public.program_days AS day_row
    WHERE child.program_day_id = day_row.id
      AND day_row.program_id = p_program_id
      AND NOT (day_row.id = ANY (payload_ids))
      AND NOT EXISTS (
        SELECT 1
        FROM public.workout_sessions AS session_row
        WHERE session_row.program_day_id = day_row.id
      );

    DELETE FROM public.program_days AS day_row
    WHERE day_row.program_id = p_program_id
      AND NOT (day_row.id = ANY (payload_ids))
      AND NOT EXISTS (
        SELECT 1
        FROM public.workout_sessions AS session_row
        WHERE session_row.program_day_id = day_row.id
      );

    UPDATE public.program_days AS day_row
    SET archived_at = COALESCE(day_row.archived_at, pg_catalog.now()),
        day_order = parked.parked_order
    FROM (
      SELECT id,
             (100000 + pg_catalog.row_number() OVER (ORDER BY id))::integer AS parked_order
      FROM public.program_days
      WHERE program_id = p_program_id
        AND NOT (id = ANY (payload_ids))
    ) AS parked
    WHERE day_row.id = parked.id;
  END IF;

  FOR day_item IN
    SELECT value FROM pg_catalog.jsonb_array_elements(p_days)
  LOOP
    day_index := day_index + 1;
    day_text := day_item->>'day_id';
    IF day_text IS NULL THEN
      INSERT INTO public.program_days (program_id, name, subtitle, day_order)
      VALUES (
        p_program_id,
        day_item->>'name',
        NULLIF(day_item->>'subtitle', ''),
        day_index
      )
      RETURNING id INTO current_day_id;
      prior_rest := '{}'::jsonb;
      prior_plan := '{}'::jsonb;
    ELSE
      current_day_id := day_text::bigint;
      UPDATE public.program_days
      SET name = day_item->>'name',
          subtitle = NULLIF(day_item->>'subtitle', ''),
          day_order = day_index
      WHERE id = current_day_id
        AND program_id = p_program_id
        AND archived_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'program_day_not_found';
      END IF;

      SELECT COALESCE(pg_catalog.jsonb_object_agg(grouped.exercise_key, grouped.rest_value), '{}'::jsonb)
      INTO prior_rest
      FROM (
        SELECT exercise_row.exercise_id::text AS exercise_key,
               pg_catalog.min(exercise_row.rest_seconds) AS rest_value
        FROM public.program_exercises AS exercise_row
        WHERE exercise_row.program_day_id = current_day_id
          AND exercise_row.rest_seconds IS NOT NULL
        GROUP BY exercise_row.exercise_id
      ) AS grouped;

      SELECT COALESCE(pg_catalog.jsonb_object_agg(picked.exercise_key, picked.plan), '{}'::jsonb)
      INTO prior_plan
      FROM (
        SELECT DISTINCT ON (exercise_row.exercise_id)
          exercise_row.exercise_id::text AS exercise_key,
          pg_catalog.jsonb_build_object(
            'planned_weight', exercise_row.planned_weight,
            'planned_weight_unit', exercise_row.planned_weight_unit
          ) AS plan
        FROM public.program_exercises AS exercise_row
        WHERE exercise_row.program_day_id = current_day_id
        ORDER BY exercise_row.exercise_id, exercise_row.exercise_order, exercise_row.id
      ) AS picked;
    END IF;

    DELETE FROM public.program_exercises
    WHERE program_day_id = current_day_id;

    exercise_index := 0;
    seen_ids := ARRAY[]::bigint[];
    FOR exercise_item IN
      SELECT value FROM pg_catalog.jsonb_array_elements(day_item->'exercises')
    LOOP
      exercise_index := exercise_index + 1;
      resolved_exercise_id := public.resolve_routine_exercise(p_uid, exercise_item);
      IF resolved_exercise_id = ANY (seen_ids) THEN
        RAISE EXCEPTION 'invalid_import: duplicate_exercise';
      END IF;
      seen_ids := pg_catalog.array_append(seen_ids, resolved_exercise_id);
      stored_rest := NULL;
      IF exercise_item ? 'rest_seconds' THEN
        stored_rest := NULLIF(exercise_item->>'rest_seconds', '')::integer;
      ELSE
        stored_rest := NULLIF(prior_rest ->> (resolved_exercise_id::text), '')::integer;
      END IF;
      IF exercise_item ? 'planned_weight' THEN
        stored_weight := NULLIF(exercise_item->>'planned_weight', '')::numeric;
        stored_unit := NULLIF(pg_catalog.btrim(exercise_item->>'planned_weight_unit'), '');
        IF stored_weight IS NULL THEN
          stored_unit := NULL;
        END IF;
      ELSE
        stored_weight := NULLIF(prior_plan -> (resolved_exercise_id::text) ->> 'planned_weight', '')::numeric;
        stored_unit := NULLIF(
          pg_catalog.btrim(prior_plan -> (resolved_exercise_id::text) ->> 'planned_weight_unit'),
          ''
        );
      END IF;
      INSERT INTO public.program_exercises (
        program_day_id,
        exercise_id,
        exercise_order,
        target_sets,
        min_reps,
        max_reps,
        notes,
        load_mode,
        rest_seconds,
        planned_weight,
        planned_weight_unit
      )
      VALUES (
        current_day_id,
        resolved_exercise_id,
        exercise_index,
        (exercise_item->>'target_sets')::integer,
        (exercise_item->>'min_reps')::integer,
        (exercise_item->>'max_reps')::integer,
        NULLIF(exercise_item->>'notes', ''),
        NULLIF(exercise_item->>'load_mode', ''),
        stored_rest,
        stored_weight,
        stored_unit
      );
    END LOOP;
  END LOOP;
END;
$write$;

SELECT 'planned_weight_installed' AS result;

COMMIT;
