-- NOT APPLIED.
-- Replaces the production constraint program_days_day_order_key
-- (UNIQUE day_order, nulls distinct, not partial) with
-- program_days_program_id_day_order_key
-- UNIQUE NULLS NOT DISTINCT (program_id, day_order).
-- Fails closed when that named constraint is absent or defined differently,
-- when another unique index already covers program_id and day_order,
-- or when the replacement exists with different columns or null semantics.
-- A second run, after the replacement is in place, changes no rows.
-- Does not renumber days, rewrite program_id, or read or write history.
-- Does not grant or revoke privileges on the exercise catalog.
-- Run sql/ai-import-day-order-preflight.sql first and stop if duplicate_groups is not 0.
-- PostgreSQL 15 or newer is required for NULLS NOT DISTINCT. Production is 17.6.

BEGIN;

DO $migration$
DECLARE
  duplicate_groups integer;
  null_day_orders integer;
  old_present boolean;
  old_valid boolean;
  new_present boolean;
  new_valid boolean;
  stray_uniques integer;
  primary_on_day_order boolean;
BEGIN
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

  IF primary_on_day_order THEN
    RAISE EXCEPTION 'program_day_order_primary_key';
  END IF;

  IF (old_present AND NOT old_valid)
     OR (new_present AND NOT new_valid)
     OR stray_uniques > 0 THEN
    RAISE EXCEPTION 'program_day_order_schema';
  END IF;

  IF old_valid AND NOT new_present THEN
    SELECT count(*) INTO duplicate_groups
    FROM (
      SELECT program_id, day_order
      FROM public.program_days
      GROUP BY program_id, day_order
      HAVING count(*) > 1
    ) duplicates;

    IF duplicate_groups > 0 THEN
      RAISE EXCEPTION 'program_day_order_duplicates';
    END IF;

    SELECT count(*) INTO null_day_orders
    FROM public.program_days
    WHERE day_order IS NULL;

    IF null_day_orders > 0 THEN
      RAISE EXCEPTION 'program_day_order_null';
    END IF;

    ALTER TABLE public.program_days
      DROP CONSTRAINT program_days_day_order_key;
    ALTER TABLE public.program_days
      ADD CONSTRAINT program_days_program_id_day_order_key
      UNIQUE NULLS NOT DISTINCT (program_id, day_order);
  ELSIF NOT old_present AND new_valid THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'program_day_order_schema';
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
    )
  INTO
    old_present,
    new_valid,
    stray_uniques;

  IF old_present OR NOT new_valid OR stray_uniques > 0 THEN
    RAISE EXCEPTION 'program_day_order_schema';
  END IF;
END
$migration$;

COMMIT;
