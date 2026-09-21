-- Final 5-day aesthetic / V-taper program configuration
-- Paste this entire file into the Supabase SQL Editor and run it once.
--
-- SAFE FOR HISTORY:
--   Does NOT delete or update workout_sessions.
--   Does NOT delete or update workout_sets.
--   Does NOT delete exercises.
--   Only updates program_days names/subtitles for day_order 1-5
--   and replaces program_exercises for those five days.
--
-- ID types: resolved_exercises.exercise_id inherits public.exercises.id
-- (bigint in this database). No UUID assumption.
--
-- Idempotent: running it again yields the same program configuration.

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.norm_exercise_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both ' ' FROM regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

-- Report actual ID types. This does not alter any columns.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT table_name, column_name, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'exercises' AND column_name = 'id')
        OR (table_name = 'program_exercises' AND column_name IN ('id', 'exercise_id', 'program_day_id'))
        OR (table_name = 'program_days' AND column_name = 'id')
        OR (table_name = 'workout_sessions' AND column_name IN ('id', 'program_day_id'))
        OR (table_name = 'workout_sets' AND column_name IN ('id', 'exercise_id', 'workout_session_id'))
      )
    ORDER BY table_name, column_name
  LOOP
    RAISE NOTICE '%.% type = % (%)', rec.table_name, rec.column_name, rec.data_type, rec.udt_name;
  END LOOP;
END $$;

-- Stop if deleting program_exercises would cascade into history tables.
DO $$
DECLARE
  unsafe text;
BEGIN
  SELECT string_agg(
           format('%s.%s ON DELETE %s', n.nspname, history.relname, CASE c.confdeltype
             WHEN 'c' THEN 'CASCADE'
             WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
             ELSE c.confdeltype::text
           END),
           ', '
         )
  INTO unsafe
  FROM pg_constraint c
  JOIN pg_class history ON history.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = history.relnamespace
  JOIN pg_class config ON config.oid = c.confrelid
  JOIN pg_namespace config_ns ON config_ns.oid = config.relnamespace
  WHERE c.contype = 'f'
    AND config_ns.nspname = 'public'
    AND config.relname = 'program_exercises'
    AND n.nspname = 'public'
    AND history.relname IN ('workout_sessions', 'workout_sets')
    AND c.confdeltype IN ('c', 'n', 'd');

  IF unsafe IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to replace program_exercises because history would be affected: %. No changes applied.',
      unsafe;
  END IF;
END $$;

DO $$
DECLARE
  day_count integer;
BEGIN
  SELECT COUNT(*)
  INTO day_count
  FROM public.program_days
  WHERE day_order BETWEEN 1 AND 5;

  IF day_count <> 5 THEN
    RAISE EXCEPTION
      'Expected 5 program_days with day_order 1-5, found %. Aborting so history is not changed.',
      day_count;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Insert only missing exercises. Reuse similar rows for metadata.
-- ---------------------------------------------------------------------------
INSERT INTO public.exercises (
  name,
  category,
  exercise_type,
  equipment_type,
  warmup_enabled,
  min_weight,
  weight_increment
)
SELECT
  'EZ-Bar Curl',
  COALESCE(src.category, 'Arms'),
  COALESCE(src.exercise_type, 'isolation'),
  COALESCE(src.equipment_type, 'barbell'),
  COALESCE(src.warmup_enabled, false),
  src.min_weight,
  COALESCE(src.weight_increment, 5)
FROM (SELECT 1) AS seed
LEFT JOIN LATERAL (
  SELECT category, exercise_type, equipment_type, warmup_enabled, min_weight, weight_increment
  FROM public.exercises
  WHERE pg_temp.norm_exercise_name(name) IN (
    'ez bar curl',
    'ez curl',
    'ez bar biceps curl',
    'barbell curl',
    'cable curl'
  )
  ORDER BY
    CASE pg_temp.norm_exercise_name(name)
      WHEN 'ez bar curl' THEN 0
      WHEN 'ez curl' THEN 1
      WHEN 'ez bar biceps curl' THEN 2
      WHEN 'barbell curl' THEN 3
      ELSE 4
    END
  LIMIT 1
) src ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.exercises existing
  WHERE pg_temp.norm_exercise_name(existing.name) IN (
    'ez bar curl',
    'ez curl',
    'ez bar biceps curl'
  )
);

