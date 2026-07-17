import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { getIncrementalMigrations } from './apply-test-migrations.mjs';

const finalReviewMigration = {
  version: '055',
  filename: '055_final_review_approval.sql',
  sha256: 'dd0159b1298a7f78a9a7adeab08909328f5c6cf1e5c0d7d27a567d838af0e2c2'
};
const reviewedFinalReviewArtifactSha256 = 'b897625b85a1c555af3828a8d19092d72cb1b8f3c0712bc8696dcc13c987b828';
const advisoryLock = 90442055;

export const finalReviewMigrationVersion = finalReviewMigration.version;

export function selectFinalReviewMigration(migrations) {
  const migration = migrations.find((candidate) => candidate.version === finalReviewMigration.version);
  if (!migration) throw new Error('missing reviewed final review migration 055');
  if (migration.filename !== finalReviewMigration.filename) throw new Error('final review migration 055 is not the reviewed file');
  return migration;
}

function assertReviewedSource(migration) {
  const source = readFileSync(migration.path, 'utf8').replace(/\r\n/g, '\n');
  const sourceHash = createHash('sha256').update(source).digest('hex');
  if (sourceHash !== finalReviewMigration.sha256) {
    throw new Error(`final review migration ${migration.filename} does not match its reviewed source`);
  }
}

function assertReviewedArtifact(artifactPath) {
  const artifact = readFileSync(artifactPath, 'utf8').replace(/\r\n/g, '\n');
  const artifactHash = createHash('sha256').update(artifact).digest('hex');
  if (artifactHash !== reviewedFinalReviewArtifactSha256) {
    throw new Error('final review migration artifact does not match its reviewed artifact');
  }
}

async function assertBaseline(client) {
  const { rows } = await client.query(`
    SELECT version, filename
    FROM public.schema_migrations
    WHERE version = '054'
  `);
  if (rows.length !== 1 || rows[0].filename !== '054_human_contact_consent.sql') {
    throw new Error('final review migration baseline 054 is not recorded with its reviewed filename');
  }

  const { rows: signatures } = await client.query(`
    SELECT to_regclass('public.sessions') AS sessions,
      to_regclass('public.crm_leads') AS crm_leads,
      to_regclass('public.crm_lead_revisions') AS crm_lead_revisions,
      to_regprocedure('public.finalize_session_lead(uuid)') AS finalize_session_lead
  `);
  if (!signatures[0]?.sessions || !signatures[0]?.crm_leads || !signatures[0]?.crm_lead_revisions || !signatures[0]?.finalize_session_lead) {
    throw new Error('final review migration baseline schema signatures are missing');
  }
}

async function assertFinalReviewMigrationIsEmpty(client) {
  const { rows } = await client.query("SELECT version FROM public.schema_migrations WHERE version = '055'");
  if (rows.length) throw new Error('final review migration 055 is already recorded; use the ordinary production runner after this reviewed migration path completes');
}

export async function applyProductionFinalReviewMigration({
  connectionString = process.env.PRODUCTION_DATABASE_URL,
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  artifactPath = resolve(process.cwd(), 'supabase/production-final-review-055.sql'),
  dryRun = false
} = {}) {
  const migration = selectFinalReviewMigration(getIncrementalMigrations(migrationsDir));
  assertReviewedSource(migration);
  assertReviewedArtifact(artifactPath);
  if (dryRun) return { planned: [migration.filename], schemaVersion: migration.version };
  if (!connectionString) throw new Error('PRODUCTION_DATABASE_URL is required in the protected production-trust-migrations environment.');

  const stagingDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-reviewed-final-review-'));
  try {
    const stagedPath = resolve(stagingDir, migration.filename);
    await copyFile(migration.path, stagedPath);
    const client = new Client({ connectionString });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [advisoryLock]);
      await assertBaseline(client);
      await assertFinalReviewMigrationIsEmpty(client);
      await client.query(readFileSync(stagedPath, 'utf8'));
      await client.query('INSERT INTO public.schema_migrations (version, filename) VALUES ($1, $2)', [migration.version, migration.filename]);
      const { rows } = await client.query("SELECT version, filename FROM public.schema_migrations WHERE version = '055'");
      const { rows: resultSignature } = await client.query("SELECT pg_get_function_result('public.finalize_session_lead(uuid)'::regprocedure) AS result");
      if (rows.length !== 1 || rows[0].filename !== migration.filename
        || !resultSignature[0]?.result.includes('approval_input_hash text')
        || !resultSignature[0]?.result.includes('approved_reference_set_hash text')) {
        throw new Error('final review migration verification failed');
      }
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
  applyProductionFinalReviewMigration({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}
