// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { assertExpandOnlyMigration } from '../../scripts/apply-production-migrations.mjs';

describe('production migration policy', () => {
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
    expect(() => assertExpandOnlyMigration('DROP TABLE public.deletion_jobs;', '042_deletion_recovery_ownership.sql'))
      .toThrow('038-042');
  });
});
