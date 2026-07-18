import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIncrementalMigrations } from './apply-test-migrations.mjs';

const reviewedMigration = {
  version: '061',
  filename: '061_api_security_retention_and_upload_quota.sql',
  sha256: '7de937c8a3c9baf52767b02fe93e75d46da81535216d0e9f5652e284d4c627e8'
};
const reviewedArtifactSha256 = '5edf21fcc4c9183762d10b20657b358aa06f851664862ef9c55aa78db1850e38';

export const apiSecurity061MigrationVersion = reviewedMigration.version;

export function selectApiSecurity061Migration(migrations) {
  const migration = migrations.find((candidate) => candidate.version === reviewedMigration.version);
  if (!migration) throw new Error('missing reviewed API security migration 061');
  if (migration.filename !== reviewedMigration.filename) throw new Error('API security migration 061 is not the reviewed file');
  return migration;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export async function applyProductionApiSecurity061({
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  artifactPath = resolve(process.cwd(), 'supabase/production-api-security-061.sql'),
  dryRun = false
} = {}) {
  const migration = selectApiSecurity061Migration(getIncrementalMigrations(migrationsDir));
  if (sha256File(migration.path) !== reviewedMigration.sha256) throw new Error(`API security migration ${migration.filename} does not match its reviewed source`);
  if (sha256File(artifactPath) !== reviewedArtifactSha256) throw new Error('API security migration 061 artifact does not match its reviewed artifact');
  if (!dryRun) throw new Error('Use the protected production release migration step to execute the reviewed SQL artifact.');
  return { planned: [migration.filename], schemaVersion: migration.version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyProductionApiSecurity061({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}
