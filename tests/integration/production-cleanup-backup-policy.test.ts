// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  assertProductionDatabaseUrl,
  buildBackupAuditReference,
  cleanupBackupProjectRef,
  cleanupBackupProvider,
  normalizeSessionPoolerUrl,
  productionProjectRef
} from '../../scripts/create-production-cleanup-backup.mjs';

const root = process.cwd();

describe('production cleanup backup policy', () => {
  it('binds an audit reference to the immutable release and verified target', () => {
    const manifest = {
      createdAt: '2026-07-20T16:00:00.000Z',
      provider: cleanupBackupProvider,
      backupId: `${cleanupBackupProjectRef}-run-123`,
      releaseSha: 'a'.repeat(40)
    };
    expect(buildBackupAuditReference(manifest)).toBe(
      `BACKUP_AUDIT:2026-07-20T16:00:00.000Z|supabase-project-snapshot|${cleanupBackupProjectRef}-run-123|${'a'.repeat(40)}`
    );
    expect(productionProjectRef).not.toBe(cleanupBackupProjectRef);
  });

  it('uses the session pooler for exported PostgreSQL snapshots', () => {
    expect(normalizeSessionPoolerUrl('postgresql://postgres:secret@example.supabase.com:6543/postgres?sslmode=require'))
      .toBe('postgresql://postgres:secret@example.supabase.com:5432/postgres');
    expect(() => assertProductionDatabaseUrl('postgresql://postgres:secret@db.example.com/postgres'))
      .toThrow('not the reviewed production database');
  });

  it('runs only from trusted main with protected production credentials', async () => {
    const source = await readFile(resolve(root, '.github/workflows/production-cleanup-backup.yml'), 'utf8');
    const workflow = parse(source) as {
      jobs?: Record<string, { environment?: string; steps?: Array<{ uses?: string; env?: Record<string, string>; run?: string }> }>;
    };
    const snapshot = workflow.jobs?.snapshot;
    const backup = snapshot?.steps?.find((step) => step.run?.includes('create-production-cleanup-backup.mjs'));
    expect(source).toContain('production-cleanup-backup.yml@refs/heads/main');
    expect(source).toContain('group: production-cleanup-migrations');
    expect(snapshot?.environment).toBe('Production');
    expect(backup?.env?.SOURCE_DATABASE_URL).toBe('${{ secrets.PRODUCTION_DATABASE_URL }}');
    expect(backup?.env?.SOURCE_SUPABASE_SERVICE_ROLE_KEY).toBe('${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}');
    expect(backup?.env?.SUPABASE_ACCESS_TOKEN).toBe('${{ secrets.SUPABASE_ACCESS_TOKEN }}');
    expect(backup?.env?.TARGET_SUPABASE_URL).toContain(cleanupBackupProjectRef);
    expect(source).not.toContain('pull_request');
    for (const [, action] of source.matchAll(/^\s*uses:\s+([^\s]+)$/gm)) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });

  it('seals credentials and verifies database and private object copies', async () => {
    const source = await readFile(resolve(root, 'scripts/create-production-cleanup-backup.mjs'), 'utf8');
    expect(source).toContain("api-keys/legacy?enabled=false");
    expect(source).toContain("legacy?.enabled !== false");
    expect(source).toContain("key.type === 'secret'");
    const snapshot = source.slice(source.indexOf('export async function createProductionCleanupBackup()'));
    expect(snapshot.indexOf('createTemporaryTargetKey(accessToken, runId)'))
      .toBeLessThan(snapshot.indexOf('prepareTargetApi(accessToken, temporaryKey.id)'));
    expect(source).toContain('postgres@sha256:');
    expect(source).toContain('pg_export_snapshot()');
    expect(source).toContain('--snapshot="$SOURCE_SNAPSHOT"');
    expect(source).toContain('assertMatchingCounts(sourceCounts, targetCounts)');
    expect(source).toContain("createHash('sha256').update(sourceBytes)");
    expect(source).toContain('targetHash !== sourceHash');
    expect(source).toContain("PGSSLMODE: sourceSslMode");
    expect(source).toContain("response.status !== 429");
    expect(source).toContain("response.headers.get('retry-after')");
    expect(source).toContain('await resetDatabasePassword(accessToken, sealedTargetPassword)');
    expect(source).toContain('export async function sealProductionCleanupBackupTarget()');
    expect(source).not.toContain('console.log');
  });
});
