// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
async function loadRunner() {
  return import(pathToFileURL(resolve(root, 'scripts/apply-production-consent-1-2-cutover-060.mjs')).href);
}

describe('production consent 1.2 cutover migration 060 policy', () => {
  test('selects the reviewed migration and exact protected artifact', async () => {
    const runner = await loadRunner();
    expect(runner.consent12CutoverMigrationVersion).toBe('060');
    expect(runner.selectConsent12CutoverMigration([{ version: '060', filename: '060_consent_1_2_cutover.sql', path: '/tmp/060' }]).version).toBe('060');
    expect(() => runner.selectConsent12CutoverMigration([])).toThrow('missing reviewed consent 1.2 cutover migration 060');
    await expect(runner.applyProductionConsent12Cutover({ dryRun: true })).resolves.toEqual({
      planned: ['060_consent_1_2_cutover.sql'], schemaVersion: '060'
    });

    const source = (await readFile(resolve(root, 'supabase/migrations/060_consent_1_2_cutover.sql'), 'utf8')).replace(/\r\n/g, '\n');
    const artifact = (await readFile(resolve(root, 'supabase/production-consent-1-2-cutover-060.sql'), 'utf8')).replace(/\r\n/g, '\n');
    expect(artifact).toContain('-- BEGIN 060 060_consent_1_2_cutover.sql');
    expect(artifact).toContain(source);
    expect(artifact).toContain('SELECT pg_advisory_xact_lock(90442060);');
    expect(artifact).toContain("version = '059' AND filename = '059_consent_1_2_compatibility.sql'");
    expect(source).toContain("v_analysis.notice_version IS DISTINCT FROM '1.2'");
    expect(source).toContain("v_consent.notice_version IS DISTINCT FROM '1.2'");
    expect(source).toContain("v_human_contact.notice_version IS DISTINCT FROM '1.2'");
    expect(source).toContain("v_session.deletion_state <> 'active'");
    expect(source).toContain("consent.notice_version IS DISTINCT FROM '1.2'");
    expect(source).not.toContain("notice_version IS DISTINCT FROM '1.1'");
    expect(artifact.trimEnd()).toMatch(/COMMIT;$/);
  });

  test('rejects a modified artifact', async () => {
    const runner = await loadRunner();
    const artifact = await readFile(resolve(root, 'supabase/production-consent-1-2-cutover-060.sql'), 'utf8');
    const dir = await mkdtemp(resolve(tmpdir(), 'balance-assist-consent-060-'));
    try {
      const artifactPath = resolve(dir, 'production-consent-1-2-cutover-060.sql');
      await writeFile(artifactPath, `${artifact}\nSELECT 'unreviewed';\n`);
      await expect(runner.applyProductionConsent12Cutover({ dryRun: true, artifactPath })).rejects.toThrow('does not match its reviewed artifact');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('runs in the protected promotion cutover and restores the prior alias if applying it fails', async () => {
    const workflow = await readFile(resolve(root, '.github/workflows/production-release.yml'), 'utf8');
    expect(workflow).toContain('environment: production-consent-cutover');
    expect(workflow.indexOf('name: Apply consent 1.2 cutover')).toBeLessThan(workflow.indexOf('name: Smoke promoted production alias'));
    expect(workflow).toContain('node scripts/apply-production-consent-1-2-cutover-060.mjs --dry-run');
    expect(workflow).toContain('previous_deployment_url');
    expect(workflow).toContain('vercel alias set "$PREVIOUS_DEPLOYMENT_URL" "$PRODUCTION_URL"');
    expect(workflow).toContain("version = '060' AND filename = '060_consent_1_2_cutover.sql'");
  });
});
