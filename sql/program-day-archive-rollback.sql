-- NOT APPLIED.
-- Rollback for sql/program-day-archive.sql. Do not run this file on production.
-- Drops program_days.archived_at only when every archived_at is NULL and
-- every day_order is below 100000.
-- A day archived by update_owned_program keeps its id and moves to
-- day_order 100000 + n. This file does not know the earlier day_order.
-- If any day is archived, or any day_order is 100000 or higher, the
-- statement raises archive_order_rollback_blocked and drops nothing.
-- Does not delete days, sessions, or sets.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $archive_guard$
DECLARE
  archived_rows bigint := 0;
  parked_rows bigint := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.program_days'::regclass
      AND attname = 'archived_at'
      AND NOT attisdropped
  ) THEN
    SELECT count(*)
    INTO archived_rows
    FROM public.program_days
    WHERE archived_at IS NOT NULL;

    SELECT count(*)
    INTO parked_rows
    FROM public.program_days
    WHERE day_order >= 100000;

    IF archived_rows > 0 OR parked_rows > 0 THEN
      RAISE EXCEPTION
        'archive_order_rollback_blocked: % archived day(s) and % day(s) with day_order >= 100000. The original day_order was not stored. Dropping archived_at would lose that archive ordering. archived_at was not dropped.',
        archived_rows,
        parked_rows;
    END IF;
  END IF;
END
$archive_guard$;

ALTER TABLE public.program_days
  DROP COLUMN IF EXISTS archived_at;

COMMIT;
