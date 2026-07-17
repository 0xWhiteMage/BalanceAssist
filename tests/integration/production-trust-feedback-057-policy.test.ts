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
  return import(pathToFileURL(resolve(root, 'scripts/apply-production-trust-feedback-057.mjs')).href);
}

describe('production trust feedback 057 policy', () => {
  test('selects the reviewed migration and exact protected artifact', async () => {
    const runner = await loadRunner();
    expect(runner.trustFeedback057MigrationVersion).toBe('057');
    expect(runner.selectTrustFeedback057Migration([{ version: '057', filename: '057_event_deletion_freeze.sql', path: '/tmp/057' }]).version).toBe('057');
    expect(() => runner.selectTrustFeedback057Migration([])).toThrow('missing reviewed trust feedback migration 057');
    expect(() => runner.selectTrustFeedback057Migration([{ version: '057', filename: '057_renamed.sql', path: '/tmp/057' }])).toThrow('is not the reviewed file');
    await expect(runner.applyProductionTrustFeedback057({ dryRun: true })).resolves.toEqual({
      planned: ['057_event_deletion_freeze.sql'], schemaVersion: '057'
    });

    const source = (await readFile(resolve(root, 'supabase/migrations/057_event_deletion_freeze.sql'), 'utf8')).replace(/\r\n/g, '\n');
    const artifact = (await readFile(resolve(root, 'supabase/production-trust-feedback-057.sql'), 'utf8')).replace(/\r\n/g, '\n');
    expect(artifact).toContain('-- BEGIN 057 057_event_deletion_freeze.sql');
    expect(artifact).toContain(source);
    expect(artifact).toContain('SELECT pg_advisory_xact_lock(90442057);');
    expect(artifact).toContain("version = '056' AND filename = '056_trust_centered_session_controls.sql'");
    expect(artifact).toContain("tgenabled = 'O'");
    expect(artifact).toContain("tgfoid = 'public.guard_event_session_active()'::regprocedure");
    expect(artifact).toContain('tgtype = 7');
    expect(artifact).toContain('tgnargs = 0');
    expect(artifact).toContain('tgqual IS NULL');
    expect(artifact).toContain("RAISE EXCEPTION 'trust feedback migration 057 verification failed'");
    expect(artifact.trimEnd()).toMatch(/COMMIT;$/);
  });

  test('rejects a modified artifact', async () => {
    const runner = await loadRunner();
    const artifact = await readFile(resolve(root, 'supabase/production-trust-feedback-057.sql'), 'utf8');
    const dir = await mkdtemp(resolve(tmpdir(), 'balance-assist-trust-feedback-057-'));
    try {
      const artifactPath = resolve(dir, 'production-trust-feedback-057.sql');
      await writeFile(artifactPath, `${artifact}\nSELECT 'unreviewed';\n`);
      await expect(runner.applyProductionTrustFeedback057({ dryRun: true, artifactPath })).rejects.toThrow('does not match its reviewed artifact');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('uses immutable main and the protected production environment', async () => {
    const source = await readFile(resolve(root, '.github/workflows/production-trust-feedback-057.yml'), 'utf8');
    const workflow = parse(source) as Workflow;
    const migrate = workflow.jobs?.migrate;
    const step = migrate?.steps?.find((candidate) => candidate.run?.includes('node scripts/apply-production-trust-feedback-057.mjs --dry-run'));
    const commands = step?.run?.split(/\r?\n/).map((command) => command.trim()).filter(Boolean) ?? [];
    expect(source).toContain('production-trust-feedback-057.yml@refs/heads/main');
    expect(migrate?.environment).toBe('production-trust-migrations');
    expect(migrate?.env).toBeUndefined();
    expect(step?.env).toEqual({ SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}' });
    expect(commands.indexOf('node scripts/apply-production-trust-feedback-057.mjs --dry-run')).toBeLessThan(commands.indexOf('npx --no-install supabase link --project-ref vbdqjgwcmckutwehrbvo --yes'));
    expect(commands).toContain('npx --no-install supabase db query --linked --file supabase/production-trust-feedback-057.sql');
    expect(source).not.toContain('PRODUCTION_DATABASE_URL');
  });
});
