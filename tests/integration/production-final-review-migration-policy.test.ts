// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const root = process.cwd();
type Workflow = {
  jobs?: Record<string, {
    environment?: string;
    env?: Record<string, string>;
    steps?: Array<{ env?: Record<string, string>; run?: string }>;
  }>;
};

async function loadRunner() {
  return import(pathToFileURL(resolve(root, 'scripts/apply-production-final-review-migration.mjs')).href);
}

describe('production final review migration policy', () => {
  it('defines the objective, payload, and minimal approval return contracts in forward migration 055', async () => {
    const source = await readFile(resolve(root, 'supabase/migrations/055_final_review_approval.sql'), 'utf8');

    expect(source).toContain('DROP FUNCTION public.finalize_session_lead(uuid);');
    expect(source).toMatch(/crm_queued boolean,\s+approval_input_hash text,\s+approved_reference_set_hash text/);
    expect(source).toContain("btrim(v_objective) = '' AND btrim(v_timeline) = ''");
    for (const field of ['projectObjective', 'audience', 'intendedOutputs', 'scopePolished', 'referencesStatus']) {
      expect(source).toContain(`'${field}'`);
    }
    expect(source).toContain(`format('{"kind":%s,"url":%s}'`);
    expect(source).toContain("digest(convert_to(v_reference_hash_input, 'UTF8'), 'sha256')");
  });

  it('permits only reviewed final review migration 055', async () => {
    const runner = await loadRunner();

    expect(runner.finalReviewMigrationVersion).toBe('055');
    expect(runner.selectFinalReviewMigration([
      { version: '054', filename: '054_human_contact_consent.sql', path: '/tmp/054' },
      { version: '055', filename: '055_final_review_approval.sql', path: '/tmp/055' },
      { version: '056', filename: '056_additive.sql', path: '/tmp/056' }
    ]).version).toBe('055');
    expect(() => runner.selectFinalReviewMigration([])).toThrow('missing reviewed final review migration 055');
    expect(() => runner.selectFinalReviewMigration([{ version: '055', filename: '055_renamed.sql', path: '/tmp/055' }]))
      .toThrow('is not the reviewed file');
  });

  it('hash-verifies the reviewed source and independent SQL Editor artifact', async () => {
    const runner = await loadRunner();
    await expect(runner.applyProductionFinalReviewMigration({ dryRun: true })).resolves.toEqual({
      planned: ['055_final_review_approval.sql'],
      schemaVersion: '055'
    });

    const source = (await readFile(resolve(root, 'supabase/migrations/055_final_review_approval.sql'), 'utf8')).replace(/\r\n/g, '\n');
    const artifact = (await readFile(resolve(root, 'supabase/production-final-review-055.sql'), 'utf8')).replace(/\r\n/g, '\n');

    expect(artifact).toContain('-- BEGIN 055 055_final_review_approval.sql');
    expect(artifact).toContain(source);
    expect(artifact).toContain('SELECT pg_advisory_xact_lock(90442055);');
    expect(artifact).toContain("version = '054' AND filename = '054_human_contact_consent.sql'");
    expect(artifact).toContain("version = '055'");
    expect(artifact).toContain("RAISE EXCEPTION 'final review migration verification failed'");
    expect(artifact.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('rejects an artifact with appended SQL during dry-run verification', async () => {
    const runner = await loadRunner();
    const artifact = await readFile(resolve(root, 'supabase/production-final-review-055.sql'), 'utf8');
    const artifactDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-final-review-artifact-'));
    const artifactPath = resolve(artifactDir, 'production-final-review-055.sql');

    try {
      await writeFile(artifactPath, `${artifact}\nSELECT 'unreviewed artifact SQL';\n`);
      await expect(runner.applyProductionFinalReviewMigration({ dryRun: true, artifactPath }))
        .rejects.toThrow('does not match its reviewed artifact');
    } finally {
      await rm(artifactDir, { force: true, recursive: true });
    }
  });

  it('uses an immutable-main workflow and the protected trust migration environment', async () => {
    const source = await readFile(resolve(root, '.github/workflows/production-final-review-migration.yml'), 'utf8');
    const workflow = parse(source) as Workflow;
    const migrate = workflow.jobs?.migrate;
    const migrationStep = migrate?.steps?.find((step) => step.run?.includes('node scripts/apply-production-final-review-migration.mjs --dry-run'));
    const commands = migrationStep?.run?.split(/\r?\n/).map((command) => command.trim()).filter(Boolean) ?? [];
    const dryRunIndex = commands.indexOf('node scripts/apply-production-final-review-migration.mjs --dry-run');
    const linkCommand = 'npx --no-install supabase link --project-ref vbdqjgwcmckutwehrbvo --yes';
    const artifactCommand = 'npx --no-install supabase db query --linked --file supabase/production-final-review-055.sql';

    expect(source).toContain('production-final-review-migration.yml@refs/heads/main');
    expect(migrate?.environment).toBe('production-trust-migrations');
    expect(migrate?.env).toBeUndefined();
    expect(migrationStep?.env).toEqual({ SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}' });
    expect(dryRunIndex).toBeGreaterThanOrEqual(0);
    expect(commands.indexOf(linkCommand)).toBeGreaterThan(dryRunIndex);
    expect(commands.indexOf(artifactCommand)).toBeGreaterThan(commands.indexOf(linkCommand));
    expect(source).not.toContain('production-trust-controls-054.sql');
    expect(source).not.toContain('PRODUCTION_DATABASE_URL');
  });
});
