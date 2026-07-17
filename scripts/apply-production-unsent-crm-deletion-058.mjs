import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIncrementalMigrations } from './apply-test-migrations.mjs';

const reviewedMigration = {
  version: '058',
  filename: '058_unsent_crm_deletion.sql',
  sha256: 'c65015cb6810a4c503aea5673cb1c7d1ec563802f196d9eea4541c15177e23fd'
};
const reviewedArtifactSha256 = 'f066a75bd794388e5f22a10df53b5df2dc9ad81fe47d99b44dd2b1bae278b9de';

export const unsentCrmDeletion058MigrationVersion = reviewedMigration.version;

export function selectUnsentCrmDeletion058Migration(migrations) {
  const migration = migrations.find((candidate) => candidate.version === reviewedMigration.version);
  if (!migration) throw new Error('missing reviewed unsent CRM deletion migration 058');
  if (migration.filename !== reviewedMigration.filename) throw new Error('unsent CRM deletion migration 058 is not the reviewed file');
  return migration;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export async function applyProductionUnsentCrmDeletion058({
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  artifactPath = resolve(process.cwd(), 'supabase/production-unsent-crm-deletion-058.sql'),
  dryRun = false
} = {}) {
  const migration = selectUnsentCrmDeletion058Migration(getIncrementalMigrations(migrationsDir));
  if (sha256File(migration.path) !== reviewedMigration.sha256) throw new Error(`unsent CRM deletion migration ${migration.filename} does not match its reviewed source`);
  if (sha256File(artifactPath) !== reviewedArtifactSha256) throw new Error('unsent CRM deletion migration 058 artifact does not match its reviewed artifact');
  if (!dryRun) throw new Error('Use the protected immutable-main workflow to execute the reviewed SQL artifact.');
  return { planned: [migration.filename], schemaVersion: migration.version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyProductionUnsentCrmDeletion058({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}
