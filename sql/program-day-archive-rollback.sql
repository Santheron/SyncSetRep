-- NOT APPLIED.
-- Rollback for sql/program-day-archive.sql. Do not run this file on production.
-- Drops program_days.archived_at.
-- Does not restore day_order values. A day moved to 100000 + n while it was
-- archived keeps that day_order after this column is dropped.
-- Does not delete days, sessions, or sets.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.program_days
  DROP COLUMN IF EXISTS archived_at;

COMMIT;
