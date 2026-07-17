import { applyMigrations, getIncrementalMigrations } from './apply-test-migrations.mjs';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { crmMigrationVersions } from './apply-production-crm-migrations.mjs';

const policyBaseline = 37n;
const reviewedCleanupVersions = ['038', '039', '040', '041', '042', '043'];
const reviewedTrustControlsVersion = '054';
const reviewedFinalReviewVersion = '055';
const reviewedSessionControlsVersion = '056';
const reviewedTrustFeedbackVersion = '057';
const reviewedUnsentCrmDeletionVersion = '058';
const reviewedConsent12Version = '059';
const reviewedConsent12CutoverVersion = '060';

export function assertReviewedCleanupMigrationsRecorded(recordedVersions) {
  const recorded = new Set(recordedVersions);
  const pending = reviewedCleanupVersions.filter((version) => !recorded.has(version));
  if (pending.length) {
    throw new Error(`${pending.join(', ')} is pending; run Production cleanup migrations before this release.`);
  }
}

export function assertReviewedCrmMigrationsRecorded(recordedVersions) {
  const recorded = new Set(recordedVersions);
  const pending = crmMigrationVersions.filter((version) => !recorded.has(version));
  if (pending.length) {
    throw new Error(`${pending.join(', ')} is pending; run Production CRM migrations before this release.`);
  }
}

export function assertReviewedTrustControlsMigrationRecorded(recordedVersions) {
  if (!recordedVersions.includes(reviewedTrustControlsVersion)) {
    throw new Error('054 is pending; run Production trust controls migrations before this release.');
  }
}

export function assertReviewedFinalReviewMigrationRecorded(recordedVersions) {
  if (!recordedVersions.includes(reviewedFinalReviewVersion)) {
    throw new Error('055 is pending; run Production final review migration before this release.');
  }
}

export function assertReviewedSessionControlsMigrationRecorded(recordedVersions) {
  if (!recordedVersions.includes(reviewedSessionControlsVersion)) {
    throw new Error('056 is pending; run Production trust controls migration 056 before this release.');
  }
}

export function assertReviewedTrustFeedbackMigrationRecorded(recordedVersions) {
  if (!recordedVersions.includes(reviewedTrustFeedbackVersion)) {
    throw new Error('057 is pending; run Production trust feedback migration 057 before this release.');
  }
}

export function assertReviewedUnsentCrmDeletionMigrationRecorded(recordedVersions) {
  if (!recordedVersions.includes(reviewedUnsentCrmDeletionVersion)) {
    throw new Error('058 is pending; run Production unsent CRM deletion migration 058 before this release.');
  }
}

export function assertReviewedConsent12MigrationRecorded(recordedVersions) {
  if (!recordedVersions.includes(reviewedConsent12Version)) {
    throw new Error('059 is pending; run Production consent 1.2 migration 059 before this release.');
  }
}

export function selectOrdinaryProductionMigrations(migrations) {
  return migrations.filter((migration) => !crmMigrationVersions.includes(migration.version)
    && migration.version !== reviewedTrustControlsVersion
    && migration.version !== reviewedFinalReviewVersion
    && migration.version !== reviewedSessionControlsVersion
    && migration.version !== reviewedTrustFeedbackVersion
    && migration.version !== reviewedUnsentCrmDeletionVersion
    && migration.version !== reviewedConsent12Version
    && migration.version !== reviewedConsent12CutoverVersion);
}

export function assertExpandOnlyMigration(source, filename) {
  if (/^0(?:38|39|40|41|42|43)_/.test(filename)) {
    throw new Error(`${filename} is a reviewed destructive cleanup migration. Run the one-time Production cleanup migrations workflow for versions 038-043 after its backup/audit attestation is approved.`);
  }

  if (/--|\/\*|\*\//.test(source)) {
    throw new Error(`${filename} is not expand-only: contains comments; use the separately approved cleanup migration workflow.`);
  }

  const identifier = '[a-z_][a-z0-9_]*';
  const qualifiedIdentifier = `(?:${identifier}\\.)?${identifier}`;
  const type = '(?:text|uuid|boolean|integer|bigint|numeric(?:\\(\\d+(?:\\s*,\\s*\\d+)?\\))?|varchar\\(\\d+\\)|timestamptz|jsonb)';
  const defaultValue = "(?:null|true|false|[-+]?\\d+(?:\\.\\d+)?|'(?:[^']|'')*')";
  const constraints = `(?:\\s+(?:primary\\s+key|not\\s+null|unique|default\\s+${defaultValue}))*`;
  const column = `${identifier}\\s+${type}${constraints}`;
  const createTable = new RegExp(`^create\\s+table\\s+if\\s+not\\s+exists\\s+${qualifiedIdentifier}\\s*\\(\\s*${column}(?:\\s*,\\s*${column})*\\s*\\)\\s*;$`, 'i');
  const addColumn = new RegExp(`^alter\\s+table\\s+${qualifiedIdentifier}\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\s*;$`, 'i');
  const createIndex = new RegExp(`^create\\s+(?:unique\\s+)?index\\s+if\\s+not\\s+exists\\s+${identifier}\\s+on\\s+${qualifiedIdentifier}\\s*\\(\\s*${identifier}(?:\\s*,\\s*${identifier})*\\s*\\)\\s*;$`, 'i');

  if (!createTable.test(source) && !addColumn.test(source) && !createIndex.test(source)) {
    throw new Error(`${filename} is not expand-only: contains unsupported SQL; use the separately approved cleanup migration workflow.`);
  }
}

async function getRecordedMigrationVersions(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT version FROM public.schema_migrations');
    return rows.map((row) => String(row.version));
  } finally {
    await client.end();
  }
}

export async function applyProductionMigrations(connectionString = process.env.PRODUCTION_DATABASE_URL) {
  if (!connectionString) {
    throw new Error('PRODUCTION_DATABASE_URL is required in the protected production-migrations environment.');
  }

  const recordedVersions = await getRecordedMigrationVersions(connectionString);
  assertReviewedCleanupMigrationsRecorded(recordedVersions);
  assertReviewedCrmMigrationsRecorded(recordedVersions);
  assertReviewedTrustControlsMigrationRecorded(recordedVersions);
  assertReviewedFinalReviewMigrationRecorded(recordedVersions);
  assertReviewedSessionControlsMigrationRecorded(recordedVersions);
  assertReviewedTrustFeedbackMigrationRecorded(recordedVersions);
  assertReviewedUnsentCrmDeletionMigrationRecorded(recordedVersions);
  assertReviewedConsent12MigrationRecorded(recordedVersions);

  const migrations = selectOrdinaryProductionMigrations(getIncrementalMigrations(resolve(process.cwd(), 'supabase/migrations')));
  for (const migration of migrations) {
    if (BigInt(migration.version) > policyBaseline && !reviewedCleanupVersions.includes(migration.version)) {
      assertExpandOnlyMigration(readFileSync(migration.path, 'utf8'), migration.filename);
    }
  }

  const stagingDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-ordinary-production-'));
  try {
    await Promise.all(migrations.map((migration) => copyFile(migration.path, resolve(stagingDir, migration.filename))));
    const { applied } = await applyMigrations({ connectionString, migrationsDir: stagingDir });
    return { applied, schemaVersion: migrations.at(-1)?.version };
  } finally {
    await rm(stagingDir, { force: true, recursive: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  applyProductionMigrations().then((result) => console.log(JSON.stringify(result)));
}
