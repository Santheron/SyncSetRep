import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = process.env.PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\17\\bin';
const port = 55432;
const database = 'quota_concurrency_test';
const userA = '11111111-1111-1111-1111-111111111111';
const userB = '22222222-2222-2222-2222-222222222222';
const quotaSqlPath = fileURLToPath(new URL('../sql/ai-import-quota.sql', import.meta.url));

const psqlPath = join(bin, 'psql.exe');
const initdbPath = join(bin, 'initdb.exe');
const pgCtlPath = join(bin, 'pg_ctl.exe');

function run(file: string, args: string[], input?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (status) => resolve({ code: status ?? 1, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

function psql(sql: string, databaseName = database) {
  return run(psqlPath, [
    '-h', '127.0.0.1',
    '-p', String(port),
    '-U', 'postgres',
    '-d', databaseName,
    '-X',
    '-A',
    '-t',
    '-v', 'ON_ERROR_STOP=1',
    '-q',
  ], sql);
}

function consumeSql(userId: string, kind: string) {
  return `
BEGIN;
SELECT set_config('request.jwt.claim.sub', '${userId}', true);
SET LOCAL ROLE authenticated;
SELECT public.consume_ai_import_quota('${kind}');
COMMIT;
`;
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), 'syncsetrep-quota-pg-'));
  const logFile = join(dataDir, 'server.log');
  let started = false;
  try {
    const initialized = await run(initdbPath, [
      '-D', dataDir,
      '-U', 'postgres',
      '--auth=trust',
      '--encoding=UTF8',
      '--no-locale',
    ]);
    assert.equal(initialized.code, 0, initialized.stderr);
    await writeFile(
      join(dataDir, 'postgresql.conf'),
      `\nlisten_addresses = '127.0.0.1'\nport = ${port}\n`,
      { flag: 'a' },
    );
    const startedResult = await run(pgCtlPath, ['-D', dataDir, '-l', logFile, '-w', 'start']);
    assert.equal(startedResult.code, 0, `${startedResult.stderr}\n${await readFile(logFile, 'utf8').catch(() => '')}`);
    started = true;

    const created = await psql(`CREATE DATABASE ${database};`, 'postgres');
    assert.equal(created.code, 0, created.stderr);

    const fixture = await psql(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
      INSERT INTO auth.users (id) VALUES ('${userA}'), ('${userB}');
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
    `);
    assert.equal(fixture.code, 0, fixture.stderr);

    const migration = await psql(await readFile(quotaSqlPath, 'utf8'));
    assert.equal(migration.code, 0, migration.stderr);

    const version = await psql(`SELECT current_setting('server_version');`);
    assert.equal(version.code, 0, version.stderr);
    const timeouts = await psql(`
      SELECT current_setting('lock_timeout') AS lock_timeout,
             current_setting('statement_timeout') AS statement_timeout;
    `);
    assert.equal(timeouts.code, 0, timeouts.stderr);
    assert.match(timeouts.stdout, /0/);
    assert.equal(timeouts.stdout.includes('5s'), false);
    assert.equal(timeouts.stdout.includes('30s'), false);

    const calls = [
      ...Array.from({ length: 8 }, () => consumeSql(userA, 'model')),
      ...Array.from({ length: 8 }, () => consumeSql(userB, 'model')),
    ];
    const results = await Promise.all(calls.map((sql) => psql(sql)));
    const accepted = results.filter((result) => result.code === 0);
    const limited = results.filter((result) => result.code !== 0 && /rate_limited_burst/.test(result.stderr));
    const other = results.filter((result) => result.code !== 0 && !/rate_limited_burst/.test(result.stderr));
    assert.equal(other.length, 0, other.map((result) => result.stderr).join('\n'));
    assert.equal(accepted.length, 4);
    assert.equal(limited.length, 12);

    const counts = await psql(`
      SELECT user_id::text, count(*)
      FROM public.ai_import_attempts
      WHERE kind = 'model'
      GROUP BY user_id
      ORDER BY user_id;
    `);
    assert.equal(counts.code, 0, counts.stderr);
    assert.match(counts.stdout, new RegExp(`${userA}\\s*\\|\\s*2`));
    assert.match(counts.stdout, new RegExp(`${userB}\\s*\\|\\s*2`));

    const holder = spawn(psqlPath, [
      '-h', '127.0.0.1',
      '-p', String(port),
      '-U', 'postgres',
      '-d', database,
      '-X',
      '-v', 'ON_ERROR_STOP=1',
      '-A',
      '-t',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    let holderOut = '';
    let holderErr = '';
    holder.stdout.on('data', (chunk) => {
      holderOut += chunk.toString();
    });
    holder.stderr.on('data', (chunk) => {
      holderErr += chunk.toString();
    });
    const waitFor = async (text: string) => {
      const deadline = Date.now() + 10000;
      while (!holderOut.includes(text)) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for ${text}. stdout=${holderOut} stderr=${holderErr}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    };
    holder.stdin.write(`
      BEGIN;
      SELECT set_config('request.jwt.claim.sub', '${userA}', true);
      SET LOCAL ROLE authenticated;
      SELECT public.consume_ai_import_quota('pdf');
      SELECT 'QUOTA_HOLD_READY';
    `);
    await waitFor('QUOTA_HOLD_READY');
    const duringHold = await psql(`
      SELECT count(*) FROM public.ai_import_attempts WHERE kind = 'pdf';
    `);
    assert.equal(duringHold.code, 0, duringHold.stderr);
    assert.match(duringHold.stdout, /\b0\b/);
    holder.stdin.write(`ROLLBACK;\nSELECT 'QUOTA_ROLLED_BACK';\n`);
    await waitFor('QUOTA_ROLLED_BACK');
    holder.stdin.end();
    const holderExit = await new Promise<number>((resolve, reject) => {
      holder.on('error', reject);
      holder.on('exit', (status) => resolve(status ?? 1));
    });
    assert.equal(holderExit, 0, holderErr);
    const afterRollback = await psql(`
      SELECT count(*) FROM public.ai_import_attempts WHERE kind = 'pdf';
    `);
    assert.equal(afterRollback.code, 0, afterRollback.stderr);
    assert.match(afterRollback.stdout, /\b0\b/);

    const rejected = await psql(consumeSql(userA, 'model'));
    assert.notEqual(rejected.code, 0);
    assert.match(rejected.stderr, /rate_limited_burst/);
    const stillTwo = await psql(`
      SELECT count(*) FROM public.ai_import_attempts
      WHERE user_id = '${userA}' AND kind = 'model';
    `);
    assert.match(stillTwo.stdout, /\b2\b/);

    const privileges = await psql(`
      SELECT
        has_table_privilege('authenticated', 'public.ai_import_attempts', 'SELECT') AS authenticated_select,
        has_table_privilege('authenticated', 'public.ai_import_attempts', 'INSERT') AS authenticated_insert,
        has_table_privilege('authenticated', 'public.ai_import_attempts', 'UPDATE') AS authenticated_update,
        has_table_privilege('authenticated', 'public.ai_import_attempts', 'DELETE') AS authenticated_delete,
        has_table_privilege('authenticated', 'public.ai_import_attempts', 'TRUNCATE') AS authenticated_truncate,
        has_sequence_privilege('authenticated', pg_get_serial_sequence('public.ai_import_attempts', 'id')::regclass, 'USAGE') AS sequence_usage,
        has_sequence_privilege('authenticated', pg_get_serial_sequence('public.ai_import_attempts', 'id')::regclass, 'SELECT') AS sequence_select,
        has_sequence_privilege('authenticated', pg_get_serial_sequence('public.ai_import_attempts', 'id')::regclass, 'UPDATE') AS sequence_update;
    `);
    assert.equal(privileges.code, 0, privileges.stderr);
    assert.match(privileges.stdout, /t\|f\|f\|f\|f\|f\|f\|f/);

    console.log(`quota concurrency checks passed on PostgreSQL ${version.stdout.trim()}`);
  } finally {
    if (started) {
      await run(pgCtlPath, ['-D', dataDir, '-m', 'fast', '-w', 'stop']).catch(() => undefined);
    }
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

await main();
