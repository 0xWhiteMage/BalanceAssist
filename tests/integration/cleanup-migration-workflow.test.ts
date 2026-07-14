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

describe('production cleanup migration workflow', () => {
  it('requires a fresh backup attestation and validated protected-main SHA before protected cleanup', async () => {
    const source = await readFile(resolve(process.cwd(), '.github/workflows/production-cleanup-migrations.yml'), 'utf8');
    const workflow = parse(source) as Workflow;
    const jobs = workflow.jobs ?? {};

    expect(workflow.on).toEqual({ workflow_dispatch: { inputs: {
      ref: { description: 'Immutable commit SHA containing the reviewed cleanup migrations', required: true, type: 'string' },
      backup_audit_attestation: { description: 'BACKUP_AUDIT_VERIFIED:<UTC ISO-8601 timestamp>, no more than 24 hours old', required: true, type: 'string' }
    } } });
    expect(workflow.concurrency).toEqual({ group: 'production-cleanup-migrations', 'cancel-in-progress': false });
    expect(jobs.validate?.environment).toBeUndefined();
    expect(jobs.cleanup?.needs).toEqual(['validate']);
    expect(jobs.cleanup?.environment).toBe('production-cleanup-migrations');
    expect(jobs.smoke?.needs).toEqual(['cleanup', 'validate']);
    expect(jobs.smoke?.environment).toBe('production-cleanup-migrations');

    const validate = jobs.validate?.steps?.find((step) => step.name === 'Validate cleanup commit and backup audit attestation');
    expect(validate?.env?.RELEASE_REF).toBe('${{ inputs.ref }}');
    expect(validate?.env?.BACKUP_AUDIT_ATTESTATION).toBe('${{ inputs.backup_audit_attestation }}');
    expect(validate?.run).toContain('set -euo pipefail');
    expect(validate?.run).toContain('^[0-9a-f]{40}$');
    expect(validate?.run).toContain('git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main');
    expect(validate?.run).toContain('git merge-base --is-ancestor "$RELEASE_REF" origin/main');
    expect(validate?.run).toContain('release_sha="$(git rev-parse "$RELEASE_REF^{commit}")"');
    expect(validate?.run).toContain('^BACKUP_AUDIT_VERIFIED:');
    expect(validate?.run).toContain('24 * 60 * 60');
    expect(validate?.run).toContain('test "$attested_at" -le "$now"');

    const cleanup = jobs.cleanup?.steps?.find((step) => step.name === 'Dry-run, apply, and verify reviewed cleanup migrations');
    expect(cleanup?.env?.PRODUCTION_DATABASE_URL).toBe('${{ secrets.PRODUCTION_DATABASE_URL }}');
    expect(cleanup?.run).toContain('test "$(git rev-parse HEAD)" = "$RELEASE_SHA"');
    expect(cleanup?.run).toContain('node scripts/apply-production-cleanup-migrations.mjs --dry-run');
    expect(cleanup?.run).toContain('node scripts/apply-production-cleanup-migrations.mjs');
    expect(cleanup?.run).toContain('038,039,040,041,042');
    expect(cleanup?.run).toContain('$GITHUB_STEP_SUMMARY');

    expect(jobs.smoke?.steps?.find((step) => step.name === 'Smoke post-cleanup production health')?.run).toContain('$PRODUCTION_URL/api/health');
    expect(source).not.toMatch(/\bvercel\b|deploy\s|alias\s|telegram|webhook|npm run build/i);
  });
});
