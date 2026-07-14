// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { applyProductionCleanupMigrations, cleanupMigrationVersions, selectCleanupMigrations } from '../../scripts/apply-production-cleanup-migrations.mjs';

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
    expect(() => selectCleanupMigrations([
      { version: '038', filename: '038_durable_deletion_jobs.sql', path: '/tmp/038' },
      { version: '039', filename: '039_deletion_scheduler_health.sql', path: '/tmp/039' },
      { version: '040', filename: '040_deletion_recovery_lifecycle.sql', path: '/tmp/040' },
      { version: '041', filename: '041_deletion_backlog_count.sql', path: '/tmp/041' },
      { version: '042', filename: '042_deletion_recovery_ownership.sql', path: '/tmp/042' },
      { version: '043', filename: '043_deletion_state_batched_cleanup.sql', path: '/tmp/043' },
      { version: '044', filename: '044_arbitrary.sql', path: '/tmp/044' }
    ])).toThrow('unreviewed migration 044');
  });
});
