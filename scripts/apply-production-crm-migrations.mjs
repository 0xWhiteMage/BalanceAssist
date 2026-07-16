import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { getIncrementalMigrations } from './apply-test-migrations.mjs';

const reviewedCrmMigrations = new Map([
  ['044', { filename: '044_monday_crm_projection_tables.sql', sha256: '57a77b820a0b69282b79c3ba800f070d34f9cfc1c99005ff66f7bce3385e07ad' }],
  ['047', { filename: '047_atomic_crm_approval.sql', sha256: '0fe0cdfe7c50b77a1b50a1761beaccc89237015d3ad8bb9884e36f14682ec2da' }],
  ['048', { filename: '048_monday_sync_state_machine.sql', sha256: '8aa7bc5bbe7c77d8704d8adebd02b5489c9f7917af624cee110e8520116f5a68' }],
  ['049', { filename: '049_monday_crm_lifecycle.sql', sha256: 'a2058e2eb6c57860930e81e4e6a6e0990f17ca93a5b060ea59e716a4b81e015f' }],
  ['052', { filename: '052_monday_scheduler_health.sql', sha256: '06b8f73575bee85571aeff742aefd3b388a9961c94d73a07181fb9f328b2e617' }],
  ['053', { filename: '053_monday_reconciliation.sql', sha256: '8aa2544cc75f9c5ecec0759cdb885e2db18b8c04fda280e3f24442e7a13428a4' }]
]);

export const crmMigrationVersions = [...reviewedCrmMigrations.keys()];
const advisoryLock = 90442053;

export function selectCrmMigrations(migrations) {
  const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  return crmMigrationVersions.map((version) => {
    const migration = byVersion.get(version);
    if (!migration) throw new Error(`missing reviewed CRM migration ${version}`);
    if (migration.filename !== reviewedCrmMigrations.get(version).filename) {
      throw new Error(`CRM migration ${version} is not the reviewed file`);
    }
    return migration;
  });
}

function assertReviewedSource(migration) {
  const source = readFileSync(migration.path, 'utf8').replace(/\r\n/g, '\n');
  const sourceHash = createHash('sha256').update(source).digest('hex');
  if (sourceHash !== reviewedCrmMigrations.get(migration.version).sha256) {
    throw new Error(`CRM migration ${migration.filename} does not match its reviewed source`);
  }
}

async function assertBaseline(client) {
  const { rows } = await client.query(`
    SELECT version, filename
    FROM public.schema_migrations
    WHERE version = '043'
  `);
  if (rows.length !== 1 || rows[0].filename !== '043_deletion_state_batched_cleanup.sql') {
    throw new Error('CRM migration baseline 043 is not recorded with its reviewed filename');
  }

  const { rows: signatures } = await client.query(`
    SELECT to_regclass('public.sessions') AS sessions,
      to_regclass('public.deletion_jobs') AS deletion_jobs,
      to_regclass('public.scheduler_heartbeats') AS scheduler_heartbeats
  `);
  if (!signatures[0]?.sessions || !signatures[0]?.deletion_jobs || !signatures[0]?.scheduler_heartbeats) {
    throw new Error('CRM migration baseline schema signatures are missing');
  }
}

async function assertCrmRangeIsEmpty(client) {
  const { rows } = await client.query(
    'SELECT version FROM public.schema_migrations WHERE version = ANY($1::text[])',
    [crmMigrationVersions]
  );
  if (rows.length) throw new Error(`CRM migration ${rows[0].version} is already recorded; use the ordinary production runner after this reviewed migration path completes`);
}

export async function applyProductionCrmMigrations({
  connectionString = process.env.PRODUCTION_DATABASE_URL,
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  dryRun = false
} = {}) {
  const migrations = selectCrmMigrations(getIncrementalMigrations(migrationsDir));
  migrations.forEach(assertReviewedSource);
  if (dryRun) return { planned: migrations.map(({ filename }) => filename), schemaVersion: crmMigrationVersions.at(-1) };
  if (!connectionString) throw new Error('PRODUCTION_DATABASE_URL is required in the protected production-crm-migrations environment.');

  const stagingDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-reviewed-crm-'));
  try {
    await Promise.all(migrations.map((migration) => copyFile(migration.path, resolve(stagingDir, migration.filename))));
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [advisoryLock]);
      await assertBaseline(client);
      await assertCrmRangeIsEmpty(client);
      for (const migration of migrations) {
        await client.query(readFileSync(resolve(stagingDir, migration.filename), 'utf8'));
        await client.query('INSERT INTO public.schema_migrations (version, filename) VALUES ($1, $2)', [migration.version, migration.filename]);
      }
      const { rows } = await client.query(
        'SELECT version, filename FROM public.schema_migrations WHERE version = ANY($1::text[]) ORDER BY version',
        [crmMigrationVersions]
      );
      if (rows.length !== migrations.length || rows.some((row, index) => row.version !== migrations[index].version || row.filename !== migrations[index].filename)) {
        throw new Error('CRM migration verification failed');
      }
      await client.query('COMMIT');
      return { applied: migrations.map(({ filename }) => filename), recordedVersions: rows.map((row) => row.version), schemaVersion: crmMigrationVersions.at(-1) };
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

if (process.argv[1] === new URL(import.meta.url).pathname) {
  applyProductionCrmMigrations({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}