INSERT INTO public.exercises (
  name,
  category,
  exercise_type,
  equipment_type,
  warmup_enabled,
  min_weight,
  weight_increment
)
SELECT
  'Hammer Curl',
  COALESCE(src.category, 'Arms'),
  COALESCE(src.exercise_type, 'isolation'),
  COALESCE(src.equipment_type, 'dumbbell'),
  COALESCE(src.warmup_enabled, false),
  src.min_weight,
  COALESCE(src.weight_increment, 5)
FROM (SELECT 1) AS seed
LEFT JOIN LATERAL (
  SELECT category, exercise_type, equipment_type, warmup_enabled, min_weight, weight_increment
  FROM public.exercises
  WHERE pg_temp.norm_exercise_name(name) IN ('hammer curl', 'hammer curls', 'cable curl')
  ORDER BY CASE WHEN pg_temp.norm_exercise_name(name) LIKE 'hammer curl%' THEN 0 ELSE 1 END
  LIMIT 1
) src ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.exercises existing
  WHERE pg_temp.norm_exercise_name(existing.name) IN ('hammer curl', 'hammer curls')
);

INSERT INTO public.exercises (
  name,
  category,
  exercise_type,
  equipment_type,
  warmup_enabled,
  min_weight,
  weight_increment
)
SELECT
  'Overhead Cable Triceps Extension',
  COALESCE(src.category, 'Arms'),
  COALESCE(src.exercise_type, 'isolation'),
  COALESCE(src.equipment_type, 'cable'),
  COALESCE(src.warmup_enabled, false),
  src.min_weight,
  COALESCE(src.weight_increment, 10)
FROM (SELECT 1) AS seed
LEFT JOIN LATERAL (
  SELECT category, exercise_type, equipment_type, warmup_enabled, min_weight, weight_increment
  FROM public.exercises
  WHERE pg_temp.norm_exercise_name(name) IN (
    'overhead cable triceps extension',
    'overhead triceps extension',
    'triceps pushdown',
    'tricep pushdown'
  )
  ORDER BY
    CASE pg_temp.norm_exercise_name(name)
      WHEN 'overhead cable triceps extension' THEN 0
      WHEN 'overhead triceps extension' THEN 1
      WHEN 'triceps pushdown' THEN 2
      ELSE 3
    END
  LIMIT 1
) src ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.exercises existing
  WHERE pg_temp.norm_exercise_name(existing.name) IN (
    'overhead cable triceps extension',
    'overhead triceps extension'
  )
);

INSERT INTO public.exercises (
  name,
  category,
  exercise_type,
  equipment_type,
  warmup_enabled,
  min_weight,
  weight_increment
)
SELECT
  'Incline Dumbbell Press',
  COALESCE(src.category, 'Chest'),
  COALESCE(src.exercise_type, 'compound'),
  'dumbbell',
  COALESCE(src.warmup_enabled, true),
  COALESCE(src.min_weight, 5),
  COALESCE(src.weight_increment, 5)
FROM (SELECT 1) AS seed
LEFT JOIN LATERAL (
  SELECT category, exercise_type, warmup_enabled, min_weight, weight_increment
  FROM public.exercises
  WHERE pg_temp.norm_exercise_name(name) IN (
    'incline dumbbell press',
    'incline db press',
    'incline dumbbell bench press',
    'dumbbell bench press',
    'incline barbell bench press'
  )
  ORDER BY
    CASE pg_temp.norm_exercise_name(name)
      WHEN 'incline dumbbell press' THEN 0
      WHEN 'incline db press' THEN 1
      WHEN 'incline dumbbell bench press' THEN 2
      WHEN 'dumbbell bench press' THEN 3
      ELSE 4
    END
  LIMIT 1
) src ON true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.exercises existing
  WHERE pg_temp.norm_exercise_name(existing.name) IN (
    'incline dumbbell press',
    'incline db press',
    'incline dumbbell bench press'
  )
);

CREATE TEMP TABLE planned_exercises (
  canonical_name text PRIMARY KEY,
  aliases text[] NOT NULL
) ON COMMIT DROP;

