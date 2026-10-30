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

Check permissions before deciding to continue or roll back. Run `sql/routine-write-step-precheck.sql` and require the mask for the last file that committed. That file reads `has_function_privilege` for `anon`, `authenticated`, `service_role`, and `public`. Do not execute the functions. Re-read the history snapshot. Counts stay equal to the snapshot taken immediately before `sql/load-mode.sql`. Fingerprints stay equal to the last recorded value for every table the failed or committed file did not alter. A table that gained a column gets one new fingerprint, and every value in that new column stays null. If the step check raises, a count changes, an unaffected fingerprint changes, or a new column is non-null, stop the next file and follow Unexpected counts and fingerprints. That difference needs an investigation before anyone calls it data loss.

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

## History snapshot

Run this read-only query before `sql/load-mode.sql`, and again after each schema file. It does not call any function. The session settings are the settings that produced the 2026-10-29 fingerprints.

```sql
BEGIN;

SET LOCAL default_transaction_read_only = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL datestyle = 'ISO, MDY';
SET LOCAL extra_float_digits = 1;
SET LOCAL bytea_output = 'hex';

SELECT
  (SELECT count(*)::integer FROM public.workout_sessions WHERE finished_at IS NOT NULL) AS finished_sessions,
  (SELECT count(*)::integer FROM public.workout_sets) AS workout_sets,
  (SELECT count(*)::integer FROM public.programs WHERE is_active) AS active_programs,
  (SELECT count(*)::integer FROM public.programs WHERE NOT is_active) AS inactive_programs,
  (SELECT count(*)::integer FROM public.program_days) AS program_days,
  (SELECT count(*)::integer FROM public.program_exercises) AS program_exercises,
  (SELECT count(*)::integer FROM public.exercises) AS exercises,
  (SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')) FROM public.workout_sessions s) AS sessions_fingerprint,
  (SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')) FROM public.workout_sets s) AS sets_fingerprint,
  (SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')) FROM public.programs s) AS programs_fingerprint,
  (SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')) FROM public.program_days s) AS program_days_fingerprint,
  (SELECT md5(COALESCE(string_agg(row_to_json(s)::text, ',' ORDER BY s.id), '')) FROM public.program_exercises s) AS program_exercises_fingerprint;

COMMIT;
```

`row_to_json` includes every column. After a file adds a column, that table's fingerprint changes once. The new values are null, so the change is the column itself. Record the new fingerprint and require every later file to reproduce it. `workout_sessions` and `programs` gain no columns in this window, so their fingerprints stay on the pre-install snapshot for the whole window.

The 2026-10-29 comparison target is 30 finished sessions, 471 sets, 1 active program, 0 inactive programs, 5 program days, 27 program exercises, and 27 exercises. Its hashes were sessions `493fb5410117b8c21bdf889dfb4a2ff6`, sets `07760919db4138a0e91c4fb110f5696f`, programs `25ab74a046240dd3edb1fb2aafc933bb`, program days `2cc75fb013e74313c15e06d57fe9c3fe`, and program exercises `90aff33890119d3aa04472f3612260bd`. A higher count is allowed only when the workouts logged after 2026-10-29 11:44 explain it. A lower count stops the window.

## Privilege listing

Run this read-only query after each schema file. It lists only functions whose names this window creates. Every returned row must have one signature and all four EXECUTE columns false. A name that is not installed yet returns no row. Two rows for one name is an overload: stop.

```sql
BEGIN;

SET LOCAL default_transaction_read_only = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

SELECT proc.proname,
       pg_catalog.pg_get_function_identity_arguments(proc.oid) AS identity_arguments,
       has_function_privilege('anon', proc.oid, 'EXECUTE') AS anon_execute,
       has_function_privilege('authenticated', proc.oid, 'EXECUTE') AS authenticated_execute,
       has_function_privilege('service_role', proc.oid, 'EXECUTE') AS service_role_execute,
       has_function_privilege('public', proc.oid, 'EXECUTE') AS public_execute
FROM pg_catalog.pg_proc proc
WHERE proc.pronamespace = 'public'::regnamespace
  AND proc.proname IN (
    'record_tracked_set',
    'create_custom_exercise',
    'update_owned_program',
    'save_manual_program',
    'normalize_exercise_name',
    'seed_standard_exercises',
    'resolve_routine_exercise',
    'routine_write_days',
    'routine_normalize_days',
    'routine_require_int'
  )
ORDER BY proc.proname, proc.oid;

COMMIT;
```

