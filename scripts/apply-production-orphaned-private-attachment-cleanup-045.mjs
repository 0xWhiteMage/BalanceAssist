import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIncrementalMigrations } from './apply-test-migrations.mjs';

const reviewedMigration = {
  version: '045',
  filename: '045_orphaned_private_attachment_cleanup.sql',
  sha256: '5072176b751229285c55485a0b487fda1d175f77e731eee098d86e0b96f3487c'
};
const reviewedArtifactSha256 = '1c927617464f6ca60ccb20d3bebb0d495d5463380078718eeb0915ae0cbd8fce';

export const orphanedPrivateAttachmentCleanup045MigrationVersion = reviewedMigration.version;

export function selectOrphanedPrivateAttachmentCleanup045Migration(migrations) {
  const migration = migrations.find((candidate) => candidate.version === reviewedMigration.version);
  if (!migration) throw new Error('missing reviewed orphaned private attachment cleanup migration 045');
  if (migration.filename !== reviewedMigration.filename) {
    throw new Error('orphaned private attachment cleanup migration 045 is not the reviewed file');
  }
  return migration;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export async function applyProductionOrphanedPrivateAttachmentCleanup045({
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  artifactPath = resolve(process.cwd(), 'supabase/production-orphaned-private-attachment-cleanup-045.sql'),
  dryRun = false
} = {}) {
  const migration = selectOrphanedPrivateAttachmentCleanup045Migration(getIncrementalMigrations(migrationsDir));
  if (sha256File(migration.path) !== reviewedMigration.sha256) {
    throw new Error(`orphaned private attachment cleanup migration ${migration.filename} does not match its reviewed source`);
  }
  if (sha256File(artifactPath) !== reviewedArtifactSha256) {
    throw new Error('orphaned private attachment cleanup migration 045 artifact does not match its reviewed artifact');
  }
  if (!dryRun) throw new Error('Use the protected immutable-main workflow to execute the reviewed SQL artifact.');
  return { planned: [migration.filename], schemaVersion: migration.version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyProductionOrphanedPrivateAttachmentCleanup045({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}
