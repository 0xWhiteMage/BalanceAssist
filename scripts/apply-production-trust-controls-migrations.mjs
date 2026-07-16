import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { getIncrementalMigrations } from './apply-test-migrations.mjs';

const trustControlsMigration = {
  version: '054',
  filename: '054_human_contact_consent.sql',
  sha256: '05878715cca807eeed3f90cb3049cc7b33f96835475cf87f8c568afa38dedafd'
};
const reviewedTrustControlsArtifactSha256 = 'a45d75808c2969cdef69cfb68d99b25155bc61d608e1780d62572cac7cecfe61';
const advisoryLock = 90442054;

export const trustControlsMigrationVersion = trustControlsMigration.version;

export function selectTrustControlsMigration(migrations) {
  const migration = migrations.find((candidate) => candidate.version === trustControlsMigration.version);
  if (!migration) throw new Error('missing reviewed trust controls migration 054');
  if (migration.filename !== trustControlsMigration.filename) throw new Error('trust controls migration 054 is not the reviewed file');
  return migration;
}

function assertReviewedSource(migration) {
  const source = readFileSync(migration.path, 'utf8').replace(/\r\n/g, '\n');
  const sourceHash = createHash('sha256').update(source).digest('hex');
  if (sourceHash !== trustControlsMigration.sha256) {
    throw new Error(`trust controls migration ${migration.filename} does not match its reviewed source`);
  }
}

function assertReviewedArtifact(artifactPath) {
  const artifact = readFileSync(artifactPath, 'utf8').replace(/\r\n/g, '\n');
  const artifactHash = createHash('sha256').update(artifact).digest('hex');
  if (artifactHash !== reviewedTrustControlsArtifactSha256) {
    throw new Error('trust controls migration artifact does not match its reviewed artifact');
  }
}

async function assertBaseline(client) {
  const { rows } = await client.query(`
    SELECT version, filename
    FROM public.schema_migrations
    WHERE version = '053'
  `);
  if (rows.length !== 1 || rows[0].filename !== '053_monday_reconciliation.sql') {
    throw new Error('trust controls migration baseline 053 is not recorded with its reviewed filename');
  }

  const { rows: signatures } = await client.query(`
    SELECT to_regclass('public.sessions') AS sessions,
      to_regclass('public.session_consents') AS session_consents,
      to_regclass('public.human_messages') AS human_messages,
      to_regclass('public.handoff_outbox') AS handoff_outbox
  `);
  if (!signatures[0]?.sessions || !signatures[0]?.session_consents || !signatures[0]?.human_messages || !signatures[0]?.handoff_outbox) {
    throw new Error('trust controls migration baseline schema signatures are missing');
  }
}

async function assertTrustControlsMigrationIsEmpty(client) {
  const { rows } = await client.query("SELECT version FROM public.schema_migrations WHERE version = '054'");
  if (rows.length) throw new Error('trust controls migration 054 is already recorded; use the ordinary production runner after this reviewed migration path completes');
}

export async function applyProductionTrustControlsMigrations({
  connectionString = process.env.PRODUCTION_DATABASE_URL,
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  artifactPath = resolve(process.cwd(), 'supabase/production-trust-controls-054.sql'),
  dryRun = false
} = {}) {
  const migration = selectTrustControlsMigration(getIncrementalMigrations(migrationsDir));
  assertReviewedSource(migration);
  assertReviewedArtifact(artifactPath);
  if (dryRun) return { planned: [migration.filename], schemaVersion: migration.version };
  if (!connectionString) throw new Error('PRODUCTION_DATABASE_URL is required in the protected production-trust-migrations environment.');

  const stagingDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-reviewed-trust-controls-'));
  try {
    const stagedPath = resolve(stagingDir, migration.filename);
    await copyFile(migration.path, stagedPath);
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [advisoryLock]);
      await assertBaseline(client);
      await assertTrustControlsMigrationIsEmpty(client);
      await client.query(readFileSync(stagedPath, 'utf8'));
      await client.query('INSERT INTO public.schema_migrations (version, filename) VALUES ($1, $2)', [migration.version, migration.filename]);
      const { rows } = await client.query("SELECT version, filename FROM public.schema_migrations WHERE version = '054'");
      if (rows.length !== 1 || rows[0].filename !== migration.filename) throw new Error('trust controls migration verification failed');
      await client.query('COMMIT');
      return { applied: [migration.filename], recordedVersions: rows.map((row) => row.version), schemaVersion: migration.version };
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
  applyProductionTrustControlsMigrations({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}
