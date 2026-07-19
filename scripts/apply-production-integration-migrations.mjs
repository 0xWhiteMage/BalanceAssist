import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

import { getIncrementalMigrations } from './apply-test-migrations.mjs';

const reviewedMigrations = new Map([
  ['062', { filename: '062_monday_oauth_2_1.sql', sha256: '85e0cad01b812cdd4493589dfec67f66dd54b65e10a45167b6bca24f87ed2d04' }],
  ['063', { filename: '063_local_media_processing.sql', sha256: '05f30b3ec1675146c54eceed4babcc80cf3f76481edd506401a88403169a880c' }],
]);
const reviewedArtifactSha256 = '944901443c2875f9ec5d696910c03b2af22af7920dd2a0183c7b859a80b6373f';
const advisoryLock = 90442053;

export const integrationMigrationVersions = [...reviewedMigrations.keys()];

export function selectIntegrationMigrations(migrations) {
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  return integrationMigrationVersions.map((version) => {
    const migration = byVersion.get(version);
    if (!migration) throw new Error(`missing reviewed integration migration ${version}`);
    if (migration.filename !== reviewedMigrations.get(version).filename) {
      throw new Error(`integration migration ${version} is not the reviewed file`);
    }
    return migration;
  });
}

function normalizedHash(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export async function applyProductionIntegrationMigrations({
  connectionString = process.env.PRODUCTION_DATABASE_URL,
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  artifactPath = resolve(process.cwd(), 'supabase/production-integrations-062-063.sql'),
  dryRun = false,
} = {}) {
  const migrations = selectIntegrationMigrations(getIncrementalMigrations(migrationsDir));
  for (const migration of migrations) {
    if (normalizedHash(migration.path) !== reviewedMigrations.get(migration.version).sha256) {
      throw new Error(`integration migration ${migration.filename} does not match its reviewed source`);
    }
  }
  if (normalizedHash(artifactPath) !== reviewedArtifactSha256) {
    throw new Error('integration migration artifact does not match its reviewed artifact');
  }
  if (dryRun) return { planned: migrations.map(({ filename }) => filename), schemaVersion: integrationMigrationVersions.at(-1) };
  if (!connectionString) throw new Error('PRODUCTION_DATABASE_URL is required in the protected production-integration-migrations environment.');

  const stagingDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-reviewed-integrations-'));
  try {
    await Promise.all(migrations.map((migration) => copyFile(migration.path, resolve(stagingDir, migration.filename))));
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [advisoryLock]);
      const { rows: baseline } = await client.query("SELECT filename FROM public.schema_migrations WHERE version = '061'");
      if (baseline.length !== 1 || baseline[0].filename !== '061_api_security_retention_and_upload_quota.sql') {
        throw new Error('integration migration baseline 061 is not recorded with its reviewed filename');
      }
      const { rows: existing } = await client.query('SELECT version FROM public.schema_migrations WHERE version = ANY($1::text[])', [integrationMigrationVersions]);
      if (existing.length) throw new Error(`integration migration ${existing[0].version} is already recorded`);
      for (const migration of migrations) {
        await client.query(readFileSync(resolve(stagingDir, migration.filename), 'utf8'));
        await client.query('INSERT INTO public.schema_migrations(version, filename) VALUES ($1, $2)', [migration.version, migration.filename]);
      }
      await client.query('COMMIT');
      return { applied: migrations.map(({ filename }) => filename), schemaVersion: integrationMigrationVersions.at(-1) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.end();
    }
  } finally {
    await rm(stagingDir, { force: true, recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyProductionIntegrationMigrations({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; },
  );
}
