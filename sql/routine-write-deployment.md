# Routine write deployment

This checklist is local preparation. It is not approval to run it. The phone flags stay false.

In scope:

- `sql/load-mode.sql`
- `sql/program-day-archive.sql`
- `sql/exercise-ownership.sql`
- `sql/routine-edit.sql`
- `sql/routine-write-permission-precheck.sql`
- `sql/routine-write-enablement.sql` only under a later rollout approval

Out of scope: program activation, starter-program changes, AI Edge Functions, and EAS builds. Do not run `sql/program-activation.sql`, `sql/program-activation-privilege.sql`, `sql/program-signup-no-starter.sql`, `sql/program-starter-disable.sql`, or their rollbacks as part of this work. Do not deploy importer functions. Do not publish a build. Do not rerun `sql/ai-import-day-order.sql`, `sql/ai-import-quota.sql`, or `sql/ai-import-save-program.sql`.

## Permission design

PostgreSQL grants `EXECUTE` to `PUBLIC` on every new function. `CREATE OR REPLACE` keeps grants that are already there. A grant to `authenticated` is separate from `PUBLIC`, and another signature of the same name keeps its own grant.

The four schema files revoke `PUBLIC`, `anon`, `authenticated`, and `service_role` after each new function. They do not grant `EXECUTE` back. That revoke is per signature. It clears the default `PUBLIC` grant, a direct grant, and a grant that default privileges add for `anon`, `authenticated`, or `service_role`. `REVOKE` from `PUBLIC` does not remove a direct grant to `authenticated`. `CREATE OR REPLACE` keeps the grants already stored. Another signature of the same name keeps its own grant, and the precheck rejects a name that has more than one signature. Helper functions stay revoked. `sql/routine-write-enablement.sql` later revokes those same roles on the four write signatures and then grants `authenticated` only:

- `record_tracked_set(bigint, bigint, integer, text, numeric, numeric, text, integer, integer, boolean)`
- `create_custom_exercise(text)`
- `update_owned_program(jsonb)`
- `save_manual_program(jsonb)`

It does not grant `anon`, `PUBLIC`, or `service_role`. The table owner can still execute the functions. Re-running a schema file fails on `ADD COLUMN` and rolls back, so that failure does not remove a rollout grant. Do not skip the column changes and run a schema file again: its revoke would remove the grant.

`sql/routine-write-permission-precheck.sql` is read-only. It fails unless each expected name has one signature and `anon`, `authenticated`, `service_role`, and `PUBLIC` cannot execute any of those functions.

## Forward-fix recovery

If real data has been stored, do not force a blocked rollback and do not delete rows to make it pass.

- `load_mode_rollback_blocked`: a set or prescription has `load_mode`, `assistance`, or `weight_unit`. Leave the columns. A stored weight stays on `workout_sets.weight`.
- `exercise_owner_rollback_blocked`: a custom exercise has `owner_user_id`. Leave the column. Do not delete the exercise or its routine rows.
- `archive_order_rollback_blocked`: a day is archived or its `day_order` is 100000 or higher. The original order was not stored. Leave `archived_at` and the parked order. Sessions keep the same day id.

Stop new writes with `sql/routine-write-enablement-rollback.sql`. That file revokes `EXECUTE` only. Then fix forward with a new reviewed migration that preserves the stored rows. Do not edit finished workout history to unlock a rollback.

## Ordered checklist

1. Take a fresh backup with `C:\Users\rafae\SyncSetRep-backups\Backup-SyncSetRep.ps1`. Do not restore it onto the hosted database.
2. Record live counts for finished `workout_sessions`, `workout_sets`, active and inactive `programs`, `program_days`, `program_exercises`, and `exercises`. The 2026-10-29 baseline was 30 finished sessions, 471 sets, 1 active program, 0 inactive programs, 5 program days, 27 program exercises, and 27 exercises. Stop if the new counts are not an explained continuation of that baseline. The hashed baseline was sessions `493fb5410117b8c21bdf889dfb4a2ff6`, sets `07760919db4138a0e91c4fb110f5696f`, programs `25ab74a046240dd3edb1fb2aafc933bb`, program days `2cc75fb013e74313c15e06d57fe9c3fe`, and program exercises `90aff33890119d3aa04472f3612260bd`.
3. Confirm the current production app does not select `load_mode`, `assistance`, `weight_unit`, `archived_at`, or `owner_user_id`. Adding those columns is compatible with that app. Do not run enablement until the archive-aware client is the released app. An enabled `update_owned_program` can park a day at `day_order` 100000 or higher, and the current app would show that day.
4. Keep `IMPORT_ENABLED`, `PERSIST_REST_SECONDS`, `SUBTITLE_REQUIRED`, `ACTIVATION_RPC_ENABLED`, `OWNED_PROGRAM_RPC_ENABLED`, `MANUAL_SAVE_RPC_ENABLED`, `PERSIST_LOAD_MODE`, and `CUSTOM_EXERCISE_WRITES_ENABLED` false.
5. Apply, in one reviewed window and in this order: `sql/load-mode.sql`, `sql/program-day-archive.sql`, `sql/exercise-ownership.sql`, `sql/routine-edit.sql`. Do not apply `sql/routine-write-enablement.sql` in that window.
6. Run `sql/routine-write-permission-precheck.sql`. The only result must be `routine_write_permissions_closed`. Also call each write RPC as `anon`, `authenticated`, and `service_role` and confirm `permission denied` with no new row.
7. Re-read the day-order constraint, `exercises_name_key`, exercise grants, and the four foreign keys. Day order stays `program_days_program_id_day_order_key` / `UNIQUE NULLS NOT DISTINCT (program_id, day_order)`. The name key stays. Authenticated keeps `DELETE`, `INSERT`, `SELECT`, `UPDATE`, `REFERENCES`, `TRIGGER`, and `TRUNCATE` on `exercises`. `program_exercises_exercise_id_fkey` is `NO ACTION` after the ownership file. The day foreign key stays `ON DELETE CASCADE`. `workout_sets` and `program_template_exercises` still do not cascade. History counts and fingerprints stay at the step 2 values.
8. Stop. Enablement, phone flags, activation, starter changes, Edge Functions, and EAS builds require separate approvals.
