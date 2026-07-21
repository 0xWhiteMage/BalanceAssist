// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();

describe('production consent 1.2 compatibility repair policy', () => {
  test('restores only the reviewed 059 body for the observed production drift', async () => {
    const runner = await import(pathToFileURL(resolve(root, 'scripts/apply-production-consent-1-2-059-repair.mjs')).href);
    await expect(runner.applyProductionConsent12CompatibilityRepair({ dryRun: true })).resolves.toEqual({
      planned: ['production-consent-1-2-compatibility-059-repair.sql'],
      observedBodySha256: '7bcba5a99145ead5ce20700a06b37e7c911f8099853f5ce9c450a8213a385215'
    });
    const source = (await readFile(resolve(root, 'supabase/migrations/059_consent_1_2_compatibility.sql'), 'utf8')).replace(/\r\n/g, '\n');
    const artifact = (await readFile(resolve(root, 'supabase/production-consent-1-2-compatibility-059-repair.sql'), 'utf8')).replace(/\r\n/g, '\n');
    expect(artifact).toBe(source);
  });
});
