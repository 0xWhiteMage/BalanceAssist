// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { assertExpandOnlyMigration } from '../../scripts/apply-production-migrations.mjs';

describe('production migration policy', () => {
  it('rejects destructive schema and data operations from protected releases', () => {
    expect(() => assertExpandOnlyMigration('DROP TABLE public.sessions;', '999_cleanup.sql')).toThrow('expand-only');
    expect(() => assertExpandOnlyMigration('ALTER TABLE public.sessions DROP COLUMN draft;', '999_cleanup.sql')).toThrow('expand-only');
    expect(() => assertExpandOnlyMigration('DELETE FROM public.sessions;', '999_cleanup.sql')).toThrow('expand-only');
  });

  it('allows an additive forward migration', () => {
    expect(() => assertExpandOnlyMigration('ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS release_note text;', '999_additive.sql')).not.toThrow();
  });
});
