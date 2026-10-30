# Routine write deployment

This checklist is local preparation. It is not approval to run it. The phone flags stay false.

In scope:

- `sql/load-mode.sql`
- `sql/program-day-archive.sql`
- `sql/exercise-ownership.sql`
- `sql/routine-edit.sql`
- `sql/routine-write-baseline.sql` before any schema file
- `sql/routine-write-step-precheck.sql` after each schema file
- `sql/routine-write-permission-precheck.sql` after all four schema files
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

`sql/routine-write-step-precheck.sql` is the read-only check after each schema file. A missing write RPC is reported as `absent`. An installed write RPC is reported as `closed` only when `anon`, `authenticated`, `service_role`, and `PUBLIC` cannot execute it. An unexpected signature raises `routine_write_overload`. An installed EXECUTE grant raises `routine_write_permission_open`. That result is not proof that the install is complete.

`sql/routine-write-permission-precheck.sql` is read-only and runs only after all four schema files. It fails unless every expected signature exists, each expected name has one signature, and `anon`, `authenticated`, `service_role`, and `PUBLIC` cannot execute any of them. A missing function raises `routine_write_signature_missing`. It cannot return `routine_write_permissions_closed` in that case.

Each schema file is one transaction: one `BEGIN` and one `COMMIT`. A failed statement rolls that file back. Earlier committed files stay as they were. Do not re-run a file whose objects are already present. `ADD COLUMN` fails on a second run and that attempt rolls back.

## Forward-fix recovery

If real data has been stored, do not force a blocked rollback and do not delete rows to make it pass.

- `load_mode_rollback_blocked`: a set or prescription has `load_mode`, `assistance`, or `weight_unit`. Leave the columns. A stored weight stays on `workout_sets.weight`.
- `exercise_owner_rollback_blocked`: a custom exercise has `owner_user_id`. Leave the column. Do not delete the exercise or its routine rows.
- `archive_order_rollback_blocked`: a day is archived or its `day_order` is 100000 or higher. The original order was not stored. Leave `archived_at` and the parked order. Sessions keep the same day id.

Stop new writes with `sql/routine-write-enablement-rollback.sql`. That file revokes `EXECUTE` only. Then fix forward with a new reviewed migration that preserves the stored rows. Do not edit finished workout history to unlock a rollback.

## Failure-recovery matrix

Check permissions before deciding to continue or roll back. Run `sql/routine-write-step-precheck.sql` and require the mask for the last file that committed. That file reads `has_function_privilege` for `anon`, `authenticated`, `service_role`, and `public`. Do not execute the functions. Re-read the step 2 counts and five fingerprints. They stay unchanged. If the step check raises, or a count or fingerprint changes, stop.

A file that errors before `COMMIT` is not applied. Confirm its columns and functions are absent, then either retry that same file or stop. Do not delete rows to finish a partial file.

| Stop point | Remains applied | Required permission result | Roll back only when | Stop instead of rolling back |
| --- | --- | --- | --- | --- |
| `sql/load-mode.sql` committed, next file not started or its apply failed | Load mode | `routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=absent:update_owned_program=absent:save_manual_program=absent` | Every `workout_sets.load_mode`, `assistance`, and `weight_unit`, and every `program_exercises.load_mode`, is NULL. Then run `sql/load-mode-rollback.sql`. | Any tracking value is non-null. `load_mode_rollback_blocked` drops nothing. Leave the columns. |
| `sql/program-day-archive.sql` committed, ownership not applied | Load mode and archive | Same mask as load mode. `archived_at` exists. | Every `archived_at` is NULL and every `day_order` is below 100000. Run `sql/program-day-archive-rollback.sql`, then the load-mode rule. | `archive_order_rollback_blocked` or `load_mode_rollback_blocked`. Leave the applied columns. |
| `sql/exercise-ownership.sql` committed, routine edit not applied | Load mode, archive, and ownership | `routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=closed:update_owned_program=absent:save_manual_program=absent` | Every `owner_user_id` is NULL. Run `sql/exercise-ownership-rollback.sql`, then the archive rule, then the load-mode rule. | `exercise_owner_rollback_blocked`. That file changes nothing. Do not delete exercises. Also stop if an earlier guard would refuse. |
| `sql/routine-edit.sql` committed, enablement not applied | All four schema files | Step mask with all four write RPCs `closed`, and `sql/routine-write-permission-precheck.sql` returns `routine_write_permissions_closed` | The three data counts below are all zero. `sql/routine-edit-rollback.sql` drops functions only. Then use the ownership, archive, and load-mode rules, in that order. | Any data count is non-zero, or the full precheck is not closed. A grant or overload is fixed by a reviewed revoke or by dropping the unexpected signature. Do not drop columns to clear a grant. |

Before any reverse sequence, read:

- tracking values: `workout_sets` rows with `load_mode`, `assistance`, or `weight_unit` not NULL, plus `program_exercises` rows with `load_mode` not NULL
- archived or parked days: `program_days` rows with `archived_at` not NULL or `day_order` of 100000 or higher
- custom owners: `exercises` rows with `owner_user_id` not NULL

