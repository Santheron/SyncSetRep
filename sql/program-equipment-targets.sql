-- NOT APPLIED.
-- Do not run this file on production until a separate approval.
-- Adds nullable program_exercises.equipment_targets jsonb.
-- No default and no backfill.
-- equipment_targets_json_valid rejects a bad array, an unsupported equipment
-- name, a weight outside 0 through 2000, a non-numeric weight, a unit without
-- a weight, a duplicate equipment name, and any extra key. NULL stays valid.
-- enforce_equipment_target_owners rejects a variation_exercise_id that is not
-- a catalog exercise and is not owned by the program owner.
-- Creates save_equipment_targets(jsonb).
-- Does not replace save_imported_program, save_owned_program, routine_write_days,
-- update_owned_program, save_manual_program, or record_tracked_set.
-- Does not read or write completed workout rows.
-- A second run raises equipment_targets_already_present.
-- Rollback: sql/program-equipment-targets-rollback.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.program_exercises'::regclass
      AND attname = 'equipment_targets'
      AND NOT attisdropped
  ) OR to_regprocedure('public.save_equipment_targets(jsonb)') IS NOT NULL
    OR to_regprocedure('public.equipment_targets_json_valid(jsonb)') IS NOT NULL
    OR to_regprocedure('public.enforce_equipment_target_owners()') IS NOT NULL THEN
    RAISE EXCEPTION 'equipment_targets_already_present';
  END IF;
END
$guard$;

ALTER TABLE public.program_exercises
  ADD COLUMN equipment_targets jsonb;

CREATE FUNCTION public.equipment_targets_json_valid(p_targets jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $valid$
DECLARE
  target jsonb;
  equipment text;
  weight_text text;
  weight_value numeric;
  unit text;
  variation_text text;
  seen text[] := ARRAY[]::text[];
BEGIN
  IF p_targets IS NULL THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(p_targets) <> 'array'
     OR jsonb_array_length(p_targets) < 1
     OR jsonb_array_length(p_targets) > 5 THEN
    RETURN false;
  END IF;
  FOR target IN
    SELECT value
    FROM jsonb_array_elements(p_targets)
  LOOP
    IF jsonb_typeof(target) <> 'object'
       OR NOT (target ? 'equipment')
       OR jsonb_typeof(target -> 'equipment') <> 'string' THEN
      RETURN false;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM jsonb_object_keys(target) AS key
      WHERE key NOT IN ('equipment', 'weight', 'unit', 'variation_exercise_id')
    ) THEN
      RETURN false;
    END IF;
    equipment := target ->> 'equipment';
    IF equipment NOT IN ('barbell', 'machine', 'dumbbell', 'cable', 'bodyweight')
       OR equipment = ANY (seen) THEN
      RETURN false;
    END IF;
    seen := seen || equipment;
    weight_value := NULL;
    IF target ? 'weight' AND jsonb_typeof(target -> 'weight') <> 'null' THEN
      IF jsonb_typeof(target -> 'weight') <> 'number' THEN
        RETURN false;
      END IF;
      weight_text := target ->> 'weight';
      IF weight_text !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RETURN false;
      END IF;
      weight_value := weight_text::numeric;
      IF weight_value < 0 OR weight_value > 2000 THEN
        RETURN false;
      END IF;
    END IF;
    IF target ? 'unit' AND jsonb_typeof(target -> 'unit') <> 'null' THEN
      IF weight_value IS NULL
         OR jsonb_typeof(target -> 'unit') <> 'string' THEN
        RETURN false;
      END IF;
      unit := target ->> 'unit';
      IF unit NOT IN ('lb', 'kg') THEN
        RETURN false;
      END IF;
    END IF;
    IF target ? 'variation_exercise_id'
       AND jsonb_typeof(target -> 'variation_exercise_id') <> 'null' THEN
      IF jsonb_typeof(target -> 'variation_exercise_id') <> 'number' THEN
        RETURN false;
      END IF;
      variation_text := target ->> 'variation_exercise_id';
      IF variation_text !~ '^[1-9][0-9]{0,18}$' THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;
  RETURN true;
END;
$valid$;

ALTER TABLE public.program_exercises
  ADD CONSTRAINT program_exercises_equipment_targets_check
  CHECK (public.equipment_targets_json_valid(equipment_targets));

CREATE FUNCTION public.enforce_equipment_target_owners()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $owners$
DECLARE
  owner uuid;
  target jsonb;
  variation_text text;
  variation bigint;
BEGIN
  IF NEW.equipment_targets IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.equipment_targets_json_valid(NEW.equipment_targets) THEN
    RETURN NEW;
  END IF;
  SELECT p.user_id
  INTO owner
  FROM public.program_days AS pd
  JOIN public.programs AS p ON p.id = pd.program_id
  WHERE pd.id = NEW.program_day_id;
  IF owner IS NULL THEN
    RAISE EXCEPTION 'equipment_target_not_owned';
  END IF;
  FOR target IN
    SELECT value
    FROM jsonb_array_elements(NEW.equipment_targets)
  LOOP
    IF target ? 'variation_exercise_id'
       AND jsonb_typeof(target -> 'variation_exercise_id') = 'number' THEN
      variation_text := target ->> 'variation_exercise_id';
      IF variation_text ~ '^[1-9][0-9]{0,18}$' THEN
        variation := variation_text::bigint;
        IF NOT EXISTS (
          SELECT 1
          FROM public.exercises AS exercise_row
          WHERE exercise_row.id = variation
            AND (
              exercise_row.owner_user_id IS NULL
              OR exercise_row.owner_user_id = owner
            )
        ) THEN
          RAISE EXCEPTION 'equipment_target_not_owned';
        END IF;
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$owners$;

