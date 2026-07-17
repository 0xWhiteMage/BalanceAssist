import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIncrementalMigrations } from './apply-test-migrations.mjs';

const trustControlsMigration = {
  version: '056',
  filename: '056_trust_centered_session_controls.sql',
  sha256: 'e416c2030f5e9f7ab45ecd65f706413f049dd780826500ab81c5f7ff26d4d718'
};
const reviewedArtifactSha256 = '4c881b2968f42a6e4a930306c415c592739601f311b97b56c1bc3d9532556e9d';

export const trustControls056MigrationVersion = trustControlsMigration.version;

export function selectTrustControls056Migration(migrations) {
  const migration = migrations.find((candidate) => candidate.version === trustControlsMigration.version);
  if (!migration) throw new Error('missing reviewed trust controls migration 056');
  if (migration.filename !== trustControlsMigration.filename) throw new Error('trust controls migration 056 is not the reviewed file');
  return migration;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export async function applyProductionTrustControls056({
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  artifactPath = resolve(process.cwd(), 'supabase/production-trust-controls-056.sql'),
  dryRun = false
} = {}) {
  const migration = selectTrustControls056Migration(getIncrementalMigrations(migrationsDir));
  if (sha256File(migration.path) !== trustControlsMigration.sha256) {
    throw new Error(`trust controls migration ${migration.filename} does not match its reviewed source`);
  }
  if (sha256File(artifactPath) !== reviewedArtifactSha256) {
    throw new Error('trust controls migration 056 artifact does not match its reviewed artifact');
  }
  if (!dryRun) {
    throw new Error('Use the protected immutable-main workflow to execute the reviewed SQL artifact.');
  }
  return { planned: [migration.filename], schemaVersion: migration.version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyProductionTrustControls056({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}
