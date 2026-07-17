// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
type Workflow = { jobs?: Record<string, { environment?: string; env?: Record<string, string>; steps?: Array<{ env?: Record<string, string>; run?: string }> }> };

async function loadRunner() {
  return import(pathToFileURL(resolve(root, 'scripts/apply-production-trust-controls-056.mjs')).href);
}

describe('production trust controls 056 policy', () => {
  it('selects only the reviewed 056 migration and verifies the independent artifact', async () => {
    const runner = await loadRunner();
    expect(runner.trustControls056MigrationVersion).toBe('056');
    expect(runner.selectTrustControls056Migration([{ version: '056', filename: '056_trust_centered_session_controls.sql', path: '/tmp/056' }]).version).toBe('056');
    expect(() => runner.selectTrustControls056Migration([])).toThrow('missing reviewed trust controls migration 056');
    expect(() => runner.selectTrustControls056Migration([{ version: '056', filename: '056_renamed.sql', path: '/tmp/056' }])).toThrow('is not the reviewed file');
    await expect(runner.applyProductionTrustControls056({ dryRun: true })).resolves.toEqual({
      planned: ['056_trust_centered_session_controls.sql'], schemaVersion: '056'
    });

    const source = (await readFile(resolve(root, 'supabase/migrations/056_trust_centered_session_controls.sql'), 'utf8')).replace(/\r\n/g, '\n');
    const artifact = (await readFile(resolve(root, 'supabase/production-trust-controls-056.sql'), 'utf8')).replace(/\r\n/g, '\n');
    expect(artifact).toContain('-- BEGIN 056 056_trust_centered_session_controls.sql');
    expect(artifact).toContain(source);
    expect(artifact).toContain('SELECT pg_advisory_xact_lock(90442056);');
    expect(artifact).toContain("version = '055' AND filename = '055_final_review_approval.sql'");
    expect(artifact).toContain("RAISE EXCEPTION 'trust controls migration 056 verification failed'");
    expect(artifact.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('rejects modified artifacts', async () => {
    const runner = await loadRunner();
    const artifact = await readFile(resolve(root, 'supabase/production-trust-controls-056.sql'), 'utf8');
    const dir = await mkdtemp(resolve(tmpdir(), 'balance-assist-trust-056-'));
    try {
      const artifactPath = resolve(dir, 'production-trust-controls-056.sql');
      await writeFile(artifactPath, `${artifact}\nSELECT 'unreviewed';\n`);
      await expect(runner.applyProductionTrustControls056({ dryRun: true, artifactPath })).rejects.toThrow('does not match its reviewed artifact');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses immutable main and the protected production environment', async () => {
    const source = await readFile(resolve(root, '.github/workflows/production-trust-controls-056.yml'), 'utf8');
    const workflow = parse(source) as Workflow;
    const migrate = workflow.jobs?.migrate;
    const step = migrate?.steps?.find((candidate) => candidate.run?.includes('node scripts/apply-production-trust-controls-056.mjs --dry-run'));
    const commands = step?.run?.split(/\r?\n/).map((command) => command.trim()).filter(Boolean) ?? [];
    expect(source).toContain('production-trust-controls-056.yml@refs/heads/main');
    expect(migrate?.environment).toBe('production-trust-migrations');
    expect(migrate?.env).toBeUndefined();
    expect(step?.env).toEqual({ SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}' });
    expect(commands.indexOf('node scripts/apply-production-trust-controls-056.mjs --dry-run')).toBeLessThan(commands.indexOf('npx --no-install supabase link --project-ref vbdqjgwcmckutwehrbvo --yes'));
    expect(commands).toContain('npx --no-install supabase db query --linked --file supabase/production-trust-controls-056.sql');
    expect(source).not.toContain('PRODUCTION_DATABASE_URL');
  });
});
