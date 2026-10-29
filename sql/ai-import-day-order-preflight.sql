-- Read-only preflight for per-program day numbers.
-- One SELECT. It does not create, alter, drop, insert, update, delete, grant, or revoke.
-- Run this file alone, before sql/ai-import-day-order.sql.
-- Expected before that migration: duplicate_groups = 0 and null_day_orders = 0.

SELECT jsonb_pretty(
  jsonb_build_object(
    'duplicate_groups', (
      SELECT count(*)::int
      FROM (
        SELECT program_id, day_order
        FROM public.program_days
        GROUP BY program_id, day_order
        HAVING count(*) > 1
      ) duplicates
    ),
    'duplicate_rows', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'program_id', program_id,
          'day_order', day_order,
          'rows', rows
        )
        ORDER BY program_id, day_order
      )
      FROM (
        SELECT program_id, day_order, count(*)::int AS rows
        FROM public.program_days
        GROUP BY program_id, day_order
        HAVING count(*) > 1
      ) duplicates
    ), '[]'::jsonb),
    'null_program_ids', (
      SELECT count(*)::int
      FROM public.program_days
      WHERE program_id IS NULL
    ),
    'null_day_orders', (
      SELECT count(*)::int
      FROM public.program_days
      WHERE day_order IS NULL
    ),
    'unique_constraints', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'name', con.conname,
          'definition', pg_get_constraintdef(con.oid)
        )
        ORDER BY con.conname
      )
      FROM pg_constraint con
      WHERE con.conrelid = 'public.program_days'::regclass
        AND con.contype IN ('u', 'p')
    ), '[]'::jsonb)
  )
) AS day_order_preflight;