Expected rows:

| After file | `identity_arguments` values, one row each, all four EXECUTE columns false |
| --- | --- |
| `sql/load-mode.sql` | `p_session_id bigint, p_exercise_id bigint, p_set_number integer, p_load_mode text, p_weight numeric, p_assistance numeric, p_weight_unit text, p_reps integer, p_rir integer, p_is_completed boolean` for `record_tracked_set` |
| `sql/program-day-archive.sql` | The same single `record_tracked_set` row |
| `sql/exercise-ownership.sql` | That row, plus `p_name text` for both `create_custom_exercise` and `normalize_exercise_name`, and `p_items jsonb` for `seed_standard_exercises` |
| `sql/routine-edit.sql` | Those four, plus `p_uid uuid, p_item jsonb` for `resolve_routine_exercise`, `p_days jsonb, p_allow_day_id boolean` for `routine_normalize_days`, `p_text text, p_min integer, p_max integer, p_error text` for `routine_require_int`, `p_uid uuid, p_program_id bigint, p_days jsonb, p_replace boolean` for `routine_write_days`, and `p_program jsonb` for both `save_manual_program` and `update_owned_program` |

Argument names come from the function definitions. `has_function_privilege` uses the function oid, so a different displayed argument name still refers to the same signature. The step precheck and the full precheck identify signatures by type list, without argument names.

## Maintenance window

Open this window before the pre-install snapshot and keep it through the last read-only check, or until the rollout stops. Keep it short. The backup, the disposable restore, the baseline, and the four schema files run one after another. Do not leave a committed schema file waiting overnight for the next file.

For the whole window:

- Do not start a workout, add a set, finish a session, or discard a session.
- Do not add, rename, reorder, remove, or edit a routine day or exercise.
- Leave an unfinished session unfinished, with no new sets.
- Keep the eight phone flags false.

The current app can still write `workout_sessions` and `workout_sets` through its existing save path. The flags do not close that path. The window is the control that keeps the history snapshot stable.

## Backup verification

Run `C:\Users\rafae\SyncSetRep-backups\Backup-SyncSetRep.ps1` after the pre-install snapshot. Use port 5432 for the remote read. Do not use port 6543. The script reads the hosted database with `pg_dump` and restores only into `127.0.0.1` database `syncsetrep_restore_test`. `DROP DATABASE`, `CREATE DATABASE`, and `pg_restore` in that script are limited to that local database. Do not run `pg_restore` against the hosted database. Do not use `pg_restore --clean` against it. Leave `syncsetrep-full-20261029-114444.dump` in place. The new dump is a separate file.

File size is written to the manifest and does not approve the backup. The 2026-10-29 dump is 438910 bytes. A smaller new file is a reason to look at the archive check, not a size rule that passes the backup by itself.

Archive integrity is `pg_restore --list` on the local dump file. The script runs that command before it restores any rows. Approval of the archive requires all of these:

- `pg_restore --list` exits 0.
- The file header is the custom-format marker `PGDMP`.
- The manifest says `required_entries_present` true.
- The list contains `TABLE` and `TABLE DATA` for `public` `exercises`, `programs`, `program_days`, `program_exercises`, `workout_sessions`, and `workout_sets`.
- The list contains `SCHEMA - auth`, `TABLE auth users`, and `TABLE DATA auth users`.
- A missing `SCHEMA - public` line is accepted. `pg_dump` 17 omits it when `public` already exists and its owner is `pg_database_owner`.

The script stops before the restore when `pg_restore` cannot read the archive or a required entry is missing. That result does not approve the backup.

