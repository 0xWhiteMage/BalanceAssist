// @vitest-environment node
import { describe, expect, test } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
type Workflow = { jobs?: Record<string, { environment?: string; env?: Record<string, string>; steps?: Array<{ env?: Record<string, string>; run?: string }> }> };

async function loadRunner() {
  return import(pathToFileURL(resolve(root, 'scripts/apply-production-unsent-crm-deletion-058.mjs')).href);
}

describe('production unsent CRM deletion 058 policy', () => {
  test('selects the reviewed migration and exact protected artifact', async () => {
    const runner = await loadRunner();
    expect(runner.unsentCrmDeletion058MigrationVersion).toBe('058');
    expect(runner.selectUnsentCrmDeletion058Migration([{ version: '058', filename: '058_unsent_crm_deletion.sql', path: '/tmp/058' }]).version).toBe('058');
    expect(() => runner.selectUnsentCrmDeletion058Migration([])).toThrow('missing reviewed unsent CRM deletion migration 058');
    await expect(runner.applyProductionUnsentCrmDeletion058({ dryRun: true })).resolves.toEqual({
      planned: ['058_unsent_crm_deletion.sql'], schemaVersion: '058'
    });

    const source = (await readFile(resolve(root, 'supabase/migrations/058_unsent_crm_deletion.sql'), 'utf8')).replace(/\r\n/g, '\n');
    const artifact = (await readFile(resolve(root, 'supabase/production-unsent-crm-deletion-058.sql'), 'utf8')).replace(/\r\n/g, '\n');
    expect(artifact).toContain('-- BEGIN 058 058_unsent_crm_deletion.sql');
    expect(artifact).toContain(source);
    expect(artifact).toContain('SELECT pg_advisory_xact_lock(90442058);');
    expect(artifact).toContain("version = '057' AND filename = '057_event_deletion_freeze.sql'");
    expect(artifact).toContain("state IN ('sending', 'synced', 'delivery_unknown', 'conflict', 'failed')");
    expect(artifact.trimEnd()).toMatch(/COMMIT;$/);
  });

  test('rejects a modified artifact', async () => {
    const runner = await loadRunner();
    const artifact = await readFile(resolve(root, 'supabase/production-unsent-crm-deletion-058.sql'), 'utf8');
    const dir = await mkdtemp(resolve(tmpdir(), 'balance-assist-unsent-crm-058-'));
    try {
      const artifactPath = resolve(dir, 'production-unsent-crm-deletion-058.sql');
      await writeFile(artifactPath, `${artifact}\nSELECT 'unreviewed';\n`);
      await expect(runner.applyProductionUnsentCrmDeletion058({ dryRun: true, artifactPath })).rejects.toThrow('does not match its reviewed artifact');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('uses immutable main and the protected migration environment', async () => {
    const source = await readFile(resolve(root, '.github/workflows/production-unsent-crm-deletion-058.yml'), 'utf8');
    const workflow = parse(source) as Workflow;
    const migrate = workflow.jobs?.migrate;
    const step = migrate?.steps?.find((candidate) => candidate.run?.includes('node scripts/apply-production-unsent-crm-deletion-058.mjs --dry-run'));
    expect(source).toContain('production-unsent-crm-deletion-058.yml@refs/heads/main');
    expect(migrate?.environment).toBe('production-trust-migrations');
    expect(step?.env).toEqual({ SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}' });
    expect(step?.run).toContain('npx --no-install supabase db query --linked --file supabase/production-unsent-crm-deletion-058.sql');
    expect(source).not.toContain('PRODUCTION_DATABASE_URL');
  });
});
