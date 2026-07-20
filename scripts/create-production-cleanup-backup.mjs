import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';

export const productionProjectRef = 'vbdqjgwcmckutwehrbvo';
export const cleanupBackupProjectRef = 'ynwdsmgfirhqwkvzxzsj';
export const cleanupBackupProvider = 'supabase-project-snapshot';
export const cleanupBackupBucket = 'temporary-attachments';

const managementApi = 'https://api.supabase.com/v1';
const postgresImage = 'postgres@sha256:a426e44bac0b759c95894d68e1a0ac03ecc20b619f498a91aae373bf06d8508d';

function required(name, value = process.env[name]) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function normalizeSessionPoolerUrl(value) {
  const url = new URL(value);
  if (url.port === '6543') url.port = '5432';
  url.search = '';
  return url.toString();
}

export function assertProductionDatabaseUrl(value) {
  const database = new URL(value);
  const direct = database.hostname === `db.${productionProjectRef}.supabase.co` && database.username === 'postgres';
  const pooled = database.hostname.endsWith('.pooler.supabase.com') && database.username === `postgres.${productionProjectRef}`;
  const connectionOptions = [...database.searchParams];
  const safeConnectionOptions = connectionOptions.every(([key, option]) => key === 'sslmode' && ['require', 'verify-full'].includes(option));
  if (!['postgres:', 'postgresql:'].includes(database.protocol)
    || (!direct && !pooled)
    || database.pathname !== '/postgres'
    || !safeConnectionOptions
    || database.hash) {
    throw new Error('SOURCE_DATABASE_URL is not the reviewed production database');
  }
}

export function buildBackupAuditReference(manifest) {
  return `BACKUP_AUDIT:${manifest.createdAt}|${manifest.provider}|${manifest.backupId}|${manifest.releaseSha}`;
}

function postgresTlsOptions(value) {
  return { rejectUnauthorized: new URL(value).searchParams.get('sslmode') !== 'require' };
}