Disposable restore verification uses the same script and the same local database. Read the new manifest next to the dump. `local_host` must be `127.0.0.1` and `local_database` must be `syncsetrep_restore_test`. Compare `actual_fingerprints` and `counts` with the pre-install snapshot, including the exercises count. Also require `required_set_columns` 4, `exercises` greater than 0, and `null_exercise_id`, `null_workout_session_id`, `unknown_exercise`, and `unknown_session` all 0. Those four set columns are `exercise_id`, `weight`, `reps`, and `workout_session_id`. Null weights and null reps can remain. They are historical values.

`complete_database_restore` with full `pg_restore` exit 0 approves the backup when that comparison matches. A non-zero full restore is the result already seen on stock PostgreSQL 17, because the archive contains Supabase-managed roles, schemas, and extensions. The 2026-10-29 dump was classified `partial_public_schema_restore` with script exit 3. A new dump can follow that same path. Approve it when the public-schema reload's manifest actuals match the pre-install snapshot and the relationship numbers above are healthy. `complete_database_restored` can stay false for that path.

The script still scores those restored rows against the 2026-10-29 constants: 30 finished sessions, 471 sets, 1 active program, 0 inactive programs, 5 program days, 27 program exercises, and the five hashes from that day. Workouts saved after 2026-10-29 11:44 make `counts_match_baseline` and `fingerprints_match` false. The script then exits 1 with `verification_failed` even though the local public tables loaded. Read `actual_fingerprints` and `counts` in the manifest. When they equal the pre-install snapshot and the relationship numbers are healthy, the archive and the disposable restore are approved. When they differ from the pre-install snapshot, stop and follow Unexpected counts and fingerprints. A script exit of 1 against the old constants is a baseline mismatch to investigate. It does not by itself mean the hosted rows were lost.

To recheck a completed dump without contacting Supabase, run the script with `-ExistingDump` and the new `.dump` path. That run still replaces only `syncsetrep_restore_test` on `127.0.0.1`.

## Unexpected counts and fingerprints

Stop the next schema file. Leave every committed file as it is. Do not roll back in order to chase a count. Do not delete rows. Do not restore a dump onto the hosted database.

The four schema files add columns or functions. They do not delete workout history, and they do not rewrite `workout_sets.weight`. A count that moves during the window is activity to identify, or a query to repeat. It is not an automatic finding of data loss.

1. Run the history snapshot again with the same `SET LOCAL` settings. When the second read matches the last accepted snapshot, continue. The first difference did not stay.
2. When one fingerprint changes, the count for that table stays the same, and the current file added a column to that table, record the new fingerprint. Every value in the new column stays null. The other fingerprints stay on their last accepted values.
3. When a fingerprint changes, the count stays the same, and the current file did not add a column to that table, confirm the session settings: time zone `UTC`, DateStyle `ISO, MDY`, `extra_float_digits` 1, and `bytea_output` `hex`. Those settings are part of the hash. A second read with the settings above is the one that counts.
4. When a count is higher, inspect the newest ids and timestamps in the SQL Editor: `workout_sessions.id` and `finished_at`, `workout_sets.id` and `created_at`, and `program_days.id` with `day_order`. Keep the row text in the editor. When that activity is a workout or routine edit from this window, save the new snapshot and use it for the remaining files. When the operator did not log or edit during the window, stop.
5. When a count is lower, or a fingerprint still differs after the settings check, stop the rollout. Compare the hosted snapshot with the disposable restore manifest. A hosted snapshot that matches the restore means the hosted rows still match the backup, and the surprise came after the dump. A hosted snapshot that differs from both the pre-install snapshot and the restore needs review before another schema file. Confirm that the query is the history snapshot, that the role is the same SQL Editor role, and that the connection is the hosted database. A lower count from the wrong database or a different session setting is a bad comparison, not a deleted history.

## Production rollout checklist

