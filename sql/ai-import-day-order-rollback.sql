-- NOT APPLIED. This is not an installation step.
-- Restores one table-wide unique day_order.
-- Refuses when any day_order value is used by more than one row, including two saved programs
-- that both have day 1. It does not delete, renumber, or rewrite days to make that possible.
-- A refused run leaves the per-program constraint in place.
-- The restored constraint is named program_days_day_order_key. The original production name is not preserved.

BEGIN;

DO $rollback$
DECLARE
  shared_day_orders integer;
  constraint_name text;
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

  FOR constraint_name IN
    SELECT con.conname
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
  LOOP
    EXECUTE format(
      'ALTER TABLE public.program_days DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
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
  ) THEN
    ALTER TABLE public.program_days
      ADD CONSTRAINT program_days_day_order_key
      UNIQUE (day_order);
  END IF;
END
$rollback$;

COMMIT;
