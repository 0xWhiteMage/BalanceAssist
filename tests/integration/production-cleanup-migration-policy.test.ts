// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { applyProductionCleanupMigrations, cleanupMigrationVersions, selectCleanupMigrations } from '../../scripts/apply-production-cleanup-migrations.mjs';

const root = process.cwd();
const cleanupMigrations = [
  ['038', '038_durable_deletion_jobs.sql'],
  ['039', '039_deletion_scheduler_health.sql'],
  ['040', '040_deletion_recovery_lifecycle.sql'],
  ['041', '041_deletion_backlog_count.sql'],
  ['042', '042_deletion_recovery_ownership.sql'],
  ['043', '043_deletion_state_batched_cleanup.sql']
] as const;

type Workflow = {
  jobs?: Record<string, {
    environment?: string;
    env?: Record<string, string>;
    steps?: Array<{ name?: string; env?: Record<string, string>; run?: string }>;
  }>;
};

describe('production cleanup migration policy', () => {
  it('permits exactly the reviewed one-time cleanup migration versions', () => {
    expect(cleanupMigrationVersions).toEqual(['038', '039', '040', '041', '042', '043']);
    expect(selectCleanupMigrations([
      { version: '037', filename: '037_scheduler_health.sql', path: '/tmp/037' },
      { version: '038', filename: '038_durable_deletion_jobs.sql', path: '/tmp/038' },
      { version: '039', filename: '039_deletion_scheduler_health.sql', path: '/tmp/039' },
      { version: '040', filename: '040_deletion_recovery_lifecycle.sql', path: '/tmp/040' },
      { version: '041', filename: '041_deletion_backlog_count.sql', path: '/tmp/041' },
      { version: '042', filename: '042_deletion_recovery_ownership.sql', path: '/tmp/042' },
      { version: '043', filename: '043_deletion_state_batched_cleanup.sql', path: '/tmp/043' }
    ]).map(({ version }) => version)).toEqual(cleanupMigrationVersions);
  });

  it('hash-verifies the complete reviewed migration chain during dry-run', async () => {
    await expect(applyProductionCleanupMigrations({ dryRun: true })).resolves.toEqual({
      planned: [
        '038_durable_deletion_jobs.sql',
        '039_deletion_scheduler_health.sql',
        '040_deletion_recovery_lifecycle.sql',
        '041_deletion_backlog_count.sql',
        '042_deletion_recovery_ownership.sql',
        '043_deletion_state_batched_cleanup.sql'
      ],
      schemaVersion: '043'
    });
  });

  it('hash-verifies LF-normalized source and produces an exact cleanup SQL Editor artifact', async () => {
    const artifact = (await readFile(resolve(root, 'supabase/production-cleanup-038-043.sql'), 'utf8')).replace(/\r\n/g, '\n');

    for (const [version, filename] of cleanupMigrations) {
      const source = await readFile(resolve(root, 'supabase/migrations', filename), 'utf8');
      expect(artifact).toContain(`-- BEGIN ${version} ${filename}`);
      expect(artifact).toContain(source.replace(/\r\n/g, '\n'));
    }
    expect(artifact).toContain('BEGIN;');
    expect(artifact).toContain('SELECT pg_advisory_xact_lock(90442043);');
    expect(artifact).toContain("version = '037' AND filename = '037_scheduler_health.sql'");
    expect(artifact).toContain("to_regclass('public.sessions')");
    expect(artifact).toContain("to_regclass('public.private_attachment_cleanup')");
    expect(artifact).toContain("to_regclass('public.scheduler_heartbeats')");
    expect(artifact).toContain("version IN ('038', '039', '040', '041', '042', '043')");
    expect(artifact).toContain('INSERT INTO public.schema_migrations');
    expect(artifact).toContain("RAISE EXCEPTION 'cleanup migration verification failed'");
    expect(artifact.trimEnd()).toMatch(/COMMIT;$/);
    expect(artifact).not.toContain('044_monday_crm_projection_tables.sql');
  });

  it('rejects a SQL Editor artifact with appended SQL during dry-run verification', async () => {
    const artifact = await readFile(resolve(root, 'supabase/production-cleanup-038-043.sql'), 'utf8');
    const artifactDir = await mkdtemp(resolve(tmpdir(), 'balance-assist-cleanup-artifact-'));
    const artifactPath = resolve(artifactDir, 'production-cleanup-038-043.sql');

    try {
      await writeFile(artifactPath, `${artifact}\nSELECT 'unreviewed artifact SQL';\n`);
      await expect(applyProductionCleanupMigrations({ dryRun: true, artifactPath })).rejects.toThrow('does not match its reviewed artifact');
    } finally {
      await rm(artifactDir, { force: true, recursive: true });
    }
  });

  it('uses the managed Supabase CLI after backup attestation and dry-run validation', async () => {
    const source = await readFile(resolve(root, '.github/workflows/production-cleanup-migrations.yml'), 'utf8');
    const workflow = parse(source) as Workflow;
    const cleanup = workflow.jobs?.cleanup;
    const migrationStep = cleanup?.steps?.find((step) => step.run?.includes('node scripts/apply-production-cleanup-migrations.mjs --dry-run'));
    const runCommands = migrationStep?.run?.split(/\r?\n/).map((command) => command.trim()).filter(Boolean) ?? [];
    const dryRunIndex = runCommands.indexOf('node scripts/apply-production-cleanup-migrations.mjs --dry-run');
    const linkCommand = 'npx --no-install supabase link --project-ref vbdqjgwcmckutwehrbvo --yes';
    const artifactQueryCommand = 'npx --no-install supabase db query --linked --file supabase/production-cleanup-038-043.sql';
    const secretReferences = JSON.stringify(cleanup).match(/\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}/g) ?? [];

    expect(cleanup?.environment).toBe('production-cleanup-migrations');
    expect(cleanup?.env).toBeUndefined();
    expect(migrationStep?.env).toEqual({
      SUPABASE_ACCESS_TOKEN: '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
      PRODUCTION_BACKUP_AUDIT_REFERENCE: '${{ secrets.PRODUCTION_BACKUP_AUDIT_REFERENCE }}',
      RELEASE_SHA: '${{ needs.validate.outputs.sha }}'
    });
    expect(secretReferences).toEqual([
      '${{ secrets.SUPABASE_ACCESS_TOKEN }}',
      '${{ secrets.PRODUCTION_BACKUP_AUDIT_REFERENCE }}'
    ]);
    expect(migrationStep?.run).toContain('test "$backup_release_sha" = "$RELEASE_SHA"');
    expect(migrationStep?.run).toContain('24 * 60 * 60');
    expect(dryRunIndex).toBeGreaterThanOrEqual(0);
    expect(runCommands.indexOf(linkCommand)).toBeGreaterThan(dryRunIndex);
    expect(runCommands.indexOf(artifactQueryCommand)).toBeGreaterThan(runCommands.indexOf(linkCommand));
    expect(source).not.toContain('PRODUCTION_DATABASE_URL');
    expect(source).not.toMatch(/node scripts\/apply-production-cleanup-migrations\.mjs(?!\s+--dry-run)/);
  });

  it('rejects missing, renamed, and unreviewed cleanup migrations', () => {
    expect(() => selectCleanupMigrations([
      { version: '038', filename: '038_durable_deletion_jobs.sql', path: '/tmp/038' }
    ])).toThrow('missing reviewed cleanup migration 039');
    expect(() => selectCleanupMigrations([
      { version: '038', filename: '038_other.sql', path: '/tmp/038' },
      { version: '039', filename: '039_deletion_scheduler_health.sql', path: '/tmp/039' },
      { version: '040', filename: '040_deletion_recovery_lifecycle.sql', path: '/tmp/040' },
      { version: '041', filename: '041_deletion_backlog_count.sql', path: '/tmp/041' },
      { version: '042', filename: '042_deletion_recovery_ownership.sql', path: '/tmp/042' },
      { version: '043', filename: '043_deletion_state_batched_cleanup.sql', path: '/tmp/043' }
    ])).toThrow('is not the reviewed file');
    expect(() => selectCleanupMigrations([
      { version: '038', filename: '038_durable_deletion_jobs.sql', path: '/tmp/038' },
      { version: '039', filename: '039_deletion_scheduler_health.sql', path: '/tmp/039' },
      { version: '040', filename: '040_deletion_recovery_lifecycle.sql', path: '/tmp/040' },
      { version: '041', filename: '041_deletion_backlog_count.sql', path: '/tmp/041' },
      { version: '042', filename: '042_deletion_recovery_ownership.sql', path: '/tmp/042' },
      { version: '043', filename: '043_other.sql', path: '/tmp/043' }
    ])).toThrow('is not the reviewed file');
    expect(selectCleanupMigrations([
      { version: '038', filename: '038_durable_deletion_jobs.sql', path: '/tmp/038' },
      { version: '039', filename: '039_deletion_scheduler_health.sql', path: '/tmp/039' },
      { version: '040', filename: '040_deletion_recovery_lifecycle.sql', path: '/tmp/040' },
      { version: '041', filename: '041_deletion_backlog_count.sql', path: '/tmp/041' },
      { version: '042', filename: '042_deletion_recovery_ownership.sql', path: '/tmp/042' },
      { version: '043', filename: '043_deletion_state_batched_cleanup.sql', path: '/tmp/043' },
      { version: '044', filename: '044_arbitrary.sql', path: '/tmp/044' }
    ]).map(({ version }) => version)).toEqual(cleanupMigrationVersions);
  });
});