This is the review copy. It is not approval to run it. The manual production run of `sql/routine-write-baseline.sql` already returned `routine_write_baseline_ready`. Repeat that file once, after the backup verification and before `sql/load-mode.sql`. Do not run the baseline again after a schema file: the new functions make it raise `routine_write_function_present`.

Apply one file per SQL Editor execution. Each schema file is one `BEGIN` and one `COMMIT`. Wait for that file's read-only checks before opening the next file.

1. Open the maintenance window. Keep it through the last check or until the rollout stops.
2. Run the history snapshot. Record all seven counts and five fingerprints as the pre-install snapshot. A count below the 2026-10-29 baseline, or a fingerprint that differs from those hashes, goes through Unexpected counts and fingerprints before any schema file. A higher count can be workouts saved after 2026-10-29 11:44. Record that explanation. The pre-install snapshot is the target for the rest of the window.
3. Run the backup verification. Approve the dump only when `pg_restore --list` and the disposable `syncsetrep_restore_test` comparison both pass. Do not restore onto the hosted database.
4. Confirm the current production app does not select `load_mode`, `assistance`, `weight_unit`, `archived_at`, or `owner_user_id`. Adding those columns is compatible with that app. Do not run enablement until the archive-aware client is the released app. An enabled `update_owned_program` can park a day at `day_order` 100000 or higher, and the current app would show that day.
5. Keep `IMPORT_ENABLED`, `PERSIST_REST_SECONDS`, `SUBTITLE_REQUIRED`, `ACTIVATION_RPC_ENABLED`, `OWNED_PROGRAM_RPC_ENABLED`, `MANUAL_SAVE_RPC_ENABLED`, `PERSIST_LOAD_MODE`, and `CUSTOM_EXERCISE_WRITES_ENABLED` false.
6. Run `sql/routine-write-baseline.sql` again. The only result must be `routine_write_baseline_ready`. Stop for review if it raises `routine_write_function_present`, `routine_write_overload`, or `routine_write_baseline_differs`. Do not execute the functions. Do not start a schema file until this result is ready.
7. Apply `sql/load-mode.sql`. Then run, in this order, `sql/routine-write-step-precheck.sql`, the privilege listing, the history snapshot, and `sql/routine-write-permission-precheck.sql`. The step result must be `routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=absent:update_owned_program=absent:save_manual_program=absent`. The privilege listing has one row and all four EXECUTE columns false. Counts match the pre-install snapshot. `sessions_fingerprint`, `programs_fingerprint`, and `program_days_fingerprint` match that snapshot. `sets_fingerprint` and `program_exercises_fingerprint` change once; record them. This null check must return zeros:

```sql
BEGIN;
SET LOCAL default_transaction_read_only = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT
  (SELECT count(*)::integer FROM public.workout_sets
    WHERE load_mode IS NOT NULL OR assistance IS NOT NULL OR weight_unit IS NOT NULL) AS set_tracking_values,
  (SELECT count(*)::integer FROM public.program_exercises
    WHERE load_mode IS NOT NULL) AS prescription_tracking_values;
COMMIT;
```

The full precheck must raise `routine_write_signature_missing` and must not return `routine_write_permissions_closed`. Stop or use the matrix before the next file.

8. Apply `sql/program-day-archive.sql`. Run the step precheck, the privilege listing, and the history snapshot. The step result stays the load-mode mask. The privilege listing stays the one `record_tracked_set` row, all EXECUTE columns false. Counts match the pre-install snapshot. `sessions_fingerprint`, `programs_fingerprint`, `sets_fingerprint`, and `program_exercises_fingerprint` match the post-load-mode recording. `program_days_fingerprint` changes once; record it. This check must return `archived_days` 0, `parked_days` 0, and the day-order definition exactly `UNIQUE NULLS NOT DISTINCT (program_id, day_order)`:

```sql
BEGIN;
SET LOCAL default_transaction_read_only = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT
  (SELECT count(*)::integer FROM public.program_days WHERE archived_at IS NOT NULL) AS archived_days,
  (SELECT count(*)::integer FROM public.program_days WHERE day_order >= 100000) AS parked_days,
  (SELECT pg_catalog.pg_get_constraintdef(con.oid)
     FROM pg_catalog.pg_constraint con
    WHERE con.conname = 'program_days_program_id_day_order_key') AS day_order_def;
COMMIT;
```

