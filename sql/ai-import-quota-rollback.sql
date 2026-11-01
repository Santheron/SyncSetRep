-- NOT APPLIED. This is not an installation step.
-- Removes the quota objects only.
-- Does not drop programs, days, exercises, history, or a rest_seconds column.

BEGIN;

DROP FUNCTION IF EXISTS public.consume_ai_import_quota(text);
DROP FUNCTION IF EXISTS public.consume_ai_import_quota();
DROP TABLE IF EXISTS public.ai_import_attempts;

COMMIT;