INSERT INTO planned_exercises (canonical_name, aliases) VALUES
  (
    'Incline Barbell Bench Press',
    ARRAY['incline barbell bench press', 'incline bench press', 'incline barbell bench']
  ),
  (
    'Pull-Up',
    ARRAY['pull up', 'pull ups', 'pullup', 'pullups']
  ),
  (
    'Chest-Supported Row',
    ARRAY['chest supported row', 'chest supported rows']
  ),
  (
    'Cable Lateral Raise',
    ARRAY['cable lateral raise', 'cable lateral raises']
  ),
  (
    'Dip',
    ARRAY['dip', 'dips']
  ),
  (
    'EZ-Bar Curl',
    ARRAY['ez bar curl', 'ez curl', 'ez bar biceps curl']
  ),
  (
    'Barbell Squat',
    ARRAY['barbell squat', 'back squat', 'squat']
  ),
  (
    'Romanian Deadlift',
    ARRAY['romanian deadlift', 'rdl']
  ),
  (
    'Leg Curl',
    ARRAY['leg curl', 'lying leg curl', 'seated leg curl']
  ),
  (
    'Calf Raise',
    ARRAY['calf raise', 'calf raises', 'standing calf raise', 'standing calf raises']
  ),
  (
    'Overhead Press',
    ARRAY['overhead press', 'barbell overhead press', 'ohp', 'military press']
  ),
  (
    'Reverse Pec Deck',
    ARRAY['reverse pec deck', 'reverse pec deck fly', 'rear delt fly']
  ),
  (
    'Lu Raise',
    ARRAY['lu raise', 'lu raises']
  ),
  (
    'Triceps Pushdown',
    ARRAY['triceps pushdown', 'tricep pushdown', 'cable pushdown']
  ),
  (
    'Lat Pulldown',
    ARRAY['lat pulldown', 'lat pull down', 'lat pulldowns']
  ),
  (
    'Face Pull',
    ARRAY['face pull', 'face pulls']
  ),
  (
    'Hammer Curl',
    ARRAY['hammer curl', 'hammer curls']
  ),
  (
    'Overhead Cable Triceps Extension',
    ARRAY['overhead cable triceps extension', 'overhead triceps extension']
  ),
  (
    'Incline Dumbbell Press',
    ARRAY['incline dumbbell press', 'incline db press', 'incline dumbbell bench press']
  );

CREATE TEMP TABLE resolved_exercises ON COMMIT DROP AS
SELECT
  ''::text AS canonical_name,
  id AS exercise_id
FROM public.exercises
WHERE false;

ALTER TABLE resolved_exercises
  ADD PRIMARY KEY (canonical_name);

ALTER TABLE resolved_exercises
  ALTER COLUMN exercise_id SET NOT NULL;

INSERT INTO resolved_exercises (canonical_name, exercise_id)
SELECT DISTINCT ON (planned.canonical_name)
  planned.canonical_name,
  existing.id
FROM planned_exercises planned
JOIN public.exercises existing
  ON pg_temp.norm_exercise_name(existing.name) = ANY (planned.aliases)
ORDER BY
  planned.canonical_name,
  CASE
    WHEN pg_temp.norm_exercise_name(existing.name) = pg_temp.norm_exercise_name(planned.canonical_name)
      THEN 0
    ELSE 1
  END,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.program_exercises used
      WHERE used.exercise_id = existing.id
    ) THEN 0
    ELSE 1
  END,
  existing.id;

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(planned.canonical_name, ', ' ORDER BY planned.canonical_name)
  INTO missing
  FROM planned_exercises planned
  LEFT JOIN resolved_exercises resolved
    ON resolved.canonical_name = planned.canonical_name
  WHERE resolved.exercise_id IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Missing exercise rows (history preserved; no program change applied): %',
      missing;
  END IF;
END $$;

UPDATE public.program_days
SET name = 'Upper A',
    subtitle = 'Monday'
WHERE day_order = 1;

UPDATE public.program_days
SET name = 'Lower',
    subtitle = 'Tuesday'
WHERE day_order = 2;

UPDATE public.program_days
SET name = 'Shoulders + Arms',
    subtitle = 'Wednesday'
WHERE day_order = 3;

UPDATE public.program_days
SET name = 'Back + Arms',
    subtitle = 'Thursday'
WHERE day_order = 4;

UPDATE public.program_days
SET name = 'Delts + Upper Chest + Arms',
    subtitle = 'Friday'
WHERE day_order = 5;

