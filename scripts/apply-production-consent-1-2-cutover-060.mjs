import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIncrementalMigrations } from './apply-test-migrations.mjs';

const reviewedMigration = {
  version: '060',
  filename: '060_consent_1_2_cutover.sql',
  sha256: '52911233c77d120d8405ba9a2e1f974900a4ef2bd67fb79a383aa0cea35c6107'
};
const reviewedArtifactSha256 = '3db37f994000678fcb11b34dbb65e6467a7009fc7ee1c4127bbc205ade34d0d3';

export const consent12CutoverMigrationVersion = reviewedMigration.version;

export function selectConsent12CutoverMigration(migrations) {
  const migration = migrations.find((candidate) => candidate.version === reviewedMigration.version);
  if (!migration) throw new Error('missing reviewed consent 1.2 cutover migration 060');
  if (migration.filename !== reviewedMigration.filename) throw new Error('consent 1.2 cutover migration 060 is not the reviewed file');
  return migration;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export async function applyProductionConsent12Cutover({
  migrationsDir = resolve(process.cwd(), 'supabase/migrations'),
  artifactPath = resolve(process.cwd(), 'supabase/production-consent-1-2-cutover-060.sql'),
  dryRun = false
} = {}) {
  const migration = selectConsent12CutoverMigration(getIncrementalMigrations(migrationsDir));
  if (sha256File(migration.path) !== reviewedMigration.sha256) throw new Error(`consent 1.2 cutover migration ${migration.filename} does not match its reviewed source`);
  if (sha256File(artifactPath) !== reviewedArtifactSha256) throw new Error('consent 1.2 cutover migration 060 artifact does not match its reviewed artifact');
  if (!dryRun) throw new Error('Use the protected production release cutover step to execute the reviewed SQL artifact.');
  return { planned: [migration.filename], schemaVersion: migration.version };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyProductionConsent12Cutover({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}
