-- NOT APPLIED.
-- Rollback for sql/routine-edit.sql. Do not run this file on production.
-- Drops the routine edit and manual save functions only.
-- Does not change programs, days, exercises, sessions, or sets.
-- Does not restore a day_order that update_owned_program moved while archiving.
-- Roll this file back before sql/exercise-ownership-rollback.sql.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP FUNCTION IF EXISTS public.update_owned_program(jsonb);
DROP FUNCTION IF EXISTS public.save_manual_program(jsonb);
DROP FUNCTION IF EXISTS public.routine_write_days(uuid, bigint, jsonb, boolean);
DROP FUNCTION IF EXISTS public.resolve_routine_exercise(uuid, jsonb);
DROP FUNCTION IF EXISTS public.routine_normalize_days(jsonb, boolean);
DROP FUNCTION IF EXISTS public.routine_require_int(text, integer, integer, text);

COMMIT;
