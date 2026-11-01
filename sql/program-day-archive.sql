-- NOT APPLIED.
-- Do not run this file on production.
-- Adds program_days.archived_at. There is no backfill.
-- NULL means the day is still in the active routine.
-- update_owned_program, in a separate unapplied file, sets this timestamp
-- when a day has workout history and is omitted from an edit.
-- That function keeps the day id and moves day_order to 100000 + n so the
-- active days can be numbered 1..n without replacing
-- program_days_program_id_day_order_key.
-- Sessions keep the same program_day_id. This file does not read or write
-- workout_sessions or workout_sets.
-- Rollback refuses to drop archived_at when any day is archived or any
-- day_order is 100000 or higher. It does not restore a previous day_order.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.program_days
  ADD COLUMN archived_at timestamptz;

COMMIT;