async function managementRequest(token, path, options = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetch(`${managementApi}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...options.headers
      }
    });
    if (response.ok) {
      if (response.status === 204) return null;
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
    if (response.status !== 429 || attempt === 4) {
      throw new Error(`Supabase management request failed (${response.status}) for ${path.split('?')[0]}`);
    }
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfter = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
    const delay = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1_000 : 2 ** attempt * 1_000;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.min(delay, 30_000)));
  }
}

async function resetDatabasePassword(token, password) {
  await managementRequest(token, `/projects/${cleanupBackupProjectRef}/database/password`, {
    method: 'PATCH',
    body: JSON.stringify({ password })
  });
}

async function createTemporaryTargetKey(token, runId) {
  const key = await managementRequest(token, `/projects/${cleanupBackupProjectRef}/api-keys?reveal=true`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'secret',
      name: `backup_copy_${runId}`.slice(0, 64),
      description: 'Ephemeral production cleanup backup key',
      secret_jwt_template: { role: 'service_role' }
    })
  });
  if (!key?.id || !key.api_key) throw new Error('Supabase did not return the temporary target API key');
  return key;
}

async function deleteTargetKey(token, id, wasCompromised = false) {
  await managementRequest(
    token,
    `/projects/${cleanupBackupProjectRef}/api-keys/${id}?was_compromised=${wasCompromised}&reason=cleanup-backup-sealing`,
    { method: 'DELETE' }
  );
}

async function prepareTargetApi(token, temporaryKeyId) {
  const legacy = await managementRequest(token, `/projects/${cleanupBackupProjectRef}/api-keys/legacy`);
  if (legacy?.enabled !== false) {
    await managementRequest(token, `/projects/${cleanupBackupProjectRef}/api-keys/legacy?enabled=false`, { method: 'PUT' });
  }
  const keys = await managementRequest(token, `/projects/${cleanupBackupProjectRef}/api-keys`);
  for (const key of keys ?? []) {
    if (key.type === 'secret' && key.id !== temporaryKeyId) await deleteTargetKey(token, key.id, true);
  }
}

async function assertOnlyTemporaryTargetKey(token, temporaryKeyId) {
  const keys = await managementRequest(token, `/projects/${cleanupBackupProjectRef}/api-keys`);
  const activeSecretKeys = (keys ?? []).filter((key) => key.type === 'secret');
  if (activeSecretKeys.length !== 1 || activeSecretKeys[0].id !== temporaryKeyId) {
    throw new Error('backup target API keys were not sealed before the snapshot');
  }
  const legacy = await managementRequest(token, `/projects/${cleanupBackupProjectRef}/api-keys/legacy`);
  if (legacy?.enabled !== false) throw new Error('backup target legacy API keys remain enabled');
}

async function assertSealedTargetApi(token) {
  const keys = await managementRequest(token, `/projects/${cleanupBackupProjectRef}/api-keys`);
  if ((keys ?? []).some((key) => key.type === 'secret')) throw new Error('backup target still has an active privileged API key');
  const legacy = await managementRequest(token, `/projects/${cleanupBackupProjectRef}/api-keys/legacy`);
  if (legacy?.enabled !== false) throw new Error('backup target legacy API keys remain enabled');
}

export async function sealProductionCleanupBackupTarget() {
  const accessToken = required('SUPABASE_ACCESS_TOKEN');
  const sealedTargetPassword = randomBytes(36).toString('base64url');
  const errors = [];
  let temporaryKey;
  try {
    temporaryKey = await createTemporaryTargetKey(accessToken, `seal_${Date.now()}`);
    await prepareTargetApi(accessToken, temporaryKey.id);
    await deleteTargetKey(accessToken, temporaryKey.id, false);
  } catch (error) { errors.push(error); }
  try { await resetDatabasePassword(accessToken, sealedTargetPassword); } catch (error) { errors.push(error); }
  try { await assertSealedTargetApi(accessToken); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'backup target could not be sealed');
}

async function runDockerPostgres({ directory, environment, script }) {
  await new Promise((accept, reject) => {
    const child = spawn('docker', [
      'run', '--rm',
      '-e', 'SOURCE_DATABASE_URL',
      '-e', 'SOURCE_SNAPSHOT',
      '-e', 'TARGET_DATABASE_URL',
      '-e', 'PGSSLMODE',
      '-v', `${directory}:/backup`,
      postgresImage,
      'sh', '-ceu', script
    ], { env: { ...process.env, PGSSLMODE: 'verify-full', ...environment }, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? accept() : reject(new Error(`PostgreSQL backup container exited with code ${code}`)));
  });
}

async function publicTableCounts(client) {
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const counts = new Map();
  for (const { tablename } of rows) {
    const result = await client.query(`SELECT count(*)::text AS count FROM public.${quoteIdentifier(tablename)}`);
    counts.set(tablename, result.rows[0].count);
  }
  return counts;
}

function assertMatchingCounts(source, target) {
  if (source.size !== target.size) throw new Error('restored public table inventory does not match the source snapshot');
  for (const [table, count] of source) {
    if (target.get(table) !== count) throw new Error(`restored row count does not match for public.${table}`);
  }
}

async function replaceTargetBuckets(source, target) {
  const sourceBucket = await source.storage.getBucket(cleanupBackupBucket);
  if (sourceBucket.error || !sourceBucket.data || sourceBucket.data.public) {
    throw new Error('production temporary attachment bucket is missing or public');
  }

  const targetBuckets = await target.storage.listBuckets();
  if (targetBuckets.error) throw new Error('could not inventory backup target buckets');
  for (const bucket of targetBuckets.data ?? []) {
    let cleanupError;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const emptied = await target.storage.emptyBucket(bucket.id);
      if (emptied.error) {
        cleanupError = emptied.error;
      } else {
        const deleted = await target.storage.deleteBucket(bucket.id);
        if (!deleted.error) {
          cleanupError = undefined;
          break;
        }
        cleanupError = deleted.error;
      }
      if (attempt < 11) await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
    }
    if (cleanupError) {
      const status = 'statusCode' in cleanupError ? cleanupError.statusCode : 'unknown';
      throw new Error(`could not delete an existing backup target bucket (${status})`);
    }
  }

  const created = await target.storage.createBucket(cleanupBackupBucket, {
    public: false,
    fileSizeLimit: sourceBucket.data.file_size_limit ?? undefined,
    allowedMimeTypes: sourceBucket.data.allowed_mime_types ?? undefined
  });
  if (created.error) throw new Error('could not create the private backup target bucket');
}

async function copyAndVerifyObjects({ sourceClient, sourceStorage, targetStorage }) {
  const { rows } = await sourceClient.query(
    `SELECT name, metadata FROM storage.objects WHERE bucket_id = $1 ORDER BY name`,
    [cleanupBackupBucket]
  );
  const aggregate = createHash('sha256');
  let bytes = 0;

  for (const row of rows) {
    const sourceDownload = await sourceStorage.storage.from(cleanupBackupBucket).download(row.name);
    if (sourceDownload.error || !sourceDownload.data) throw new Error('could not download a production private object');
    const sourceBytes = Buffer.from(await sourceDownload.data.arrayBuffer());
    const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
    const uploaded = await targetStorage.storage.from(cleanupBackupBucket).upload(row.name, sourceBytes, {
      contentType: row.metadata?.mimetype ?? 'application/octet-stream',
      upsert: false
    });
    if (uploaded.error) throw new Error('could not upload a private object to the backup target');
    const targetDownload = await targetStorage.storage.from(cleanupBackupBucket).download(row.name);
    if (targetDownload.error || !targetDownload.data) throw new Error('could not verify a private object in the backup target');
    const targetBytes = Buffer.from(await targetDownload.data.arrayBuffer());
    const targetHash = createHash('sha256').update(targetBytes).digest('hex');
    if (targetHash !== sourceHash) throw new Error('private object backup checksum mismatch');
    bytes += sourceBytes.byteLength;
    aggregate.update(row.name).update('\0').update(sourceHash).update('\0').update(String(sourceBytes.byteLength)).update('\0');
  }

  return { objects: rows.length, bytes, aggregateSha256: aggregate.digest('hex') };
}

export async function createProductionCleanupBackup() {
  const accessToken = required('SUPABASE_ACCESS_TOKEN');
  const releaseSha = required('RELEASE_SHA');
  const runId = required('GITHUB_RUN_ID');
  const configuredSourceDatabaseUrl = required('SOURCE_DATABASE_URL');
  assertProductionDatabaseUrl(configuredSourceDatabaseUrl);
  const sourceSslMode = new URL(configuredSourceDatabaseUrl).searchParams.get('sslmode') ?? 'verify-full';
  const sourceDatabaseUrl = normalizeSessionPoolerUrl(configuredSourceDatabaseUrl);
  const sourceSupabaseUrl = required('SOURCE_SUPABASE_URL');
  const sourceServiceRoleKey = required('SOURCE_SUPABASE_SERVICE_ROLE_KEY');
  const targetSupabaseUrl = required('TARGET_SUPABASE_URL');
  const targetDatabaseHost = required('TARGET_DATABASE_HOST');
  const manifestPath = resolve(required('BACKUP_MANIFEST_PATH'));
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error('RELEASE_SHA must be an immutable lowercase commit SHA');
  if (new URL(sourceSupabaseUrl).origin !== `https://${productionProjectRef}.supabase.co`
    || new URL(targetSupabaseUrl).origin !== `https://${cleanupBackupProjectRef}.supabase.co`) {
    throw new Error('cleanup backup source or target project is not the reviewed project');
  }

  const workingDirectory = await mkdtemp(resolve(tmpdir(), 'balance-assist-cleanup-backup-'));
  const initialTargetPassword = randomBytes(36).toString('base64url');
  const sealedTargetPassword = randomBytes(36).toString('base64url');
  let temporaryKey;
  let sourceClient;
  let targetClient;
  let operationError;

  try {
    await resetDatabasePassword(accessToken, initialTargetPassword);
    temporaryKey = await createTemporaryTargetKey(accessToken, runId);
    await prepareTargetApi(accessToken, temporaryKey.id);
    await assertOnlyTemporaryTargetKey(accessToken, temporaryKey.id);

    const targetDatabaseUrl = `postgresql://postgres.${cleanupBackupProjectRef}:${encodeURIComponent(initialTargetPassword)}@${targetDatabaseHost}:5432/postgres`;
    sourceClient = new Client({ connectionString: sourceDatabaseUrl, ssl: postgresTlsOptions(configuredSourceDatabaseUrl) });
    await sourceClient.connect();
    await sourceClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshotResult = await sourceClient.query('SELECT pg_export_snapshot() AS snapshot');
    const sourceSnapshot = snapshotResult.rows[0].snapshot;
    const sourceCounts = await publicTableCounts(sourceClient);
    const dumpPath = resolve(workingDirectory, 'public.dump');

    await runDockerPostgres({
      directory: workingDirectory,
      environment: { SOURCE_DATABASE_URL: sourceDatabaseUrl, SOURCE_SNAPSHOT: sourceSnapshot, PGSSLMODE: sourceSslMode },
      script: 'pg_dump --dbname="$SOURCE_DATABASE_URL" --snapshot="$SOURCE_SNAPSHOT" --schema=public --format=custom --no-owner --no-privileges --file=/backup/public.dump'
    });
    await sourceClient.query('COMMIT');
    await sourceClient.end();
    sourceClient = null;

    await runDockerPostgres({
      directory: workingDirectory,
      environment: { TARGET_DATABASE_URL: targetDatabaseUrl, PGSSLMODE: 'require' },
      script: 'ready=0; for attempt in $(seq 1 12); do if psql "$TARGET_DATABASE_URL" --no-psqlrc --tuples-only --command="SELECT 1" >/dev/null; then ready=1; break; fi; sleep 5; done; test "$ready" = 1; psql "$TARGET_DATABASE_URL" --no-psqlrc --set=ON_ERROR_STOP=1 --command="DROP SCHEMA public CASCADE"; pg_restore --dbname="$TARGET_DATABASE_URL" --exit-on-error --no-owner --no-privileges /backup/public.dump'
    });

    targetClient = new Client({ connectionString: targetDatabaseUrl, ssl: { rejectUnauthorized: false } });
    await targetClient.connect();
    const targetCounts = await publicTableCounts(targetClient);
    assertMatchingCounts(sourceCounts, targetCounts);
    const sourceStorage = createClient(sourceSupabaseUrl, sourceServiceRoleKey, { auth: { persistSession: false } });
    const targetStorage = createClient(targetSupabaseUrl, temporaryKey.api_key, { auth: { persistSession: false } });
    await replaceTargetBuckets(sourceStorage, targetStorage);

    sourceClient = new Client({ connectionString: sourceDatabaseUrl, ssl: postgresTlsOptions(configuredSourceDatabaseUrl) });
    await sourceClient.connect();
    await sourceClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const storage = await copyAndVerifyObjects({ sourceClient, sourceStorage, targetStorage });
    await sourceClient.query('COMMIT');
    await sourceClient.end();
    sourceClient = null;
    await targetClient.end();
    targetClient = null;

    const dumpSha256 = createHash('sha256').update(await readFile(dumpPath)).digest('hex');
    const createdAt = new Date().toISOString();
    const manifest = {
      version: 1,
      createdAt,
      provider: cleanupBackupProvider,
      backupId: `${cleanupBackupProjectRef}-run-${runId}`,
      releaseSha,
      sourceProjectRef: productionProjectRef,
      targetProjectRef: cleanupBackupProjectRef,
      publicSchema: {
        tables: sourceCounts.size,
        rows: [...sourceCounts.values()].reduce((sum, count) => sum + Number(count), 0),
        dumpSha256
      },
      storage,
      sealed: true
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    return manifest;
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    if (sourceClient) {
      try { await sourceClient.query('ROLLBACK'); } catch {}
      try { await sourceClient.end(); } catch {}
    }
    if (targetClient) {
      try { await targetClient.end(); } catch {}
    }
    const sealingErrors = [];
    try {
      if (temporaryKey?.id) await deleteTargetKey(accessToken, temporaryKey.id, false);
    } catch (error) { sealingErrors.push(error); }
    try { await resetDatabasePassword(accessToken, sealedTargetPassword); } catch (error) { sealingErrors.push(error); }
    try { await assertSealedTargetApi(accessToken); } catch (error) { sealingErrors.push(error); }
    await rm(workingDirectory, { force: true, recursive: true });
    if (sealingErrors.length) {
      throw new AggregateError(operationError ? [operationError, ...sealingErrors] : sealingErrors, 'backup target could not be sealed');
    }
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const operation = process.argv.includes('--seal-only')
    ? sealProductionCleanupBackupTarget()
    : createProductionCleanupBackup();
  operation.catch((error) => {
    const messages = error instanceof AggregateError
      ? error.errors.map((cause) => cause instanceof Error ? cause.message : 'unknown sealing failure')
      : [error.message];
    console.error(messages.join('; '));
    process.exitCode = 1;
  });
}
