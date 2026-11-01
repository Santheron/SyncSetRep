# Home PC handoff

This file is the resume point after the 2026-11-01 rest-seconds backup and read-only preflight. `sql/program-exercise-rest.sql` is not applied. Do not apply it, enable a feature flag, deploy the Edge Function, merge, or build an APK until a later explicit approval.

The implementation commit before this document is `efac4b5ad2a58cc885a2a8b34c8dab4781814286`. After this file is committed, the branch tip is the commit that adds this document. On the home PC, use `git rev-parse HEAD` for that SHA.

## Repository

- GitHub: https://github.com/Santheron/SyncSetRep
- Branch: `feature/ai-workout-importer`
- Branch URL: https://github.com/Santheron/SyncSetRep/tree/feature/ai-workout-importer
- Remote: `origin` = `https://github.com/Santheron/SyncSetRep.git`
- Do not merge this branch into `main`.

This repository has no `.github/workflows` directory. EAS builds start only from an explicit `npx eas build` command. SQL lives in `sql/`, not in `supabase/migrations`. The production Supabase GitHub integration for project `kbwaxskykqaymzdytjxv` is connected to a different repository, so a push of this branch does not deploy the app, apply migrations, or deploy Edge Functions.

## Windows PowerShell setup

PowerShell 5.1 does not accept `&&`. Chain commands with `;`.

```powershell
git clone https://github.com/Santheron/SyncSetRep.git
Set-Location SyncSetRep
git checkout feature/ai-workout-importer
git pull
npm install
```

If the repository is already cloned:

```powershell
Set-Location C:\path\to\SyncSetRep
git checkout feature/ai-workout-importer
git pull
npm install
```

Leave `package.json` without `"type": "module"`. Node prints a `MODULE_TYPELESS_PACKAGE_JSON` warning during the checks. That warning is expected.

Git on this PC uses `core.autocrlf`. The working copy can be CRLF while blobs stay LF. Do not reformat line endings as a cleanup.

## Software

- Git
- Node.js 24 and npm 11 were used for the checks below. A current Node 22+ install is enough for the TypeScript checks.
- PostgreSQL 17 client tools, on this PC at `C:\Program Files\PostgreSQL\17\bin`. Production is PostgreSQL 17, so disposable database tests must use client tools from version 17.
- Supabase CLI through `npx supabase` (CLI 2.122.0 was used). `supabase db dump` on Windows requires Docker. Docker is not installed here. Use local `pg_dump` 17 for backups.
- EAS CLI is already used for internal APKs. Do not start a build from the home PC until a later approval.

Disposable PostgreSQL tests create temporary clusters on `127.0.0.1` ports `55432`, `55433`, `55441`, and `55446`. They must not use port `5432` for those clusters and must not use the transaction pooler port `6543`. Do not point them at the hosted database.

Some script checks import `@electric-sql/pglite` from `NODE_PATH`. On this PC that directory is `%TEMP%\pglite-import-test\node_modules`. Install that package into a local `NODE_PATH` directory before expecting the PGlite sections to run. The scripts skip those sections when the package is absent.

## Environment variable names

Create a gitignored `.env` in the repository root. Copy it privately from the office PC. Do not commit it, paste it into chat, or put it in GitHub.

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

These are the only client variables. `lib/supabase.ts` reads them from the environment.

Names that stay unset in the app bundle:

- `XAI_API_KEY` is read only by the undeployed Edge Function `supabase/functions/import-workout/index.ts`. Keep it server-side. Do not place it under `lib/import`.
- `APP_VARIANT` is set by the EAS profiles in `eas.json` (`development`, `preview`, or `production`). It is not required for the local Node checks.
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL`, `DATABASE_URL`, `PGPASSWORD`, `PGHOST`, `PGPORT`, and `PGUSER` are unset. The database password is not stored in the repo, `.env`, or `pgpass`.

Supabase CLI login for the owner account belongs in Windows Credential Manager under the target `Supabase CLI:supabase`. The old file `%USERPROFILE%\.supabase\access-token` is a different account and returns 403 for this project. Do not copy that file to the home PC as the working credential. Sign in with `npx supabase login` on the home PC instead of pasting a token into chat.

Production read-only SQL, when a later step needs it:

```powershell
npx supabase db query --linked --project-ref kbwaxskykqaymzdytjxv --workdir $pwd --file .\sql\routine-write-permission-precheck.sql --output-format json
```

`--linked` writes `supabase/.temp/linked-project.json` with the project reference and name only. That directory is untracked. Do not commit it. Delete the json after the query.

## Completed production migrations

Do not run these again.

Earlier schema window, already installed and verified before this rollout:

- `sql/load-mode.sql`
- `sql/program-day-archive.sql`
- `sql/exercise-ownership.sql`
- `sql/routine-edit.sql`
- `sql/routine-write-baseline.sql` is a prior baseline. Do not rerun it.
- `sql/ai-import-save-program.sql` is the installed `save_imported_program(jsonb)` body. Source md5 `7538f289c3e7678afe60d6c72c6f7a59`.

Applied on 2026-11-01, in this order:

| File | Blob | Result |
| --- | --- | --- |
| `sql/program-signup-no-starter.sql` | `47a17b8541db8bc958ab1a6c54cad4da563e0b64` | Applied. `handle_new_user` source md5 `5ff509fca2f1ac69a246838ac1ace65a`. |
| `sql/program-starter-disable.sql` | `b4c41b7c01ba347b36f58a1ec0e1c6a51dd9767a` | Applied. Both starter functions source md5 `9d2a0cbe94e070158631707875749e6b`. |
| `sql/program-activation.sql` | `aa4fd8f2748748c0b98ffa70969469a2a3e96d78` | Applied. `save_owned_program` md5 `b7932abab5e4ee4ece01e25b4c09e272`. `activate_owned_program` md5 `ff0521fb5679f76a94ba4cdddaf5b6b8`. |
| `sql/program-activation-privilege.sql` | `e22a7191b99578665ec41739a681427dbd81eb93` | Applied and verified. `enforce_program_activation` md5 `677d392087cde86ceaa5744ebe108f99`. Trigger `programs_activation_rpc` is `BEFORE INSERT OR UPDATE` for each row. |

`update_owned_program` source md5 `23db0166c3eca6ff985450224592fd07`. Authenticated and `service_role` cannot execute it.

## Pending work and approval

| Item | Status |
| --- | --- |
| `sql/program-exercise-rest.sql` | Reviewed and disposable-tested. Blob `212c27f59ba0409db193e08ab53a336cec1296c1` on commit `33309a85d94166b393d38ab517c0178f4b7f601e`. Preflight passed. Fresh backup verified. Apply is not approved. |
| `sql/program-exercise-rest-rollback.sql` | Rollback only. It is not an install step. Do not run it unless a later approval says so. |
| `sql/routine-write-enablement.sql` | Not approved. The precheck returns `routine_write_permissions_closed`. |
| Edge Function `import-workout` | Not deployed. |
| Nine feature flags | All false. A later flag change requires a new approved EAS build. |
| APK rebuild, push to `main`, merge, or store release | Not approved. |

The rest-seconds file is one transaction. It adds nullable `program_exercises.rest_seconds integer` with no default, adds check `program_exercises_rest_seconds_range` for null or 0 through 600, and replaces `save_imported_program(jsonb)` as `SECURITY INVOKER` with `search_path = ''`. It has no `GRANT` or `REVOKE`. It does not update existing rows. A second run fails the guard `rest_seconds_already_present`.

## Production baseline

Reconfirmed read-only on 2026-11-01 after the backup below. Session was `postgres`, `transaction_read_only` was on, time zone UTC, datestyle ISO MDY, `extra_float_digits` 1, `bytea_output` hex.

| Count | Value |
| --- | --- |
| Finished sessions | 32 |
| Unfinished sessions | 0 |
| Workout sets | 504 |
| Active programs | 2 |
| Inactive programs | 0 |
| Program days | 10 |
| Program exercises | 54 |
| Exercises | 27 |
| Profiles | 2 |
| Finished sessions before 2026-10-30 10:54:16+00 | 31 |
| Sets before that cutoff | 487 |

Fingerprints:

- Sessions `7d8219f872b14dfebdf2467c799304ab`
- Sets `309d57b45ec1b13f73f422339c5b9879`
- Programs `9cc17ea850a46b10eaa86c9bbe853d8e`
- Program days `2e81346a23a4fdc2259550fc9e0ee29e`
- Program exercises `13d0fd95dd1b0f2e718aab5f860d9022`

`program_exercises.rest_seconds` is absent. Policies hash `2623c201a43d7cc1cf21df029033a17c`. Foreign-key hash `351a0ecdc86095f7850ddc98dc15b7aa`. Public function count is 19. Authenticated table `UPDATE` on `programs` is false. Column `UPDATE` remains only for `name`, `slug`, and `updated_at`.

Backup, local to the office PC and not in Git:

- `C:\Users\rafae\SyncSetRep-backups\dumps\syncsetrep-full-20261101-132003.dump` (505,591 bytes)
- `C:\Users\rafae\SyncSetRep-backups\dumps\syncsetrep-full-20261101-132003.list.txt`

`pg_restore --list` exited 0. The archive includes `TABLE` and `TABLE DATA` for `public.exercises`, `programs`, `program_days`, `program_exercises`, `workout_sessions`, and `workout_sets`, plus `SCHEMA - auth` and `auth.users`. Nothing was restored onto production. Copy that dump privately if the home PC needs it. Do not commit it. Do not score it against the October 29 backup constants. Do not restore it onto the hosted database.

The October 29 and October 30 dumps remain in that same folder and were not overwritten.

## Installed APK and flags

Installed internal production APK:

- App version `1.1.0`
- Android `versionCode` 3
- Package `com.akagi253.workouttracker`
- EAS build `a8a38949-3c40-4981-acd1-740fabe157cf`
- Commit `efac4b5ad2a58cc885a2a8b34c8dab4781814286`
- Profile `production`, distribution internal
- EAS project `@akagi253/workout-tracker`, id `2ed7fbc0-661e-459c-98ce-bb41e27f1de9`

All nine flags are false:

- `IMPORT_ENABLED`, `PERSIST_REST_SECONDS`, and `SUBTITLE_REQUIRED` in `lib/import/flags.ts`
- `PERSIST_LOAD_MODE` in `lib/load-mode.ts`
- `MANUAL_SAVE_RPC_ENABLED`, `OWNED_PROGRAM_RPC_ENABLED`, `OWNED_PROGRAM_EDIT_ENABLED`, and `ACTIVATION_RPC_ENABLED` in `lib/import/manual-program-client.ts`
- `CUSTOM_EXERCISE_WRITES_ENABLED` in `lib/import/planned-exercises.ts`

The installed app can display routines and log workouts while rest seconds stay absent. Routine display does not select `rest_seconds`. Logging writes `workout_sessions` and `workout_sets`.

## Test commands

From the repository root, after `npm install`:

```powershell
npx tsc --noEmit --pretty false
$env:NODE_PATH = "$env:TEMP\pglite-import-test\node_modules"
node --experimental-strip-types scripts/verify-feature-completion.mts
node --experimental-strip-types scripts/verify-flag-paths.mts
node --experimental-strip-types scripts/verify-active-program.mts
node --experimental-strip-types scripts/verify-auth-signup.mts
node --experimental-strip-types scripts/verify-exercise-swap.mts
node --experimental-strip-types scripts/verify-archive-switch.mts
node --experimental-strip-types scripts/verify-history-display.mts
node --experimental-strip-types scripts/verify-manual-program.mts
node --experimental-strip-types scripts/verify-load-mode.mts
node --experimental-strip-types scripts/verify-workout-day-selection.mts
node --experimental-strip-types scripts/verify-workout-import-match.mts
node --experimental-strip-types scripts/verify-workout-import-parse.mts
node --experimental-strip-types scripts/verify-workout-import-pdf-policy.mts
node --experimental-strip-types scripts/verify-workout-import-request.mts
node --experimental-strip-types scripts/verify-workout-import-save-payload.mts
node --experimental-strip-types scripts/verify-workout-import-save.mts
node --experimental-strip-types scripts/verify-workout-import-review.mts
node --experimental-strip-types scripts/verify-program-signup.mts
node --experimental-strip-types scripts/verify-program-activation.mts
node --experimental-strip-types scripts/verify-ai-import-migrations.mts
node --experimental-strip-types scripts/verify-pkce-reset-storage.mjs
node --experimental-strip-types scripts/verify-rest-seconds.mts
node --experimental-strip-types scripts/verify-routine-edit.mts
node --experimental-strip-types scripts/verify-program-activation-concurrency.mts
node --experimental-strip-types scripts/verify-ai-import-quota-concurrency.mts
```

On 2026-11-01 these exited 0. `npx tsc --noEmit --pretty false` exited 0. The PostgreSQL checks printed `rest seconds checks passed`, `routine edit checks passed`, `program activation concurrency checks passed`, and `quota concurrency checks passed on PostgreSQL 17.11`.

`scripts/verify-import-screen-expo.mts` starts Expo and was not repeated for this handoff. The app source matches `efac4b5`, where that check previously passed. Do not run `scripts/probe-program-access.mjs`. It is not part of the local suite.

## Known risks

Authenticated still has `DELETE` on `workout_sessions`. Policy `workout_sessions_delete_own` is `user_id = auth.uid()` and does not require `finished_at`. Authenticated also has `DELETE` on `workout_sets`, `program_days`, `program_exercises`, and `programs`. The installed app's discard path deletes unfinished sessions only. Leave these grants unchanged during rest seconds and routine-write enablement. This is a recorded security follow-up, not an approved change.

`program_exercises` has table-level `UPDATE` for `authenticated`. After `rest_seconds` exists, a direct PostgREST update can set that column. The installed app does not send it. The migration itself writes no rest values. `update_owned_program` still rejects `rest_seconds` and stays non-executable.

`CREATE OR REPLACE` keeps the existing `service_role` execute grant on `save_imported_program`. The rest file does not revoke it.

Adding the nullable column changes the `program_exercises` fingerprint because `row_to_json` includes the new column even when every value is null. The other four fingerprints must stay the same. Immediately after a future apply, the non-null `rest_seconds` count must be 0 and the row count must stay 54.

`ADD COLUMN` takes a short `ACCESS EXCLUSIVE` lock. `lock_timeout` is 5 seconds. A lock failure rolls the transaction back.

Two accounts cannot share one custom exercise name while `exercises_name_key` remains.

Do not call `save_imported_program`, `save_owned_program`, or `activate_owned_program` on production to prove a migration. Do not finish a new workout into history during a migration window. Do not restore a dump onto the hosted database. Do not run `sql/single-user-dev-access.sql`, `sql/program-tables-anon-select.sql`, or `sql/exercise-swap-support.sql`.

## Files left uncommitted on the office PC

- `sql/routine-write-deployment.md` has a local edit that records the earlier four-file schema window. It was left uncommitted because that note still describes activation as future work. This handoff is the current status. The home PC will see the committed version of that note, not the local edit.
- `supabase/.temp/cli-latest` is an untracked CLI cache. Do not commit it.

## Exact next action

On the home PC, clone or pull `feature/ai-workout-importer`, install dependencies, and create the gitignored `.env` from a private copy. Read this file before any production command.

Stop there. The next production change, only after a new explicit approval, is `sql/program-exercise-rest.sql`. Before that approval is used, confirm the office backup above is available on the machine that would apply it, or take a new custom-format PostgreSQL 17 backup outside the repository and verify it with `pg_restore --list`. Do not apply the file in the same step as the pull.