The full precheck still raises `routine_write_signature_missing`.

9. Apply `sql/exercise-ownership.sql`. The step result must be `routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=closed:update_owned_program=absent:save_manual_program=absent`. The privilege listing has four rows, each with all EXECUTE columns false: `record_tracked_set`, `create_custom_exercise`, `normalize_exercise_name`, and `seed_standard_exercises`. Do not execute the functions. Counts match the pre-install snapshot. All five fingerprints match the post-archive recording. This check must show `custom_owners` 0, exercise foreign key `a`, day foreign key `c`, set foreign key `a`, template foreign key `a`, name key `UNIQUE (name)`, and `select_policy_present` false:

```sql
BEGIN;
SET LOCAL default_transaction_read_only = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SELECT
  (SELECT count(*)::integer FROM public.exercises WHERE owner_user_id IS NOT NULL) AS custom_owners,
  (SELECT con.confdeltype::text FROM pg_catalog.pg_constraint con
    WHERE con.conname = 'program_exercises_exercise_id_fkey') AS exercise_fk_delete,
  (SELECT con.confdeltype::text FROM pg_catalog.pg_constraint con
    WHERE con.conname = 'program_exercises_program_day_id_fkey') AS day_fk_delete,
  (SELECT con.confdeltype::text FROM pg_catalog.pg_constraint con
    WHERE con.conname = 'workout_sets_exercise_id_fkey') AS set_fk_delete,
  (SELECT con.confdeltype::text FROM pg_catalog.pg_constraint con
    WHERE con.conname = 'program_template_exercises_exercise_id_fkey') AS template_fk_delete,
  (SELECT pg_catalog.pg_get_constraintdef(con.oid) FROM pg_catalog.pg_constraint con
    WHERE con.conname = 'exercises_name_key') AS exercise_name_key,
  EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy pol
    WHERE pol.polrelid = 'public.exercises'::regclass
      AND pol.polname = 'exercises_select_authenticated'
  ) AS select_policy_present;
COMMIT;
```

`a` is NO ACTION. `c` is CASCADE. Authenticated still has `DELETE`, `INSERT`, `REFERENCES`, `SELECT`, `TRIGGER`, `TRUNCATE`, and `UPDATE` on `public.exercises`. The full precheck still raises `routine_write_signature_missing`.

10. Apply `sql/routine-edit.sql`. The step result must be `routine_write_step_closed:record_tracked_set=closed:create_custom_exercise=closed:update_owned_program=closed:save_manual_program=closed`. The privilege listing has one row for each of the ten names, and every EXECUTE column is false. Run `sql/routine-write-permission-precheck.sql`. The only result must be `routine_write_permissions_closed`. That precheck is the catalog proof that `anon`, `authenticated`, `service_role`, and `public` cannot execute the four write RPCs or their helpers. Do not execute the functions. Counts match the pre-install snapshot. All five fingerprints match the post-archive recording. Day order stays `UNIQUE NULLS NOT DISTINCT (program_id, day_order)`. The day foreign key stays `c`. `workout_sets_exercise_id_fkey` and `program_template_exercises_exercise_id_fkey` stay `a`. `set_tracking_values`, `prescription_tracking_values`, `archived_days`, `parked_days`, and `custom_owners` stay 0.
11. Stop. The schema window is complete only when step 10's full precheck returns `routine_write_permissions_closed`. Do not apply `sql/routine-write-enablement.sql` in this window. Enablement, phone flags, activation, starter changes, Edge Functions, and EAS builds require separate approvals. Write RPC permissions stay closed: the four schema files revoke `PUBLIC`, `anon`, `authenticated`, and `service_role`, and none of them grants `EXECUTE`.

Denied-call proof stays in `scripts/verify-routine-edit.mts` on disposable PostgreSQL. Do not repeat those calls in production.
