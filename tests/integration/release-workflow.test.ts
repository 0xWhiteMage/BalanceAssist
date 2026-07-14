// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Workflow = {
  on?: Record<string, unknown>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  jobs?: Record<string, { needs?: string[]; environment?: string; steps?: Array<{ name?: string; run?: string; env?: Record<string, string> }> }>;
};

async function workflow(name: string) {
  return parse(await readFile(resolve(process.cwd(), `.github/workflows/${name}`), 'utf8')) as Workflow;
}

describe('production release workflows', () => {
  it('deploys only a manually selected validated commit through protected promotion', async () => {
    const release = await workflow('production-release.yml');
    const source = await readFile(resolve(process.cwd(), '.github/workflows/production-release.yml'), 'utf8');
    const jobs = release.jobs ?? {};

    expect(release.on).toEqual({ workflow_dispatch: { inputs: { ref: { description: 'Immutable commit SHA to release', required: true, type: 'string' } } } });
    expect(release.concurrency).toEqual({ group: 'production-release', 'cancel-in-progress': false });
    expect(jobs.validate?.environment).toBeUndefined();
    expect(jobs.gates?.needs).toEqual(['validate']);
    expect(jobs.gates?.environment).toBe('production');
    const vercelAudit = jobs.gates?.steps?.find((step) => step.name === 'Verify Vercel dashboard release control');
    expect(vercelAudit?.env?.VERCEL_GIT_DEPLOYMENTS_DISABLED_AT).toBe('${{ vars.VERCEL_GIT_DEPLOYMENTS_DISABLED_AT }}');
    expect(vercelAudit?.run).toContain('test -n "$VERCEL_GIT_DEPLOYMENTS_DISABLED_AT"');
    expect(jobs.deploy?.needs).toEqual(['gates']);
    expect(jobs.smoke?.needs).toEqual(['deploy']);
    expect(jobs.migration?.needs).toEqual(['smoke']);
    expect(jobs.migration?.environment).toBe('production-migrations');
    expect(jobs.promote?.needs).toEqual(['deploy', 'migration']);
    expect(jobs.telegram?.needs).toEqual(['promote']);
    const validate = jobs.validate?.steps?.find((step) => step.name === 'Validate release commit');
    expect(validate?.env?.RELEASE_REF).toBe('${{ inputs.ref }}');
    expect(validate?.run).toContain('^[0-9a-f]{40}$');
    expect(validate?.run).toContain('git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main');
    expect(validate?.run).toContain('git merge-base --is-ancestor "$RELEASE_REF" origin/main');
    expect(validate?.run).toContain('release_sha="$(git rev-parse "$RELEASE_REF^{commit}")"');
    expect(source).not.toContain('ref: ${{ inputs.ref }}');
    expect(source).not.toContain('"${{ inputs.ref }}"');
    for (const job of Object.values(jobs).filter((job) => job.needs)) {
      const checkout = job.steps?.find((step) => step.name === 'Checkout validated release commit');
      if (checkout) expect(checkout.env?.RELEASE_SHA).toBe('${{ needs.validate.outputs.sha }}');
    }
    expect(jobs.deploy?.steps?.find((step) => step.name === 'Deploy immutable Vercel preview')?.run).toContain('vercel deploy --prebuilt');
    expect(jobs.deploy?.steps?.find((step) => step.name === 'Deploy immutable Vercel preview')?.run).toContain('--meta githubCommitSha="$GITHUB_SHA"');
    expect(jobs.smoke?.steps?.find((step) => step.name === 'Smoke immutable deployment')?.run).toContain('/api/health');
    expect(jobs.promote?.steps?.find((step) => step.name === 'Promote immutable deployment')?.run).toContain('vercel alias set');
    const telegram = jobs.telegram?.steps?.find((step) => step.name === 'Configure Telegram webhook');
    expect(telegram?.run).toContain('test -n "$PRODUCTION_URL"');
    expect(telegram?.run).toContain('test -n "$SETUP_TOKEN"');
    expect(telegram?.run).toContain('test -n "$TELEGRAM_BOT_TOKEN"');
    expect(telegram?.run).not.toContain('Skipping');
    expect(JSON.stringify(release)).toContain('refs/heads/main:refs/remotes/origin/main');
    const migrate = jobs.migration?.steps?.find((step) => step.name === 'Apply production migrations');
    expect(migrate?.env?.PRODUCTION_DATABASE_URL).toBe('${{ secrets.PRODUCTION_DATABASE_URL }}');
    expect(migrate?.run).toContain('test -n "$PRODUCTION_DATABASE_URL"');
    expect(migrate?.run).toContain('node scripts/apply-production-migrations.mjs');
    expect(migrate?.run).toContain('expand-only');
    expect(migrate?.run).not.toContain('secrets.');
    expect(JSON.stringify(release)).not.toContain('schedule');
    expect(JSON.stringify(release)).not.toContain('push');
  });
});
