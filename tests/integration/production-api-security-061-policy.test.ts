// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
async function loadRunner() {
  return import(pathToFileURL(resolve(root, 'scripts/apply-production-api-security-061.mjs')).href);
}

describe('production API security migration 061 policy', () => {
  test('selects the exact reviewed source and protected artifact', async () => {
    const runner = await loadRunner();
    expect(runner.apiSecurity061MigrationVersion).toBe('061');
    expect(runner.selectApiSecurity061Migration([{
      version: '061', filename: '061_api_security_retention_and_upload_quota.sql', path: '/tmp/061'
    }]).version).toBe('061');
    expect(() => runner.selectApiSecurity061Migration([])).toThrow('missing reviewed API security migration 061');
    await expect(runner.applyProductionApiSecurity061({ dryRun: true })).resolves.toEqual({
      planned: ['061_api_security_retention_and_upload_quota.sql'], schemaVersion: '061'
    });

    const source = (await readFile(resolve(root, 'supabase/migrations/061_api_security_retention_and_upload_quota.sql'), 'utf8')).replace(/\r\n/g, '\n');
    const artifact = (await readFile(resolve(root, 'supabase/production-api-security-061.sql'), 'utf8')).replace(/\r\n/g, '\n');
    expect(artifact).toContain('-- BEGIN 061 061_api_security_retention_and_upload_quota.sql');
    expect(artifact).toContain(source);
    expect(artifact).toContain('SELECT pg_advisory_xact_lock(90442061);');
    expect(artifact).toContain("version = '059' AND filename = '059_consent_1_2_compatibility.sql'");
    expect(artifact.trimEnd()).toMatch(/COMMIT;$/);
  });

  test('rejects modified source and artifact content', async () => {
    const runner = await loadRunner();
    const source = await readFile(resolve(root, 'supabase/migrations/061_api_security_retention_and_upload_quota.sql'), 'utf8');
    const artifact = await readFile(resolve(root, 'supabase/production-api-security-061.sql'), 'utf8');
    const dir = await mkdtemp(resolve(tmpdir(), 'balance-assist-api-security-061-'));
    try {
      await writeFile(resolve(dir, '061_api_security_retention_and_upload_quota.sql'), `${source}\nSELECT 'unreviewed';\n`);
      await expect(runner.applyProductionApiSecurity061({ dryRun: true, migrationsDir: dir }))
        .rejects.toThrow('does not match its reviewed source');
      const artifactPath = resolve(dir, 'production-api-security-061.sql');
      await writeFile(artifactPath, `${artifact}\nSELECT 'unreviewed';\n`);
      await expect(runner.applyProductionApiSecurity061({ dryRun: true, artifactPath }))
        .rejects.toThrow('does not match its reviewed artifact');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('applies and verifies 061 before deployment review and promotion', async () => {
    const workflow = await readFile(resolve(root, '.github/workflows/production-release.yml'), 'utf8');
    const verification = await readFile(resolve(root, 'supabase/verify-api-security-061.sql'), 'utf8');
    const apply = workflow.indexOf('node scripts/apply-production-api-security-061.mjs --dry-run');
    expect(workflow).toContain('name: Verify Vercel auto-deploy-disabled prerequisite');
    expect(workflow).toContain('VERCEL_GIT_DEPLOYMENTS_DISABLED_AT');
    expect(workflow).toContain('project.id !== process.env.VERCEL_PROJECT_ID');
    expect(workflow).toContain('project.link != null');
    expect(apply).toBeGreaterThan(workflow.indexOf('name: Smoke immutable deployment'));
    expect(apply).toBeLessThan(workflow.indexOf('name: Verify approved deployment proof record'));
    expect(apply).toBeLessThan(workflow.indexOf('name: Promote immutable deployment'));
    expect(workflow).toContain("recorded.rows[0].filename !== '061_api_security_retention_and_upload_quota.sql'");
    expect(workflow).toContain('supabase/production-api-security-061.sql');
    expect(workflow).toContain("fn.prosrc.trim() !== reviewedBody(`${fn.proname}(`)");
    expect(workflow).toContain('reservations.public_access !== false');
    expect(workflow).toContain('fn.service_role_execute !== true');
    expect(verification).toContain("'public.prune_processed_telegram_updates(interval,integer)'::regprocedure");
    expect(verification).toContain("'public.reserve_session_upload_quota(uuid,bigint,bigint)'::regprocedure");
    expect(verification).toContain("'public.release_session_upload_quota(uuid)'::regprocedure");
    expect(verification).toContain("has_table_privilege('anon'");
    expect(verification).toContain("has_function_privilege('service_role'");
  });
});
