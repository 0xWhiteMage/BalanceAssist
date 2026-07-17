import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIncrementalMigrations } from './apply-test-migrations.mjs';

const reviewedMigration = {
  version: '059',
  filename: '059_consent_1_2_compatibility.sql',
  sha256: '17dff0619df1587ad7634389ec0fc7c74d53ad85ab7f762441715cefe56630cc'
};
const reviewedArtifactSha256 = '7b729b6d17e2fabf8d00d69406470c4a17132c4c5c75f5c22c901a36277cc3e4';

export const consent12CompatibilityMigrationVersion = reviewedMigration.version;

export function selectConsent12CompatibilityMigration(migrations) {
  const migration = migrations.find((candidate) => candidate.version === reviewedMigration.version);
  if (!migration) throw new Error('missing reviewed consent 1.2 compatibility migration 059');
  if (migration.filename !== reviewedMigration.filename) throw new Error('consent 1.2 compatibility migration 059 is not the reviewed file');
  return migration;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export async function applyProductionConsent12Compatibility({
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  artifactPath = resolve(process.cwd(), 'supabase/production-consent-1-2-compatibility-059.sql'),
  dryRun = false
} = {}) {
  const migration = selectConsent12CompatibilityMigration(getIncrementalMigrations(migrationsDir));
  if (sha256File(migration.path) !== reviewedMigration.sha256) throw new Error(`consent 1.2 compatibility migration ${migration.filename} does not match its reviewed source`);
  if (sha256File(artifactPath) !== reviewedArtifactSha256) throw new Error('consent 1.2 compatibility migration 059 artifact does not match its reviewed artifact');
  if (!dryRun) throw new Error('Use the protected immutable-main workflow to execute the reviewed SQL artifact.');
  return { planned: [migration.filename], schemaVersion: migration.version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyProductionConsent12Compatibility({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}
