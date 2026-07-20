// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  applyProductionOrphanedPrivateAttachmentCleanup045,
  orphanedPrivateAttachmentCleanup045MigrationVersion,
  selectOrphanedPrivateAttachmentCleanup045Migration
} from '../../scripts/apply-production-orphaned-private-attachment-cleanup-045.mjs';

const root = process.cwd();

describe('production orphaned private attachment cleanup 045 policy', () => {
  it('selects only the exact reviewed migration', () => {
    expect(orphanedPrivateAttachmentCleanup045MigrationVersion).toBe('045');
    expect(selectOrphanedPrivateAttachmentCleanup045Migration([
      { version: '045', filename: '045_orphaned_private_attachment_cleanup.sql', path: '/tmp/045' }
    ])).toMatchObject({ version: '045' });
    expect(() => selectOrphanedPrivateAttachmentCleanup045Migration([])).toThrow('missing reviewed');
    expect(() => selectOrphanedPrivateAttachmentCleanup045Migration([
      { version: '045', filename: '045_other.sql', path: '/tmp/045' }
    ])).toThrow('not the reviewed file');
  });

  it('hash-verifies the reviewed source and artifact', async () => {
    await expect(applyProductionOrphanedPrivateAttachmentCleanup045({ dryRun: true })).resolves.toEqual({
      planned: ['045_orphaned_private_attachment_cleanup.sql'],
      schemaVersion: '045'
    });
    const artifact = await readFile(resolve(root, 'supabase/production-orphaned-private-attachment-cleanup-045.sql'), 'utf8');
    const dir = await mkdtemp(resolve(tmpdir(), 'balance-assist-cleanup-045-'));
    const path = resolve(dir, 'artifact.sql');
    try {
      await writeFile(path, `${artifact}\nSELECT 'unreviewed';\n`);
      await expect(applyProductionOrphanedPrivateAttachmentCleanup045({ dryRun: true, artifactPath: path }))
        .rejects.toThrow('does not match its reviewed artifact');
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it('uses an atomic artifact with baseline and postcondition checks', async () => {
    const source = (await readFile(resolve(root, 'supabase/migrations/045_orphaned_private_attachment_cleanup.sql'), 'utf8')).replace(/\r\n/g, '\n');
    const artifact = (await readFile(resolve(root, 'supabase/production-orphaned-private-attachment-cleanup-045.sql'), 'utf8')).replace(/\r\n/g, '\n');
    expect(artifact).toContain(source);
    expect(artifact).toContain('SELECT pg_advisory_xact_lock(90442045)');
    expect(artifact).toContain("version = '043' AND filename = '043_deletion_state_batched_cleanup.sql'");
    expect(artifact).toContain("version = '044' AND filename = '044_monday_crm_projection_tables.sql'");
    expect(artifact).toContain("to_regclass('storage.objects')");
    expect(artifact).toContain("VALUES ('045', '045_orphaned_private_attachment_cleanup.sql')");
    expect(artifact).toContain('ON CONFLICT (version) DO NOTHING');
    expect(artifact).toContain("filename <> '045_orphaned_private_attachment_cleanup.sql'");
    expect(artifact).not.toContain('is already recorded');
    expect(artifact.trimEnd()).toMatch(/COMMIT;$/);
  });

  it('runs only through the protected backup-attested workflow', async () => {
    const source = await readFile(resolve(root, '.github/workflows/production-orphaned-private-attachment-cleanup-045.yml'), 'utf8');
    const workflow = parse(source) as { jobs?: Record<string, { environment?: string; steps?: Array<{ uses?: string; env?: Record<string, string>; run?: string }> }> };
    const cleanup = workflow.jobs?.cleanup;
    const step = cleanup?.steps?.find((candidate) => candidate.run?.includes('apply-production-orphaned-private-attachment-cleanup-045.mjs --dry-run'));
    expect(cleanup?.environment).toBe('production-cleanup-migrations');
    expect(step?.env?.SUPABASE_ACCESS_TOKEN).toBe('${{ secrets.SUPABASE_ACCESS_TOKEN }}');
    expect(step?.env?.PRODUCTION_BACKUP_AUDIT_REFERENCE).toBe('${{ secrets.PRODUCTION_BACKUP_AUDIT_REFERENCE }}');
    expect(step?.run).toContain('test "$backup_release_sha" = "$RELEASE_SHA"');
    expect(step?.run).toContain('production-cleanup-backup.yml');
    expect(step?.run).toContain('cleanup-backup-manifest-${runId}');
    expect(step?.run).toContain('per_page=1');
    expect(step?.run).toContain('String(latestRuns[0].id) !== runId');
    expect(step?.run).toContain('manifest.sealed !== true');
    expect(step?.run).toContain('24 * 60 * 60');
    expect(step?.run).toContain('supabase db query --linked --file supabase/production-orphaned-private-attachment-cleanup-045.sql');
    expect(source).not.toContain('PRODUCTION_DATABASE_URL');
    for (const [, action] of source.matchAll(/^\s*uses:\s+([^\s]+)$/gm)) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });
});
