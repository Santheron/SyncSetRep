-- NOT APPLIED. This is not an installation step.
-- Restores program_days_day_order_key, a table-wide UNIQUE (day_order).
-- Refuses when any day_order value is used by more than one row, including two saved programs
-- that both have day 1. That refusal happens before any constraint change.
-- It does not delete, renumber, or rewrite days to make rollback possible.
-- A refused run leaves the per-program constraint in place.
-- Fails closed when the per-program constraint is not exactly
-- UNIQUE NULLS NOT DISTINCT (program_id, day_order).
-- A second run, after the table-wide constraint is already restored, changes no rows.

BEGIN;

DO $rollback$
DECLARE
  shared_day_orders integer;
  old_present boolean;
  old_valid boolean;
  new_present boolean;
  new_valid boolean;
  stray_uniques integer;
  primary_on_day_order boolean;
BEGIN
  SELECT count(*) INTO shared_day_orders
  FROM (
    SELECT day_order
    FROM public.program_days
    GROUP BY day_order
    HAVING count(*) > 1
  ) shared;

  IF shared_day_orders > 0 THEN
    RAISE EXCEPTION 'day_order_rollback_blocked';
  END IF;

  WITH index_keys AS (
    SELECT
      ix.indexrelid,
      ix.indisunique,
      ix.indisprimary,
      ix.indpred,
      ix.indnullsnotdistinct,
      (
        SELECT COALESCE(array_agg(att.attname ORDER BY key.ord), ARRAY[]::name[])
        FROM unnest(ix.indkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute att
          ON att.attrelid = ix.indrelid
         AND att.attnum = key.attnum
        WHERE key.ord <= ix.indnkeyatts
          AND key.attnum > 0
      ) AS columns
    FROM pg_index ix
    WHERE ix.indrelid = 'public.program_days'::regclass
  )
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_constraint con
      WHERE con.conrelid = 'public.program_days'::regclass
        AND con.conname = 'program_days_day_order_key'
    ),
    EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN index_keys keys ON keys.indexrelid = con.conindid
      WHERE con.conrelid = 'public.program_days'::regclass
        AND con.conname = 'program_days_day_order_key'
        AND con.contype = 'u'
        AND keys.indisunique
        AND NOT keys.indisprimary
        AND keys.indpred IS NULL
        AND keys.indnullsnotdistinct = false
        AND keys.columns = ARRAY['day_order']::name[]
    ),
    EXISTS (
      SELECT 1
      FROM pg_constraint con
      WHERE con.conrelid = 'public.program_days'::regclass
        AND con.conname = 'program_days_program_id_day_order_key'
    ),
    EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN index_keys keys ON keys.indexrelid = con.conindid
      WHERE con.conrelid = 'public.program_days'::regclass
        AND con.conname = 'program_days_program_id_day_order_key'
        AND con.contype = 'u'
        AND keys.indisunique
        AND NOT keys.indisprimary
        AND keys.indpred IS NULL
        AND keys.indnullsnotdistinct = true
        AND keys.columns = ARRAY['program_id', 'day_order']::name[]
    ),
    (
      SELECT count(*)::integer
      FROM index_keys keys
      WHERE keys.indisunique
        AND NOT keys.indisprimary
        AND cardinality(keys.columns) > 0
        AND keys.columns <@ ARRAY['day_order', 'program_id']::name[]
        AND NOT EXISTS (
          SELECT 1
          FROM pg_constraint con
          WHERE con.conindid = keys.indexrelid
            AND con.conname IN (
              'program_days_day_order_key',
              'program_days_program_id_day_order_key'
            )
        )
    ),
    EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN index_keys keys ON keys.indexrelid = con.conindid
      WHERE con.conrelid = 'public.program_days'::regclass
        AND con.contype = 'p'
        AND keys.columns = ARRAY['day_order']::name[]
    )
  INTO
    old_present,
    old_valid,
    new_present,
    new_valid,
    stray_uniques,
    primary_on_day_order;

  IF primary_on_day_order
     OR (old_present AND NOT old_valid)
     OR (new_present AND NOT new_valid)
     OR stray_uniques > 0 THEN
    RAISE EXCEPTION 'day_order_rollback_schema';
  END IF;

  IF new_valid AND NOT old_present THEN
    ALTER TABLE public.program_days
      DROP CONSTRAINT program_days_program_id_day_order_key;
    ALTER TABLE public.program_days
      ADD CONSTRAINT program_days_day_order_key
      UNIQUE (day_order);
  ELSIF old_valid AND NOT new_present THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'day_order_rollback_schema';
  END IF;

  WITH index_keys AS (
    SELECT
      ix.indexrelid,
      ix.indisunique,
      ix.indisprimary,
      ix.indpred,
      ix.indnullsnotdistinct,
      (
        SELECT COALESCE(array_agg(att.attname ORDER BY key.ord), ARRAY[]::name[])
        FROM unnest(ix.indkey) WITH ORDINALITY AS key(attnum, ord)
        JOIN pg_attribute att
          ON att.attrelid = ix.indrelid
         AND att.attnum = key.attnum
        WHERE key.ord <= ix.indnkeyatts
          AND key.attnum > 0
      ) AS columns
    FROM pg_index ix
    WHERE ix.indrelid = 'public.program_days'::regclass
  )
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN index_keys keys ON keys.indexrelid = con.conindid
      WHERE con.conrelid = 'public.program_days'::regclass
        AND con.conname = 'program_days_day_order_key'
        AND con.contype = 'u'
        AND keys.indisunique
        AND NOT keys.indisprimary
        AND keys.indpred IS NULL
        AND keys.indnullsnotdistinct = false
        AND keys.columns = ARRAY['day_order']::name[]
    ),
    EXISTS (
      SELECT 1
      FROM pg_constraint con
      WHERE con.conrelid = 'public.program_days'::regclass
        AND con.conname = 'program_days_program_id_day_order_key'
    )
  INTO
    old_valid,
    new_present;

  IF NOT old_valid OR new_present THEN
    RAISE EXCEPTION 'day_order_rollback_schema';
  END IF;
END
$rollback$;

COMMIT;
