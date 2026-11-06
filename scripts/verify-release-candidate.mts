import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { RELEASE_CANDIDATE_FEATURES_ENABLED } from '../lib/release-candidate.ts';
import { IMPORT_ENABLED, PERSIST_REST_SECONDS, SUBTITLE_REQUIRED } from '../lib/import/flags.ts';
import {
  ACTIVATION_RPC_ENABLED,
  MANUAL_SAVE_RPC_ENABLED,
  OWNED_PROGRAM_EDIT_ENABLED,
  OWNED_PROGRAM_RPC_ENABLED,
} from '../lib/import/manual-program-client.ts';
import { CUSTOM_EXERCISE_WRITES_ENABLED } from '../lib/import/planned-exercises.ts';
import { PERSIST_LOAD_MODE } from '../lib/load-mode.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const installedCommit = 'efac4b5ad2a58cc885a2a8b34c8dab4781814286';

const flagNames = [
  'IMPORT_ENABLED',
  'PERSIST_REST_SECONDS',
  'SUBTITLE_REQUIRED',
  'PERSIST_LOAD_MODE',
  'MANUAL_SAVE_RPC_ENABLED',
  'OWNED_PROGRAM_RPC_ENABLED',
  'OWNED_PROGRAM_EDIT_ENABLED',
  'ACTIVATION_RPC_ENABLED',
  'CUSTOM_EXERCISE_WRITES_ENABLED',
] as const;

type FlagName = (typeof flagNames)[number];
type FlagState = Record<FlagName, boolean>;

function source(name: string): string {
  return readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
}

function flagsFromModules(): FlagState {
  return {
    IMPORT_ENABLED,
    PERSIST_REST_SECONDS,
    SUBTITLE_REQUIRED,
    PERSIST_LOAD_MODE,
    MANUAL_SAVE_RPC_ENABLED,
    OWNED_PROGRAM_RPC_ENABLED,
    OWNED_PROGRAM_EDIT_ENABLED,
    ACTIVATION_RPC_ENABLED,
    CUSTOM_EXERCISE_WRITES_ENABLED,
  };
}

if (process.argv[2] === '--print-flags') {
  process.stdout.write(`${JSON.stringify(flagsFromModules())}\n`);
  process.exit(0);
}

function runFlags(rc: string | undefined): Promise<FlagState> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (rc === undefined) {
      delete env.EXPO_PUBLIC_SYNCSETREP_RC;
    } else {
      env.EXPO_PUBLIC_SYNCSETREP_RC = rc;
    }
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', fileURLToPath(import.meta.url), '--print-flags'],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (status) => {
      if (status !== 0) {
        reject(new Error(`flag process exited ${status}: ${stderr}`));
        return;
      }
      resolve(JSON.parse(stdout) as FlagState);
    });
  });
}

function expectAll(state: FlagState, enabled: boolean) {
  for (const name of flagNames) {
    assert.equal(state[name], enabled, name);
  }
}

assert.notEqual(process.env.EXPO_PUBLIC_SYNCSETREP_RC, '1');
assert.equal(RELEASE_CANDIDATE_FEATURES_ENABLED, false);
expectAll(flagsFromModules(), false);

const unsetFlags = await runFlags(undefined);
const enabledFlags = await runFlags('1');
const wordFlags = await runFlags('true');
const zeroFlags = await runFlags('0');
expectAll(unsetFlags, false);
expectAll(enabledFlags, true);
expectAll(wordFlags, false);
expectAll(zeroFlags, false);

const releaseSource = source('lib/release-candidate.ts');
assert.equal(releaseSource.includes("process.env.EXPO_PUBLIC_SYNCSETREP_RC === '1'"), true);
assert.equal(releaseSource.includes('process.env['), false);
assert.equal(/const\s*\{[^}]*EXPO_PUBLIC_SYNCSETREP_RC/.test(releaseSource), false);

const assignments: Record<FlagName, string> = {
  IMPORT_ENABLED: source('lib/import/flags.ts'),
  PERSIST_REST_SECONDS: source('lib/import/flags.ts'),
  SUBTITLE_REQUIRED: source('lib/import/flags.ts'),
  PERSIST_LOAD_MODE: source('lib/load-mode.ts'),
  MANUAL_SAVE_RPC_ENABLED: source('lib/import/manual-program-client.ts'),
  OWNED_PROGRAM_RPC_ENABLED: source('lib/import/manual-program-client.ts'),
  OWNED_PROGRAM_EDIT_ENABLED: source('lib/import/manual-program-client.ts'),
  ACTIVATION_RPC_ENABLED: source('lib/import/manual-program-client.ts'),
  CUSTOM_EXERCISE_WRITES_ENABLED: source('lib/import/planned-exercises.ts'),
};
for (const name of flagNames) {
  assert.equal(
    assignments[name].includes(`export const ${name} = RELEASE_CANDIDATE_FEATURES_ENABLED`),
    true,
    name,
  );
}

