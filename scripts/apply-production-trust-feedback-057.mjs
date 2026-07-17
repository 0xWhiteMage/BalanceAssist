import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIncrementalMigrations } from './apply-test-migrations.mjs';

const reviewedMigration = {
  version: '057',
  filename: '057_event_deletion_freeze.sql',
  sha256: '70b7a0c25ae5875ad568ce731d434eb58b9e864d05596bf522a0cda2c673476e'
};
const reviewedArtifactSha256 = 'c92e1bed196b1a435eae4b2c4537f2cd27417833e0ac82a5438dca96976a2612';

export const trustFeedback057MigrationVersion = reviewedMigration.version;

export function selectTrustFeedback057Migration(migrations) {
  const migration = migrations.find((candidate) => candidate.version === reviewedMigration.version);
  if (!migration) throw new Error('missing reviewed trust feedback migration 057');
  if (migration.filename !== reviewedMigration.filename) throw new Error('trust feedback migration 057 is not the reviewed file');
  return migration;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export async function applyProductionTrustFeedback057({
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  artifactPath = resolve(process.cwd(), 'supabase/production-trust-feedback-057.sql'),
  dryRun = false
} = {}) {
  const migration = selectTrustFeedback057Migration(getIncrementalMigrations(migrationsDir));
  if (sha256File(migration.path) !== reviewedMigration.sha256) {
    throw new Error(`trust feedback migration ${migration.filename} does not match its reviewed source`);
  }
  if (sha256File(artifactPath) !== reviewedArtifactSha256) {
    throw new Error('trust feedback migration 057 artifact does not match its reviewed artifact');
  }
  if (!dryRun) throw new Error('Use the protected immutable-main workflow to execute the reviewed SQL artifact.');
  return { planned: [migration.filename], schemaVersion: migration.version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyProductionTrustFeedback057({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}