CREATE TRIGGER program_exercises_equipment_target_owners
  BEFORE INSERT OR UPDATE OF equipment_targets ON public.program_exercises
  FOR EACH ROW
  EXECUTE PROCEDURE public.enforce_equipment_target_owners();

CREATE FUNCTION public.save_equipment_targets(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $targets$
DECLARE
  uid uuid := auth.uid();
  item jsonb;
  target jsonb;
  resolved_ids bigint[] := ARRAY[]::bigint[];
  resolved_values jsonb[] := ARRAY[]::jsonb[];
  found_id bigint;
  requested_program_id bigint;
  requested_day_order integer;
  requested_exercise_order integer;
  parsed_id bigint;
  equipment text;
  unit text;
  weight numeric;
  variation bigint;
  kinds text[];
  cleaned jsonb;
  stored jsonb;
  idx integer;
  updated_count integer := 0;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  PERFORM pg_catalog.set_config('statement_timeout', '30s', true);

  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_payload IS NULL
     OR jsonb_typeof(p_payload) <> 'object'
     OR NOT (p_payload ? 'rows')
     OR jsonb_typeof(p_payload -> 'rows') <> 'array'
     OR jsonb_array_length(p_payload -> 'rows') < 1
     OR jsonb_array_length(p_payload -> 'rows') > 80 THEN
    RAISE EXCEPTION 'invalid_import: equipment_targets';
  END IF;

  requested_program_id := NULL;
  IF p_payload ? 'program_id' THEN
    IF jsonb_typeof(p_payload -> 'program_id') <> 'number'
       OR (p_payload ->> 'program_id') !~ '^[1-9][0-9]{0,18}$' THEN
      RAISE EXCEPTION 'invalid_import: equipment_targets';
    END IF;
    requested_program_id := (p_payload ->> 'program_id')::bigint;
  END IF;

  FOR item IN
    SELECT value
    FROM jsonb_array_elements(p_payload -> 'rows')
  LOOP
    IF jsonb_typeof(item) <> 'object' OR NOT (item ? 'targets') THEN
      RAISE EXCEPTION 'invalid_import: equipment_targets';
    END IF;

    found_id := NULL;
    IF item ? 'program_exercise_id' THEN
      IF item ? 'day_order' OR item ? 'exercise_order' THEN
        RAISE EXCEPTION 'invalid_import: equipment_targets';
      END IF;
      IF jsonb_typeof(item -> 'program_exercise_id') <> 'number'
         OR (item ->> 'program_exercise_id') !~ '^[1-9][0-9]{0,18}$' THEN
        RAISE EXCEPTION 'invalid_import: equipment_targets';
      END IF;
      parsed_id := (item ->> 'program_exercise_id')::bigint;
      SELECT pe.id
      INTO found_id
      FROM public.program_exercises AS pe
      JOIN public.program_days AS pd ON pd.id = pe.program_day_id
      JOIN public.programs AS p ON p.id = pd.program_id
      WHERE p.user_id = uid
        AND pe.id = parsed_id
      FOR UPDATE OF pe;
    ELSE
      IF requested_program_id IS NULL OR NOT (item ? 'day_order') OR NOT (item ? 'exercise_order') THEN
        RAISE EXCEPTION 'invalid_import: equipment_targets';
      END IF;
      IF jsonb_typeof(item -> 'day_order') <> 'number'
         OR jsonb_typeof(item -> 'exercise_order') <> 'number'
         OR (item ->> 'day_order') !~ '^[1-9][0-9]{0,6}$'
         OR (item ->> 'exercise_order') !~ '^[1-9][0-9]{0,6}$' THEN
        RAISE EXCEPTION 'invalid_import: equipment_targets';
      END IF;
      requested_day_order := (item ->> 'day_order')::integer;
      requested_exercise_order := (item ->> 'exercise_order')::integer;
      SELECT pe.id
      INTO found_id
      FROM public.program_exercises AS pe
      JOIN public.program_days AS pd ON pd.id = pe.program_day_id
      JOIN public.programs AS p ON p.id = pd.program_id
      WHERE p.user_id = uid
        AND p.id = requested_program_id
        AND pd.day_order = requested_day_order
        AND pe.exercise_order = requested_exercise_order
        AND pd.archived_at IS NULL
      FOR UPDATE OF pe;
    END IF;

    IF found_id IS NULL OR found_id = ANY (resolved_ids) THEN
      RAISE EXCEPTION 'equipment_target_not_owned';
    END IF;

    IF jsonb_typeof(item -> 'targets') = 'null' OR (
      jsonb_typeof(item -> 'targets') = 'array' AND jsonb_array_length(item -> 'targets') = 0
    ) THEN
      stored := 'null'::jsonb;
    ELSIF jsonb_typeof(item -> 'targets') <> 'array'
          OR jsonb_array_length(item -> 'targets') > 5 THEN
      RAISE EXCEPTION 'invalid_import: equipment_targets';
    ELSE
      kinds := ARRAY[]::text[];
      cleaned := '[]'::jsonb;
      FOR target IN
        SELECT value
        FROM jsonb_array_elements(item -> 'targets')
      LOOP
        IF jsonb_typeof(target) <> 'object'
           OR NOT (target ? 'equipment')
           OR jsonb_typeof(target -> 'equipment') <> 'string' THEN
          RAISE EXCEPTION 'invalid_import: equipment_targets';
        END IF;
        IF EXISTS (
          SELECT key
          FROM jsonb_object_keys(target) AS key
          WHERE key NOT IN ('equipment', 'weight', 'unit', 'variation_exercise_id')
        ) THEN
          RAISE EXCEPTION 'invalid_import: equipment_target_field';
        END IF;
        equipment := target ->> 'equipment';
        IF equipment NOT IN ('barbell', 'machine', 'dumbbell', 'cable', 'bodyweight')
           OR equipment = ANY (kinds) THEN
          RAISE EXCEPTION 'invalid_import: equipment_targets';
        END IF;
        kinds := kinds || equipment;

        weight := NULL;
        IF target ? 'weight' AND jsonb_typeof(target -> 'weight') <> 'null' THEN
          IF jsonb_typeof(target -> 'weight') <> 'number'
             OR (target ->> 'weight') !~ '^[0-9]+(\.[0-9]+)?$' THEN
            RAISE EXCEPTION 'invalid_import: equipment_weight';
          END IF;
          weight := (target ->> 'weight')::numeric;
          IF weight < 0 OR weight > 2000 THEN
            RAISE EXCEPTION 'invalid_import: equipment_weight';
          END IF;
        END IF;

        unit := NULL;
        IF target ? 'unit' AND jsonb_typeof(target -> 'unit') <> 'null' THEN
          IF jsonb_typeof(target -> 'unit') <> 'string'
             OR (target ->> 'unit') NOT IN ('lb', 'kg')
             OR weight IS NULL THEN
            RAISE EXCEPTION 'invalid_import: equipment_weight';
          END IF;
          unit := target ->> 'unit';
        END IF;

        variation := NULL;
        IF target ? 'variation_exercise_id'
           AND jsonb_typeof(target -> 'variation_exercise_id') <> 'null' THEN
          IF jsonb_typeof(target -> 'variation_exercise_id') <> 'number'
             OR (target ->> 'variation_exercise_id') !~ '^[1-9][0-9]{0,18}$' THEN
            RAISE EXCEPTION 'invalid_import: equipment_targets';
          END IF;
          variation := (target ->> 'variation_exercise_id')::bigint;
          IF NOT EXISTS (
            SELECT 1
            FROM public.exercises AS exercise_row
            WHERE exercise_row.id = variation
              AND (exercise_row.owner_user_id IS NULL OR exercise_row.owner_user_id = uid)
          ) THEN
            RAISE EXCEPTION 'invalid_import: equipment_targets';
          END IF;
        END IF;

        cleaned := cleaned || jsonb_build_array(
          jsonb_strip_nulls(
            jsonb_build_object(
              'equipment', equipment,
              'weight', weight,
              'unit', unit,
              'variation_exercise_id', variation
            )
          ) || jsonb_build_object('weight', weight, 'unit', unit)
        );
      END LOOP;
      stored := cleaned;
    END IF;

    resolved_ids := resolved_ids || found_id;
    resolved_values := resolved_values || stored;
  END LOOP;

  FOR idx IN 1 .. coalesce(array_length(resolved_ids, 1), 0) LOOP
    UPDATE public.program_exercises
    SET equipment_targets = CASE
      WHEN resolved_values[idx] = 'null'::jsonb THEN NULL
      ELSE resolved_values[idx]
    END
    WHERE id = resolved_ids[idx];
    updated_count := updated_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', updated_count);
END;
$targets$;

REVOKE ALL ON FUNCTION public.equipment_targets_json_valid(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.equipment_targets_json_valid(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.equipment_targets_json_valid(jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.equipment_targets_json_valid(jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.equipment_targets_json_valid(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.enforce_equipment_target_owners() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_equipment_target_owners() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_equipment_target_owners() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_equipment_target_owners() FROM service_role;
GRANT EXECUTE ON FUNCTION public.enforce_equipment_target_owners() TO authenticated;

REVOKE ALL ON FUNCTION public.save_equipment_targets(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_equipment_targets(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.save_equipment_targets(jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.save_equipment_targets(jsonb) FROM service_role;
GRANT EXECUTE ON FUNCTION public.save_equipment_targets(jsonb) TO authenticated;

COMMIT;

SELECT 'equipment_targets_installed' AS result;
