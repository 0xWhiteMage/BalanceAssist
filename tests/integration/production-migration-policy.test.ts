// @vitest-environment node

import { describe, expect, it } from 'vitest';
import * as productionMigrations from '../../scripts/apply-production-migrations.mjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { assertExpandOnlyMigration } = productionMigrations;

describe('production migration policy', () => {
  it('exposes a cleanup migration preflight policy', () => {
    expect(productionMigrations.assertReviewedCleanupMigrationsRecorded).toBeTypeOf('function');
  });

  it('allows reviewed cleanup migrations only when every version is already recorded', () => {
    const recordedVersions = ['038', '039', '040', '041', '042', '043'];

    expect(() => productionMigrations.assertReviewedCleanupMigrationsRecorded(recordedVersions)).not.toThrow();
    expect(() => productionMigrations.assertReviewedCleanupMigrationsRecorded(recordedVersions.filter((version) => version !== '040')))
      .toThrow('040 is pending; run Production cleanup migrations before this release');
    expect(() => productionMigrations.assertReviewedCleanupMigrationsRecorded(recordedVersions.filter((version) => version !== '043')))
      .toThrow('043 is pending; run Production cleanup migrations before this release');
  });

  it('requires every reviewed CRM migration before ordinary production releases', () => {
    const recordedVersions = ['038', '039', '040', '041', '042', '043', '044', '047', '048', '049', '052', '053'];

    expect(() => productionMigrations.assertReviewedCrmMigrationsRecorded(recordedVersions)).not.toThrow();
    expect(() => productionMigrations.assertReviewedCrmMigrationsRecorded(recordedVersions.filter((version) => version !== '053')))
      .toThrow('053 is pending; run Production CRM migrations before this release');
  });

  it('requires every reviewed trust migration before ordinary production releases', () => {
    const recordedVersions = ['038', '039', '040', '041', '042', '043', '044', '047', '048', '049', '052', '053', '054', '055', '056', '057'];

    expect(productionMigrations.assertReviewedTrustControlsMigrationRecorded).toBeTypeOf('function');
    expect(() => productionMigrations.assertReviewedTrustControlsMigrationRecorded(recordedVersions)).not.toThrow();
    expect(() => productionMigrations.assertReviewedTrustControlsMigrationRecorded(recordedVersions.filter((version) => version !== '054')))
      .toThrow('054 is pending; run Production trust controls migrations before this release');
    expect(productionMigrations.assertReviewedFinalReviewMigrationRecorded).toBeTypeOf('function');
    expect(() => productionMigrations.assertReviewedFinalReviewMigrationRecorded(recordedVersions)).not.toThrow();
    expect(() => productionMigrations.assertReviewedFinalReviewMigrationRecorded(recordedVersions.filter((version) => version !== '055')))
      .toThrow('055 is pending; run Production final review migration before this release');
    expect(() => productionMigrations.assertReviewedSessionControlsMigrationRecorded(recordedVersions)).not.toThrow();
    expect(() => productionMigrations.assertReviewedSessionControlsMigrationRecorded(recordedVersions.filter((version) => version !== '056')))
      .toThrow('056 is pending; run Production trust controls migration 056 before this release');
    expect(() => productionMigrations.assertReviewedTrustFeedbackMigrationRecorded(recordedVersions)).not.toThrow();
    expect(() => productionMigrations.assertReviewedTrustFeedbackMigrationRecorded(recordedVersions.filter((version) => version !== '057')))
      .toThrow('057 is pending; run Production trust feedback migration 057 before this release');
  });

  it('does not select reviewed CRM or trust-controls migrations for the ordinary runner', () => {
    expect(productionMigrations.selectOrdinaryProductionMigrations([
      { version: '043', filename: '043_deletion_state_batched_cleanup.sql', path: '/tmp/043' },
      { version: '044', filename: '044_monday_crm_projection_tables.sql', path: '/tmp/044' },
      { version: '047', filename: '047_atomic_crm_approval.sql', path: '/tmp/047' },
      { version: '053', filename: '053_monday_reconciliation.sql', path: '/tmp/053' },
      { version: '054', filename: '054_additive.sql', path: '/tmp/054' },
      { version: '055', filename: '055_final_review_approval.sql', path: '/tmp/055' },
      { version: '056', filename: '056_trust_centered_session_controls.sql', path: '/tmp/056' },
      { version: '057', filename: '057_event_deletion_freeze.sql', path: '/tmp/057' }
    ]).map(({ version }) => version)).toEqual(['043']);
  });

  it('queries the migration tracker before evaluating production migration files', async () => {
    const source = await readFile(resolve(process.cwd(), 'scripts/apply-production-migrations.mjs'), 'utf8');

    expect(source).toContain("await client.query('SELECT version FROM public.schema_migrations')");
    expect(source.indexOf("await client.query('SELECT version FROM public.schema_migrations')"))
      .toBeLessThan(source.indexOf('for (const migration of migrations)'));
  });

  it('rejects destructive schema and data operations from protected releases', () => {
    expect(() => assertExpandOnlyMigration('DROP TABLE public.sessions;', '999_cleanup.sql')).toThrow('expand-only');
    expect(() => assertExpandOnlyMigration('ALTER TABLE public.sessions DROP COLUMN draft;', '999_cleanup.sql')).toThrow('expand-only');
    expect(() => assertExpandOnlyMigration('DELETE FROM public.sessions;', '999_cleanup.sql')).toThrow('expand-only');
    expect(() => assertExpandOnlyMigration('/* DROP TABLE public.sessions; */ ALTER TABLE public.sessions ADD COLUMN safe text;', '999_cleanup.sql')).toThrow('comments');
    expect(() => assertExpandOnlyMigration('ALTER TABLE public.sessions ADD COLUMN safe text; DELETE FROM public.sessions;', '999_cleanup.sql')).toThrow('unsupported');
    expect(() => assertExpandOnlyMigration('ALTER TABLE public.sessions ADD COLUMN safe text DEFAULT (select secret from private.values);', '999_cleanup.sql')).toThrow('unsupported');
    expect(() => assertExpandOnlyMigration('CREATE FUNCTION public.erase() RETURNS void LANGUAGE sql AS $$ DELETE FROM public.sessions; $$;', '999_cleanup.sql')).toThrow('unsupported');
  });

  it('allows an additive forward migration', () => {
    expect(() => assertExpandOnlyMigration('ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS release_note text;', '999_additive.sql')).not.toThrow();
  });

  it('permits only one supported additive statement', () => {
    expect(() => assertExpandOnlyMigration('CREATE INDEX IF NOT EXISTS sessions_release_note_idx ON public.sessions (release_note);', '999_additive.sql')).not.toThrow();
    expect(() => assertExpandOnlyMigration('CREATE TABLE IF NOT EXISTS public.release_notes (id uuid PRIMARY KEY);', '999_additive.sql')).not.toThrow();
  });

  it('identifies the protected cleanup workflow as the prerequisite for reviewed destructive versions', () => {
    expect(() => assertExpandOnlyMigration('DELETE FROM public.deletion_jobs;', '038_durable_deletion_jobs.sql'))
      .toThrow('Production cleanup migrations');
    expect(() => assertExpandOnlyMigration('DROP TABLE public.deletion_jobs;', '043_deletion_state_batched_cleanup.sql'))
      .toThrow('038-043');
  });
});
