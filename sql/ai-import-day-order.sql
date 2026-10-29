-- NOT APPLIED.
-- Replaces a table-wide unique day_order with one unique day_order per program.
-- Does not renumber days, rewrite program_id, or read or write history.
-- Does not grant or revoke privileges on the exercise catalog.
-- Run sql/ai-import-day-order-preflight.sql first and stop if duplicate_groups is not 0.
-- PostgreSQL 15 or newer is required for NULLS NOT DISTINCT. Production is 17.6.

BEGIN;

DO $migration$
DECLARE
  constraint_name text;
  index_name text;
  duplicate_groups integer;
  null_day_orders integer;
  primary_on_day_order boolean;
BEGIN
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

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint con
    WHERE con.conrelid = 'public.program_days'::regclass
      AND con.contype = 'p'
      AND (
        SELECT array_agg(att.attname ORDER BY att.attname)
        FROM unnest(con.conkey) AS key(attnum)
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid
         AND att.attnum = key.attnum
      ) = ARRAY['day_order']::name[]
  ) INTO primary_on_day_order;

  IF primary_on_day_order THEN
    RAISE EXCEPTION 'program_day_order_primary_key';
  END IF;

  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.program_days'::regclass
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname ORDER BY cols.ord)
        FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ord)
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid
         AND att.attnum = cols.attnum
      ) = ARRAY['day_order']::name[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.program_days DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;

  FOR index_name IN
    SELECT idx.relname
    FROM pg_index ix
    JOIN pg_class idx ON idx.oid = ix.indexrelid
    WHERE ix.indrelid = 'public.program_days'::regclass
      AND ix.indisunique
      AND NOT ix.indisprimary
      AND NOT EXISTS (
        SELECT 1
        FROM pg_constraint con
        WHERE con.conindid = ix.indexrelid
      )
      AND (
        SELECT array_agg(att.attname ORDER BY cols.ord)
        FROM unnest(ix.indkey) WITH ORDINALITY AS cols(attnum, ord)
        JOIN pg_attribute att
          ON att.attrelid = ix.indrelid
         AND att.attnum = cols.attnum
         AND cols.attnum > 0
      ) = ARRAY['day_order']::name[]
  LOOP
    EXECUTE format('DROP INDEX public.%I', index_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    WHERE con.conrelid = 'public.program_days'::regclass
      AND con.contype = 'u'
      AND (
        SELECT array_agg(att.attname ORDER BY att.attname)
        FROM unnest(con.conkey) AS key(attnum)
        JOIN pg_attribute att
          ON att.attrelid = con.conrelid
         AND att.attnum = key.attnum
      ) = ARRAY['day_order', 'program_id']::name[]
  ) THEN
    ALTER TABLE public.program_days
      ADD CONSTRAINT program_days_program_id_day_order_key
      UNIQUE NULLS NOT DISTINCT (program_id, day_order);
  END IF;
END
$migration$;

COMMIT;
