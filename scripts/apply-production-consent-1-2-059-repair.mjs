import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const reviewedSourceSha256 = '17dff0619df1587ad7634389ec0fc7c74d53ad85ab7f762441715cefe56630cc';
const reviewedArtifactSha256 = '17dff0619df1587ad7634389ec0fc7c74d53ad85ab7f762441715cefe56630cc';

export const observedProductionConsent12BodySha256 = '7bcba5a99145ead5ce20700a06b37e7c911f8099853f5ce9c450a8213a385215';

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}

export async function applyProductionConsent12CompatibilityRepair({
  sourcePath = resolve(process.cwd(), 'supabase/migrations/059_consent_1_2_compatibility.sql'),
  artifactPath = resolve(process.cwd(), 'supabase/production-consent-1-2-compatibility-059-repair.sql'),
  dryRun = false
} = {}) {
  if (sha256File(sourcePath) !== reviewedSourceSha256) throw new Error('consent 1.2 compatibility migration 059 does not match its reviewed source');
  if (sha256File(artifactPath) !== reviewedArtifactSha256) throw new Error('consent 1.2 compatibility repair does not match its reviewed artifact');
  if (!dryRun) throw new Error('Use the protected immutable-main workflow to execute the reviewed repair artifact.');
  return { planned: ['production-consent-1-2-compatibility-059-repair.sql'], observedBodySha256: observedProductionConsent12BodySha256 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyProductionConsent12CompatibilityRepair({ dryRun: process.argv.includes('--dry-run') }).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => { console.error(error.message); process.exitCode = 1; }
  );
}
