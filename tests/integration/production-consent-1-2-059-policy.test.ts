// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();

describe('production consent 1.2 compatibility migration 059 policy', () => {
  test('is an immutable compatibility step that old clients can safely ignore', async () => {
    const runner = await import(pathToFileURL(resolve(root, 'scripts/apply-production-consent-1-2-059.mjs')).href);
    expect(runner.consent12CompatibilityMigrationVersion).toBe('059');
    await expect(runner.applyProductionConsent12Compatibility({ dryRun: true })).resolves.toEqual({
      planned: ['059_consent_1_2_compatibility.sql'], schemaVersion: '059'
    });
    const source = (await readFile(resolve(root, 'supabase/migrations/059_consent_1_2_compatibility.sql'), 'utf8')).replace(/\r\n/g, '\n');
    const artifact = (await readFile(resolve(root, 'supabase/production-consent-1-2-compatibility-059.sql'), 'utf8')).replace(/\r\n/g, '\n');
    expect(artifact).toContain(source);
    expect(source).toContain("RETURN v_analysis.notice_version = '1.2'");
    expect(source).toContain("IF v_analysis.granted IS DISTINCT FROM true THEN");
    expect(source).not.toContain("RAISE EXCEPTION 'ANALYSIS_CONSENT_REQUIRED' USING ERRCODE = '55000';\n  END IF;\n  RETURN true");
  });

  test('uses its dedicated protected immutable-main workflow', async () => {
    const workflow = await readFile(resolve(root, '.github/workflows/production-consent-1-2-059.yml'), 'utf8');
    expect(workflow).toContain('production-consent-1-2-059.yml@refs/heads/main');
    expect(workflow).toContain('environment: production-trust-migrations');
    expect(workflow).toContain('node scripts/apply-production-consent-1-2-059.mjs --dry-run');
    expect(workflow).toContain('supabase/production-consent-1-2-compatibility-059.sql');
  });
});
