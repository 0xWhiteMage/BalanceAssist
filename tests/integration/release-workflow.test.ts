// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Workflow = {
  on?: Record<string, unknown>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  jobs?: Record<string, { needs?: string[]; environment?: string; steps?: Array<{ name?: string; uses?: string; with?: Record<string, string>; run?: string; env?: Record<string, string> }> }>;
};

async function workflow(name: string) {
  return parse(await readFile(resolve(process.cwd(), `.github/workflows/${name}`), 'utf8')) as Workflow;
}

describe('production release workflows', () => {
  it('deploys only a manually selected validated commit through protected promotion', async () => {
    const release = await workflow('production-release.yml');
    const source = await readFile(resolve(process.cwd(), '.github/workflows/production-release.yml'), 'utf8');
    const envExample = await readFile(resolve(process.cwd(), '.env.example'), 'utf8');
    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
    const packageJson = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
    const jobs = release.jobs ?? {};

    expect(release.on?.workflow_dispatch).toMatchObject({ inputs: {
      ref: { description: 'Immutable commit SHA to release', required: true, type: 'string' },
      reviewed_sha: { required: true, type: 'string' },
      product_review_ref: { required: true, type: 'string' },
      engineering_review_ref: { required: true, type: 'string' },
      accessibility_review_ref: { required: true, type: 'string' },
      conversation_review_ref: { required: true, type: 'string' },
      privacy_review_ref: { required: true, type: 'string' },
      deployment_proof_ref: { required: true, type: 'string' }
    } });
    expect(release.concurrency).toEqual({ group: 'production-release', 'cancel-in-progress': false });
    expect(jobs.validate?.environment).toBeUndefined();
    expect(jobs.gates?.needs).toEqual(['validate']);
    expect(jobs.gates?.environment).toBe('production');
    const sessionConfig = jobs.gates?.steps?.find((step) => step.name === 'Verify Vercel production session configuration');
    const sessionConfigIndex = jobs.gates?.steps?.indexOf(sessionConfig as NonNullable<typeof sessionConfig>) ?? -1;
    const installIndex = jobs.gates?.steps?.findIndex((step) => step.run === 'npm ci') ?? -1;
    expect(sessionConfigIndex).toBeGreaterThan(installIndex);
    expect(sessionConfig?.env?.VERCEL_TOKEN).toBe('${{ secrets.VERCEL_TOKEN }}');
    expect(sessionConfig?.env?.VERCEL_ORG_ID).toBe('${{ secrets.VERCEL_ORG_ID }}');
    expect(sessionConfig?.env?.VERCEL_PROJECT_ID).toBe('${{ secrets.VERCEL_PROJECT_ID }}');
    expect(sessionConfig?.run).toContain('test -n "$VERCEL_ORG_ID"');
    expect(sessionConfig?.run).toContain('test -n "$VERCEL_PROJECT_ID"');
    expect(sessionConfig?.run).toContain('vercel env pull');
    expect(sessionConfig?.run).toContain('--environment=production');
    expect(sessionConfig?.run).toContain("config.TRUSTED_CLIENT_IP_HEADER !== 'x-vercel-forwarded-for'");
    expect(sessionConfig?.run).toContain('https://balance-assist.vercel.app');
    expect(sessionConfig?.run).toContain("origin.includes('*')");
    expect(sessionConfig?.run).toContain("config.MONDAY_UPSERT_ENABLED !== 'false'");
    expect(sessionConfig?.run).toContain("config.MONDAY_CLEANUP_ENABLED !== 'false'");
    expect(sessionConfig?.run).toContain("config.SUPABASE_PRIVATE_UPLOAD_BUCKET !== 'temporary-attachments'");
    expect(sessionConfig?.run).toContain('TELEGRAM_WEBHOOK_SECRET');
    expect(sessionConfig?.run).toContain('CRON_SECRET');
    expect(envExample).toContain('ALLOWED_ORIGINS=https://balancestudio.tv,https://www.balancestudio.tv,https://balance-assist.vercel.app');
    expect(envExample).toContain('TRUSTED_CLIENT_IP_HEADER=x-vercel-forwarded-for');
    expect(readme).toContain('ALLOWED_ORIGINS=https://balancestudio.tv,https://www.balancestudio.tv,https://balance-assist.vercel.app');
    expect(readme).toContain('TRUSTED_CLIENT_IP_HEADER=x-vercel-forwarded-for');
    const vercelAudit = jobs.gates?.steps?.find((step) => step.name === 'Verify Vercel auto-deploy-disabled prerequisite');
    expect(vercelAudit?.env?.VERCEL_GIT_DEPLOYMENTS_DISABLED_AT).toBe('${{ vars.VERCEL_GIT_DEPLOYMENTS_DISABLED_AT }}');
    expect(vercelAudit?.env?.VERCEL_TOKEN).toBe('${{ secrets.VERCEL_TOKEN }}');
    expect(vercelAudit?.env?.VERCEL_ORG_ID).toBe('${{ secrets.VERCEL_ORG_ID }}');
    expect(vercelAudit?.env?.VERCEL_PROJECT_ID).toBe('${{ secrets.VERCEL_PROJECT_ID }}');
    expect(vercelAudit?.run).toContain('test -n "$VERCEL_GIT_DEPLOYMENTS_DISABLED_AT"');
    expect(vercelAudit?.run).toContain('^[0-9]{4}-[0-9]{2}-[0-9]{2}T');
    expect(vercelAudit?.run).toContain('90 * 24 * 60 * 60');
    expect(vercelAudit?.run).toContain('/v9/projects/${process.env.VERCEL_PROJECT_ID}');
    expect(vercelAudit?.run).toContain('Vercel project ID does not match the protected configuration');
    expect(vercelAudit?.run).toContain('Vercel project lookup failed');
    expect(vercelAudit?.run).toContain('Vercel project GitHub repository does not match');
    expect(vercelAudit?.run).toContain("project.link?.type?.startsWith('github')");
    expect(vercelAudit?.run).toContain('config.git?.deploymentEnabled?.main !== false');
    expect(sessionConfig?.run).toContain('TELEGRAM_ALLOWED_USER_IDS');
    expect(sessionConfig?.run).toContain("/^[1-9]\\d*$/");
    const schemaReadiness = jobs.gates?.steps?.find((step) => step.name === 'Verify production trust schema readiness');
    expect(schemaReadiness?.env?.SUPABASE_URL).toBe('${{ secrets.SUPABASE_URL }}');
    expect(schemaReadiness?.env?.SUPABASE_SERVICE_ROLE_KEY).toBe('${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}');
    expect(schemaReadiness?.env?.VERCEL_SUPABASE_URL).toBe('${{ steps.runtime-config.outputs.supabase_url }}');
    expect(schemaReadiness?.run).toContain('actual.origin !== expected.origin');
    expect(schemaReadiness?.run).toContain('version=in.(054,055,056,057,058,059)&select=version,filename');
    expect(schemaReadiness?.run).toContain("['057', '057_event_deletion_freeze.sql']");
    expect(schemaReadiness?.run).toContain("['058', '058_unsent_crm_deletion.sql']");
    expect(schemaReadiness?.run).toContain("['059', '059_consent_1_2_compatibility.sql']");
    expect(sessionConfig?.run).toContain("supabase.hostname !== 'vbdqjgwcmckutwehrbvo.supabase.co'");
    const supabaseProof = jobs.gates?.steps?.find((step) => step.name === 'Run mandatory Supabase release proof');
    expect(supabaseProof?.env?.REQUIRE_SUPABASE_RELEASE_PROOF).toBe('1');
    expect(supabaseProof?.run).toBe('npm run test:supabase');
    expect(jobs.deploy?.needs).toEqual(['gates', 'validate']);
    expect(jobs.smoke?.needs).toEqual(['deploy', 'validate']);
    expect(jobs.migration?.needs).toEqual(['smoke', 'validate']);
    expect(jobs.migration?.environment).toBe('production-migrations');
    expect(jobs['deployment-review']?.needs).toEqual(['deploy', 'migration', 'validate']);
    expect(jobs['deployment-review']?.environment).toBe('production-release-review');
    expect(jobs['deployment-review']?.steps?.find((step) => step.name === 'Verify immutable deployment entry accessibility')?.run)
      .toBe('node scripts/verify-deployment-widget.mjs');
    expect(jobs['deployment-review']?.steps?.find((step) => step.name === 'Verify approved deployment proof record')?.run)
      .toContain("'Relay-Replied'");
    expect(jobs.promote?.needs).toEqual(['deploy', 'migration', 'deployment-review', 'validate']);
    expect(jobs.telegram?.needs).toEqual(['promote', 'validate']);
    const promoteCheckout = jobs.promote?.steps?.find((step) => step.name === 'Checkout validated release commit');
    expect(promoteCheckout?.uses).toBe('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5');
    expect(promoteCheckout?.with?.ref).toBe('${{ needs.validate.outputs.sha }}');
    expect(promoteCheckout?.env?.RELEASE_SHA).toBe('${{ needs.validate.outputs.sha }}');
    const promoteSetupNode = jobs.promote?.steps?.find((step) => step.uses?.startsWith('actions/setup-node@'));
    expect(promoteSetupNode?.uses).toBe('actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020');
    expect(promoteSetupNode?.with).toMatchObject({ 'node-version-file': '.node-version', cache: 'npm' });
    expect(jobs.promote?.steps?.some((step) => step.run === 'npm ci')).toBe(true);
    for (const [name, job] of Object.entries(jobs)) {
      const hasCredentials = JSON.stringify(job).includes('secrets.') || job.environment !== undefined;
      if (hasCredentials) {
        expect(job.needs, name).toContain('validate');
        expect(JSON.stringify(job), name).toContain('needs.validate.outputs.sha');
      }
    }
    const validate = jobs.validate?.steps?.find((step) => step.name === 'Validate release commit');
    expect(validate?.env?.RELEASE_REF).toBe('${{ inputs.ref }}');
    expect(validate?.env?.REVIEWED_SHA).toBe('${{ inputs.reviewed_sha }}');
    expect(validate?.env?.GITHUB_TOKEN).toBe('${{ github.token }}');
    expect(validate?.run).toContain('test "$GITHUB_WORKFLOW_REF" = "$GITHUB_REPOSITORY/.github/workflows/production-release.yml@refs/heads/main"');
    expect(validate?.run).toContain('test "$REVIEWED_SHA" = "$RELEASE_REF"');
    expect(validate?.run).toContain('/actions/workflows/ci.yml/runs?head_sha=');
    expect(validate?.run).toContain("run.path === '.github/workflows/ci.yml'");
    expect(validate?.run).toContain("run.conclusion === 'success'");
    expect(validate?.run).toContain("labels.has('release-approved')");
    expect(validate?.run).toContain("line('Open-P1', '0')");
    expect(validate?.run).toContain('Reviewer-GitHub');
    expect(validate?.run).toContain('sort -u "$reviewer_list"');
    expect(validate?.run).toContain('/comments?per_page=100');
    expect(validate?.env?.TRUSTED_REVIEWERS).toBe('${{ vars.RELEASE_TRUSTED_REVIEWERS }}');
    expect(validate?.env?.MIN_REVIEWERS).toBe('${{ vars.RELEASE_MIN_REVIEWERS }}');
    expect(validate?.run).toContain('[[ "$MIN_REVIEWERS" =~ ^[1-5]$ ]]');
    expect(validate?.run).toContain('test -n "$TRUSTED_REVIEWERS"');
    expect(validate?.run).toContain('unique.size !== entries.length || unique.size < minimum');
    expect(validate?.run).toContain('trustedReviewers.has(reviewer.toLowerCase())');
    for (const [role, variable] of [
      ['product-ux', 'PRODUCT_REVIEW_REF'],
      ['engineering', 'ENGINEERING_REVIEW_REF'],
      ['accessibility', 'ACCESSIBILITY_REVIEW_REF'],
      ['conversation', 'CONVERSATION_REVIEW_REF'],
      ['trust-privacy', 'PRIVACY_REVIEW_REF'],
    ]) {
      expect(validate?.run).toContain(`validate_review ${role} "$${variable}"`);
    }
    expect(validate?.run).toContain('test "$(sort -u "$reviewer_list" | wc -l)" -ge "$MIN_REVIEWERS"');
    expect(validate?.run).not.toContain('test "$(sort -u "$reviewer_list" | wc -l)" = "5"');
    expect(source).not.toContain('trustedReviewers.size < 5');
    expect(validate?.run).toContain('^[0-9a-f]{40}$');
    expect(validate?.run).toContain('git fetch --no-tags origin +refs/heads/main:refs/remotes/origin/main');
    expect(validate?.run).toContain('git merge-base --is-ancestor "$RELEASE_REF" origin/main');
    expect(validate?.run).toContain('release_sha="$(git rev-parse "$RELEASE_REF^{commit}")"');
    expect(source).not.toContain('ref: ${{ inputs.ref }}');
    expect(source).not.toContain('"${{ inputs.ref }}"');
    for (const job of Object.values(jobs).filter((job) => job.needs)) {
      const checkout = job.steps?.find((step) => step.name === 'Checkout validated release commit');
      if (checkout) {
        expect(checkout.env?.RELEASE_SHA).toBe('${{ needs.validate.outputs.sha }}');
        expect(checkout.with?.['persist-credentials']).toBe(false);
      }
    }
    const immutableDeploy = jobs.deploy?.steps?.find((step) => step.name === 'Deploy immutable Vercel candidate');
    expect(immutableDeploy?.env?.RELEASE_SHA).toBe('${{ needs.validate.outputs.sha }}');
    expect(immutableDeploy?.run).toContain('vercel build --prod');
    expect(immutableDeploy?.run).toContain('vercel deploy --prebuilt');
    expect(immutableDeploy?.run).toContain('--prod --skip-domain');
    expect(immutableDeploy?.run).toContain('--meta githubCommitSha="$GITHUB_SHA"');
    expect(jobs.smoke?.steps?.find((step) => step.name === 'Smoke immutable deployment')?.run).toContain('/api/health');
    const immutableSmoke = jobs.smoke?.steps?.find((step) => step.name === 'Smoke immutable deployment');
    expect(immutableSmoke?.env?.SUPABASE_URL).toBe('${{ secrets.SUPABASE_URL }}');
    expect(immutableSmoke?.env?.SUPABASE_SERVICE_ROLE_KEY).toBe('${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}');
    expect(immutableSmoke?.run).toContain('/rest/v1/schema_migrations?select=version&limit=1');
    expect(immutableSmoke?.run).toContain('--output /dev/null');
    expect(immutableSmoke?.run).toContain('--connect-timeout 5');
    expect(immutableSmoke?.run).toContain('POST');
    expect(immutableSmoke?.run).toContain('$DEPLOYMENT_URL/api/sessions');
    expect(immutableSmoke?.run).toContain('origin: https://balance-assist.vercel.app');
    expect(immutableSmoke?.run).toContain('{\\"sourceUrl\\":\\"https://balance-assist.vercel.app/session-smoke\\",\\"consentVersion\\":\\"1.2\\",\\"consentedAt\\":\\"$consented_at\\"}');
    expect(immutableSmoke?.run).toContain('date -u +%Y-%m-%dT%H:%M:%SZ');
    expect(immutableSmoke?.run).not.toContain('consents');
    expect(immutableSmoke?.run).toContain('session.persisted !== true');
    expect(immutableSmoke?.run).toContain('set-cookie:');
    expect(immutableSmoke?.run).toContain('HttpOnly');
    expect(immutableSmoke?.run).toContain('/api/projects/$session_id/delete');
    expect(immutableSmoke?.run).toContain("typeof deletion.receiptId !== 'string'");
    expect(immutableSmoke?.run).toContain("deletion.status !== 'requested'");
    expect(immutableSmoke?.run).toContain('$DEPLOYMENT_URL/api/events');
    expect(immutableSmoke?.run).toContain('test "$event_status" = "409"');
    expect(immutableSmoke?.run).toContain("event.error !== 'event_session_inactive'");
    expect(immutableSmoke?.run).toContain('trap');
    expect(jobs.promote?.steps?.find((step) => step.name === 'Promote immutable deployment')?.run).toContain('vercel alias set');
    const aliasSmoke = jobs.promote?.steps?.find((step) => step.name === 'Smoke promoted production alias');
    expect(aliasSmoke?.run).toContain('$PRODUCTION_URL/api/health');
    expect(aliasSmoke?.run).toContain('/rest/v1/schema_migrations?select=version&limit=1');
    expect(aliasSmoke?.run).toContain('POST');
    expect(aliasSmoke?.run).toContain('$PRODUCTION_URL/api/sessions');
    expect(aliasSmoke?.run).toContain('origin: https://balance-assist.vercel.app');
    expect(aliasSmoke?.run).toContain('{\\"sourceUrl\\":\\"https://balance-assist.vercel.app/session-smoke\\",\\"consentVersion\\":\\"1.2\\",\\"consentedAt\\":\\"$consented_at\\"}');
    expect(aliasSmoke?.run).toContain('date -u +%Y-%m-%dT%H:%M:%SZ');
    expect(aliasSmoke?.run).not.toContain('consents');
    expect(aliasSmoke?.run).toContain('session.persisted !== true');
    expect(aliasSmoke?.run).toContain('set-cookie:');
    expect(aliasSmoke?.run).toContain('HttpOnly');
    expect(aliasSmoke?.run).toContain('/api/projects/$session_id/delete');
    expect(aliasSmoke?.run).toContain("typeof deletion.receiptId !== 'string'");
    expect(aliasSmoke?.run).toContain("deletion.status !== 'requested'");
    expect(aliasSmoke?.run).toContain('$PRODUCTION_URL/api/events');
    expect(aliasSmoke?.run).toContain('test "$event_status" = "409"');
    expect(aliasSmoke?.run).toContain("event.error !== 'event_session_inactive'");
    expect(aliasSmoke?.run).toContain('trap');
    const telegram = jobs.telegram?.steps?.find((step) => step.name === 'Configure Telegram webhook');
    expect(telegram?.run).toContain('test -n "$PRODUCTION_URL"');
    expect(telegram?.run).toContain('test -n "$SETUP_TOKEN"');
    expect(telegram?.run).toContain('test -n "$TELEGRAM_BOT_TOKEN"');
    expect(telegram?.run).toContain('\\"dropPending\\":false');
    expect(telegram?.run).not.toContain('Skipping');
    expect(JSON.stringify(release)).toContain('refs/heads/main:refs/remotes/origin/main');
    const migrate = jobs.migration?.steps?.find((step) => step.name === 'Apply production migrations');
    expect(migrate?.env?.PRODUCTION_DATABASE_URL).toBe('${{ secrets.PRODUCTION_DATABASE_URL }}');
    expect(migrate?.run).toContain('test -n "$PRODUCTION_DATABASE_URL"');
    expect(migrate?.run).toContain('node scripts/apply-production-migrations.mjs');
    expect(migrate?.run).toContain('node scripts/apply-production-consent-1-2-059-repair.mjs --dry-run');
    expect(migrate?.run).toContain('node scripts/apply-production-api-security-061.mjs --dry-run');
    expect(migrate?.run).toContain("version = '061'");
    expect(migrate?.run).toContain('supabase/production-api-security-061.sql');
    expect(migrate?.run).toContain("'public.reserve_session_upload_quota(uuid,bigint,bigint)'::regprocedure");
    expect(migrate?.run).toContain("reservations.relrowsecurity !== true");
    expect(migrate?.run).toContain('fn.service_role_execute !== true');
    expect(migrate?.run).toContain('expand-only');
    expect(migrate?.run).toContain("t.tgname = 'events_require_active_session'");
    expect(migrate?.run).toContain("row.tgenabled === 'O'");
    expect(migrate?.run).toContain('(?:public\\.)?guard_event_session_active');
    expect(migrate?.run).toContain('Production baseline verification failed:');
    expect(migrate?.run).toContain("assertReviewedBody(row.prosrc, 'supabase/migrations/057_event_deletion_freeze.sql'");
    expect(migrate?.run).toContain("assertReviewedBody(crmDeletion.prosrc, 'supabase/migrations/058_unsent_crm_deletion.sql'");
    expect(migrate?.run).toContain("assertReviewedBody(compatibility.prosrc, 'supabase/migrations/059_consent_1_2_compatibility.sql'");
    expect(migrate?.run).toContain("createHash('sha256').update(value ?? '').digest('hex')");
    expect(migrate?.run).toContain('first differing line');
    expect(migrate?.run).toContain("bodySha256(repair.prosrc.trim()) === '7bcba5a99145ead5ce20700a06b37e7c911f8099853f5ce9c450a8213a385215'");
    expect(migrate?.run).toContain('pg_advisory_xact_lock(90442059)');
    expect(migrate?.run).toContain('059 repair blocked after 060');
    expect(migrate?.run).toContain('059 repair function attributes');
    expect(migrate?.run).toContain('supabase/production-consent-1-2-compatibility-059-repair.sql');
    expect(migrate?.run).toContain("database.hostname === `db.${projectRef}.supabase.co`");
    expect(migrate?.run).toContain("database.searchParams.set('uselibpqcompat', 'true')");
    expect(migrate?.run).toContain("['require', 'verify-full'].includes(option)");
    expect(migrate?.run).not.toContain('ssl: { rejectUnauthorized: true }');
    expect(migrate?.run).toContain("row.owner === 'postgres'");
    expect(jobs.promote?.environment).toBe('production-consent-cutover');
    const cutover = jobs.promote?.steps?.find((step) => step.name === 'Apply consent 1.2 cutover');
    expect(cutover?.run).toContain('node scripts/apply-production-consent-1-2-cutover-060.mjs --dry-run');
    expect(cutover?.run).toContain("database.searchParams.set('uselibpqcompat', 'true')");
    expect(cutover?.run).toContain("fn.owner !== 'postgres'");
    expect(cutover?.run).toContain('vercel alias set "$PREVIOUS_DEPLOYMENT_URL" "$PRODUCTION_URL"');
    expect(migrate?.run).not.toContain('secrets.');
    expect(source.indexOf('Verify Vercel auto-deploy-disabled prerequisite')).toBeLessThan(source.indexOf('node scripts/apply-production-api-security-061.mjs --dry-run'));
    expect(source.indexOf('node scripts/apply-production-api-security-061.mjs --dry-run')).toBeLessThan(source.indexOf('name: Verify approved deployment proof record'));
    expect(source).not.toContain('deletion.jobId');
    expect(source).toContain('npm audit --omit=dev --audit-level=high');
    for (const [, action] of source.matchAll(/^\s*uses:\s+([^\s]+)$/gm)) {
      expect(action).toMatch(/@[0-9a-f]{40}$/);
    }
    expect(packageJson.devDependencies.vercel).toBe('56.1.0');
    expect(packageJson.overrides).toMatchObject({
      '@tootallnate/once': '2.0.1',
      minimatch: '10.2.3',
      'path-to-regexp': '8.4.0',
      tar: '7.5.16',
      undici: '6.27.0',
      '@vercel/node': { 'path-to-regexp': '6.3.0' },
      '@vercel/remix-builder': { 'path-to-regexp': '6.3.0' },
    });
    expect(source).toContain('./node_modules/.bin/vercel pull');
    expect(source).toContain('./node_modules/.bin/vercel build');
    expect(source).toContain('./node_modules/.bin/vercel deploy');
    expect(source).toContain('./node_modules/.bin/vercel alias set');
    expect(source).not.toMatch(/(?:npx|npm exec) vercel/);
    expect(release.on).not.toHaveProperty('schedule');
    expect(release.on).not.toHaveProperty('push');

    const shellSource = Object.values(jobs)
      .flatMap((job) => job.steps ?? [])
      .flatMap((step) => step.run?.includes('\n') ? [step.run] : [])
      .join('\n');
    expect(shellSource.match(/<<'NODE'/g)?.length).toBe(shellSource.match(/^NODE$/gm)?.length);
    const syntax = spawnSync('bash', ['-n'], { input: shellSource, encoding: 'utf8' });
    expect(syntax.error, 'could not invoke bash').toBeUndefined();
    expect(syntax.status, syntax.stderr).toBe(0);
  }, 15_000);
});