DELETE FROM public.program_exercises
WHERE program_day_id IN (
  SELECT id
  FROM public.program_days
  WHERE day_order BETWEEN 1 AND 5
);

CREATE TEMP TABLE planned_program (
  day_order integer NOT NULL,
  exercise_order integer NOT NULL,
  canonical_name text NOT NULL,
  target_sets integer NOT NULL,
  min_reps integer NOT NULL,
  max_reps integer NOT NULL,
  PRIMARY KEY (day_order, exercise_order)
) ON COMMIT DROP;

INSERT INTO planned_program (
  day_order, exercise_order, canonical_name, target_sets, min_reps, max_reps
) VALUES
  -- Monday — Upper A
  (1, 1, 'Incline Barbell Bench Press', 3, 6, 10),
  (1, 2, 'Pull-Up', 3, 4, 8),
  (1, 3, 'Chest-Supported Row', 3, 6, 10),
  (1, 4, 'Cable Lateral Raise', 3, 8, 12),
  (1, 5, 'Dip', 2, 6, 10),
  (1, 6, 'EZ-Bar Curl', 2, 8, 10),
  -- Tuesday — Lower
  (2, 1, 'Barbell Squat', 3, 5, 8),
  (2, 2, 'Romanian Deadlift', 3, 6, 10),
  (2, 3, 'Leg Curl', 2, 8, 10),
  (2, 4, 'Calf Raise', 3, 8, 12),
  -- Wednesday — Shoulders + Arms
  (3, 1, 'Overhead Press', 3, 6, 10),
  (3, 2, 'Cable Lateral Raise', 3, 8, 12),
  (3, 3, 'Reverse Pec Deck', 3, 8, 12),
  (3, 4, 'Lu Raise', 2, 8, 10),
  (3, 5, 'EZ-Bar Curl', 3, 8, 10),
  (3, 6, 'Triceps Pushdown', 3, 8, 10),
  -- Thursday — Back + Arms
  (4, 1, 'Pull-Up', 3, 4, 8),
  (4, 2, 'Lat Pulldown', 3, 6, 10),
  (4, 3, 'Chest-Supported Row', 3, 6, 10),
  (4, 4, 'Face Pull', 2, 10, 12),
  (4, 5, 'Hammer Curl', 3, 8, 10),
  (4, 6, 'Overhead Cable Triceps Extension', 3, 8, 10),
  -- Friday — Delts + Upper Chest + Arms
  (5, 1, 'Incline Dumbbell Press', 3, 6, 10),
  (5, 2, 'Cable Lateral Raise', 3, 8, 12),
  (5, 3, 'Reverse Pec Deck', 2, 8, 12),
  (5, 4, 'EZ-Bar Curl', 2, 8, 10),
  (5, 5, 'Overhead Cable Triceps Extension', 2, 8, 10);

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
  days.id,
  resolved.exercise_id,
  planned.exercise_order,
  planned.target_sets,
  planned.min_reps,
  planned.max_reps,
  NULL
FROM planned_program planned
JOIN public.program_days days
  ON days.day_order = planned.day_order
JOIN resolved_exercises resolved
  ON resolved.canonical_name = planned.canonical_name;

DO $$
DECLARE
  exercise_count integer;
  summary text;
BEGIN
  SELECT COUNT(*)
  INTO exercise_count
  FROM public.program_exercises pe
  JOIN public.program_days days
    ON days.id = pe.program_day_id
  WHERE days.day_order BETWEEN 1 AND 5;

  IF exercise_count <> 27 THEN
    RAISE EXCEPTION
      'Expected 27 program_exercises for days 1-5, found %. Rolling back.',
      exercise_count;
  END IF;

  SELECT string_agg(
    days.day_order::text || ' ' || days.name || ': ' || pe.exercise_order::text || '. ' || ex.name
      || ' ' || pe.target_sets::text || 'x' || pe.min_reps::text || '-' || pe.max_reps::text,
    E'\n'
    ORDER BY days.day_order, pe.exercise_order
  )
  INTO summary
  FROM public.program_days days
  JOIN public.program_exercises pe
    ON pe.program_day_id = days.id
  JOIN public.exercises ex
    ON ex.id = pe.exercise_id
  WHERE days.day_order BETWEEN 1 AND 5;

  RAISE NOTICE E'New program:\n%', summary;
END $$;

COMMIT;