const eas = JSON.parse(source('eas.json')) as {
  build: Record<string, { distribution?: string; autoIncrement?: boolean; android?: { buildType?: string }; env?: Record<string, string> }>;
};
const profileNames = Object.keys(eas.build);
assert.deepEqual(profileNames.sort(), ['development', 'preview', 'production', 'release-candidate']);
for (const name of ['development', 'preview', 'production'] as const) {
  assert.equal(Object.prototype.hasOwnProperty.call(eas.build[name].env ?? {}, 'EXPO_PUBLIC_SYNCSETREP_RC'), false, name);
}
const candidate = eas.build['release-candidate'];
assert.equal(candidate.distribution, 'internal');
assert.equal(candidate.android?.buildType, 'apk');
assert.equal(candidate.autoIncrement, true);
assert.equal(candidate.env?.APP_VARIANT, 'production');
assert.equal(candidate.env?.EXPO_PUBLIC_SYNCSETREP_RC, '1');
assert.equal(eas.build.production.env?.APP_VARIANT, 'production');
assert.equal(eas.build.production.autoIncrement, true);
assert.equal(eas.build.development.env?.APP_VARIANT, 'development');

const appConfig = source('app.config.ts');
assert.equal(appConfig.includes("process.env.APP_VARIANT === 'development'"), true);
assert.equal(appConfig.includes("'com.akagi253.workouttracker.dev'"), true);
assert.equal(appConfig.includes("'com.akagi253.workouttracker'"), true);
assert.equal(appConfig.includes('EXPO_PUBLIC_SYNCSETREP_RC'), false);

for (const name of ['.env', '.env.local', '.env.development', '.env.production', '.env.preview']) {
  const path = new URL(`../${name}`, import.meta.url);
  if (!existsSync(path)) {
    continue;
  }
  const text = readFileSync(path, 'utf8');
  assert.equal(/^EXPO_PUBLIC_SYNCSETREP_RC=/m.test(text), false, name);
}

const installedFlags = execFileSync('git', ['show', `${installedCommit}:lib/import/flags.ts`], {
  cwd: root,
  encoding: 'utf8',
});
const installedLoad = execFileSync('git', ['show', `${installedCommit}:lib/load-mode.ts`], {
  cwd: root,
  encoding: 'utf8',
});
const installedClient = execFileSync('git', ['show', `${installedCommit}:lib/import/manual-program-client.ts`], {
  cwd: root,
  encoding: 'utf8',
});
const installedCustom = execFileSync('git', ['show', `${installedCommit}:lib/import/planned-exercises.ts`], {
  cwd: root,
  encoding: 'utf8',
});
for (const name of ['IMPORT_ENABLED', 'PERSIST_REST_SECONDS', 'SUBTITLE_REQUIRED'] as const) {
  assert.equal(installedFlags.includes(`export const ${name} = false`), true, name);
}
assert.equal(installedLoad.includes('export const PERSIST_LOAD_MODE = false'), true);
assert.equal(installedCustom.includes('export const CUSTOM_EXERCISE_WRITES_ENABLED = false'), true);
for (const name of [
  'MANUAL_SAVE_RPC_ENABLED',
  'OWNED_PROGRAM_RPC_ENABLED',
  'OWNED_PROGRAM_EDIT_ENABLED',
  'ACTIVATION_RPC_ENABLED',
] as const) {
  assert.equal(installedClient.includes(`export const ${name} = false`), true, name);
}
assert.equal(installedFlags.includes('EXPO_PUBLIC_SYNCSETREP_RC'), false);

const config = source('supabase/config.toml');
assert.equal(config.includes('project_id = "kbwaxskykqaymzdytjxv"'), true);
const functionSource = source('supabase/functions/import-workout/index.ts');
assert.equal(functionSource.includes("const PROJECT_HOST = 'kbwaxskykqaymzdytjxv.supabase.co'"), true);
assert.equal(functionSource.includes('NOT DEPLOYED'), true);

console.log('release candidate checks passed');
