import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { applyMigrations, getIncrementalMigrations } from './apply-test-migrations.mjs';

const reviewedCleanupMigrations = new Map([
  ['038', { filename: '038_durable_deletion_jobs.sql', sha256: '37b0ef6c4f5d7e3ccccabd96add128cfaae8f86e27d6ff384f945e96ee3a2ac3' }],
  ['039', { filename: '039_deletion_scheduler_health.sql', sha256: '5ef142d3b23de7acf7e1d46a78f848e3427779a2f9d30516152dc401fb28008b' }],
  ['040', { filename: '040_deletion_recovery_lifecycle.sql', sha256: 'c99d3ec9d27500a959010bd20e03bb466946f65fa7f6be7835de2f273421fba6' }],
  ['041', { filename: '041_deletion_backlog_count.sql', sha256: '87c5c9f1e5559e1176c8d83457eebbb9d4fbd8264798f793f2a7836076346d4f' }],
  ['042', { filename: '042_deletion_recovery_ownership.sql', sha256: '551540ad4fd8996206ff75760a2614b5f76e786dd9f8ebe898284b4282da025d' }],
  ['043', { filename: '043_deletion_state_batched_cleanup.sql', sha256: '85e7e1d658e9671f17c489f50b4a2486516ec4b721b5ad0b131df01e0de40257' }]
]);

export const cleanupMigrationVersions = [...reviewedCleanupMigrations.keys()];

export function selectCleanupMigrations(migrations) {
  const cleanupCandidates = migrations.filter((migration) => BigInt(migration.version) >= 38n);
  for (const migration of cleanupCandidates) {
    if (!reviewedCleanupMigrations.has(migration.version)) {
      throw new Error(`unreviewed migration ${migration.version} is not permitted by the one-time cleanup workflow`);
    }
  }

  return cleanupMigrationVersions.map((version) => {
    const migration = cleanupCandidates.find((candidate) => candidate.version === version);
    if (!migration) throw new Error(`missing reviewed cleanup migration ${version}`);
    if (migration.filename !== reviewedCleanupMigrations.get(version).filename) {
      throw new Error(`cleanup migration ${version} is not the reviewed file`);
    }
    return migration;
  });
}

function assertReviewedSource(migration) {
  const expectedHash = reviewedCleanupMigrations.get(migration.version).sha256;
  const sourceHash = createHash('sha256').update(readFileSync(migration.path)).digest('hex');
  if (sourceHash !== expectedHash) {
    throw new Error(`cleanup migration ${migration.filename} does not match its reviewed source`);
  }
}

export async function applyProductionCleanupMigrations({
  connectionString = process.env.PRODUCTION_DATABASE_URL,
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  dryRun = false
} = {}) {
  const migrations = selectCleanupMigrations(getIncrementalMigrations(migrationsDir));
  migrations.forEach(assertReviewedSource);
  if (dryRun) return { planned: migrations.map(({ filename }) => filename), schemaVersion: cleanupMigrationVersions.at(-1) };
  if (!connectionString) throw new Error('PRODUCTION_DATABASE_URL is required in the protected production-cleanup-migrations environment.');

  const stagingDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-reviewed-cleanup-'));
  try {
    await Promise.all(migrations.map((migration) => copyFile(migration.path, resolve(stagingDir, migration.filename))));
    const { applied } = await applyMigrations({ connectionString, migrationsDir: stagingDir });
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const { rows } = await client.query(
        'SELECT version FROM public.schema_migrations WHERE version = ANY($1::text[]) ORDER BY version',
        [cleanupMigrationVersions]
      );
      const recordedVersions = rows.map((row) => row.version);
      if (recordedVersions.join(',') !== cleanupMigrationVersions.join(',')) {
        throw new Error(`cleanup migration verification failed: expected recorded versions ${cleanupMigrationVersions.join(',')}, got ${recordedVersions.join(',') || 'none'}`);
      }
      return { applied, recordedVersions, schemaVersion: cleanupMigrationVersions.at(-1) };
    } finally {
      await client.end();
    }
  } finally {
    await rm(stagingDir, { force: true, recursive: true });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  applyProductionCleanupMigrations({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}