Skip a count when its column is not installed yet. `sql/routine-edit-rollback.sql` does not change rows, so it can still drop its functions after data exists. Do not continue into the ownership, archive, or load-mode rollbacks unless their counts are zero.

If `sql/routine-write-enablement.sql` was applied outside this window, stop and run `sql/routine-write-enablement-rollback.sql`. That revokes `EXECUTE` only. Do not roll the schema back to undo stored rows.

## Production rollout checklist

This is the review copy. It is not approval to run it.

1. Take a fresh backup with `C:\Users\rafae\SyncSetRep-backups\Backup-SyncSetRep.ps1`. Do not restore it onto the hosted database.
2. Record live counts for finished `workout_sessions`, `workout_sets`, active and inactive `programs`, `program_days`, `program_exercises`, and `exercises`. The 2026-10-29 baseline was 30 finished sessions, 471 sets, 1 active program, 0 inactive programs, 5 program days, 27 program exercises, and 27 exercises. Stop if the new counts are not an explained continuation of that baseline. The hashed baseline was sessions `493fb5410117b8c21bdf889dfb4a2ff6`, sets `07760919db4138a0e91c4fb110f5696f`, programs `25ab74a046240dd3edb1fb2aafc933bb`, program days `2cc75fb013e74313c15e06d57fe9c3fe`, and program exercises `90aff33890119d3aa04472f3612260bd`.
3. Confirm the current production app does not select `load_mode`, `assistance`, `weight_unit`, `archived_at`, or `owner_user_id`. Adding those columns is compatible with that app. Do not run enablement until the archive-aware client is the released app. An enabled `update_owned_program` can park a day at `day_order` 100000 or higher, and the current app would show that day.
4. Keep `IMPORT_ENABLED`, `PERSIST_REST_SECONDS`, `SUBTITLE_REQUIRED`, `ACTIVATION_RPC_ENABLED`, `OWNED_PROGRAM_RPC_ENABLED`, `MANUAL_SAVE_RPC_ENABLED`, `PERSIST_LOAD_MODE`, and `CUSTOM_EXERCISE_WRITES_ENABLED` false.
5. Run `sql/routine-write-baseline.sql`. It is read-only. The only result must be `routine_write_baseline_ready`. Stop for review if it raises `routine_write_function_present`, `routine_write_overload`, or `routine_write_baseline_differs`. That check looks for existing target signatures, extra signatures of those names, the `exercises_select_authenticated` policy, user triggers on `exercises`, `program_days`, `program_exercises`, and `workout_sets`, and the verified exercise grants and foreign keys. Do not execute the functions. Do not start a schema file until this result is ready.
6. Apply `sql/load-mode.sql`. Run `sql/routine-write-step-precheck.sql`. The only result must be `routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=absent:update_owned_program=absent:save_manual_program=absent`. `has_function_privilege` for `anon`, `authenticated`, `service_role`, and `public` on `record_tracked_set` must be false. Do not execute the functions. The step 2 counts and five fingerprints stay unchanged. The full permission precheck must raise `routine_write_signature_missing` and must not return `routine_write_permissions_closed`. Stop or use the matrix before the next file.
7. Apply `sql/program-day-archive.sql`. Run the step precheck again. The result stays the load-mode mask. `program_days.archived_at` exists. The step 2 counts and five fingerprints stay unchanged. The full precheck still raises `routine_write_signature_missing`.
8. Apply `sql/exercise-ownership.sql`. The step result must be `routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=closed:update_owned_program=absent:save_manual_program=absent`. `has_function_privilege` must be false for `anon`, `authenticated`, `service_role`, and `public` on both installed write signatures. Do not execute the functions. `program_exercises_exercise_id_fkey` is `NO ACTION`. `exercises_name_key` stays `UNIQUE (name)`. Authenticated keeps `DELETE`, `INSERT`, `SELECT`, `UPDATE`, `REFERENCES`, `TRIGGER`, and `TRUNCATE` on `exercises`. The step 2 counts and five fingerprints stay unchanged. The full precheck still raises `routine_write_signature_missing`.
9. Apply `sql/routine-edit.sql`. The step result must be `routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=closed:update_owned_program=closed:save_manual_program=closed`. Run `sql/routine-write-permission-precheck.sql`. The only result must be `routine_write_permissions_closed`. That precheck is the catalog proof that `anon`, `authenticated`, `service_role`, and `public` cannot execute the four write RPCs or their helpers. Do not execute the functions. Day order stays `program_days_program_id_day_order_key` / `UNIQUE NULLS NOT DISTINCT (program_id, day_order)`. The day foreign key stays `ON DELETE CASCADE`. `workout_sets.exercise_id` and `program_template_exercises.exercise_id` still do not cascade. The step 2 counts and five fingerprints stay unchanged.
10. Stop. Do not apply `sql/routine-write-enablement.sql` in this window. Enablement, phone flags, activation, starter changes, Edge Functions, and EAS builds require separate approvals.

Denied-call proof stays in `scripts/verify-routine-edit.mts` on disposable PostgreSQL. Do not repeat those calls in production.
