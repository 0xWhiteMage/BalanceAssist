// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const storageMutationPatterns = [
  /\bALTER\s+TABLE\s+storage\.(?:objects|buckets)\b/i,
  /\bDROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+storage\.(?:objects|buckets)\b/i,
  /\bTRUNCATE(?:\s+TABLE)?\s+(?:ONLY\s+)?storage\.(?:objects|buckets)\b/i,
  /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?storage\.(?:objects|buckets)\b/i,
  /\b(?:GRANT|REVOKE)\b[\s\S]*?\bON\s+(?:TABLE\s+)?storage\.(?:objects|buckets)\b/i,
  /\b(?:CREATE|DROP)\s+POLICY\b[\s\S]*?\bON\s+storage\.objects\b/i,
];

describe('private attachment storage migration', () => {
  test('adds private lifecycle fields, constraints, indexes, and RLS', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/029_private_attachment_storage.sql'), 'utf8');

    expect(migration).toMatch(/object_key text/i);
    expect(migration).toMatch(/checksum_sha256 text/i);
    expect(migration).toMatch(/retention_expires_at timestamptz/i);
    expect(migration).toMatch(/status.*stored.*pending_delivery.*sent.*suppressed.*failed.*expired/is);
    expect(migration).toMatch(/idempotency_key uuid/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/uploaded_files_idempotency_key_idx/i);
    expect(migration).toMatch(/uploaded_files_object_key_idx/i);
  });

  test('creates opaque cleanup metadata, fails closed, and retains the purge function', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/030_private_attachment_retention.sql'), 'utf8');

    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.private_attachment_cleanup/i);
    expect(migration).toMatch(/object_key text PRIMARY KEY/i);
    expect(migration).toMatch(/bucket text NOT NULL/i);
    expect(migration).toMatch(/checksum_sha256 text NOT NULL/i);
    expect(migration).toMatch(/retention_expires_at timestamptz NOT NULL/i);
    expect(migration).toMatch(/status text NOT NULL/i);
    const cleanupTable = migration.match(/CREATE TABLE IF NOT EXISTS public\.private_attachment_cleanup \([\s\S]*?\n\);/i)?.[0] ?? '';
    expect(cleanupTable).not.toMatch(/filename|session_id/i);
    expect(migration).toMatch(/private_attachment_storage_readiness/i);
    expect(migration).toMatch(/'temporary-attachments', 'unavailable'/i);
    expect(migration).toMatch(/purge_expired_temporary_sessions/i);
  });

  test('hardens legacy key cleanup and records unavailable readiness', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/031_private_attachment_cleanup_hardening.sql'), 'utf8');

    expect(migration).toMatch(/cleanup_required_at timestamptz/i);
    expect(migration).toMatch(/object_key ~ '\^\[0-9a-f\]\{8\}/i);
    expect(migration).toMatch(/INSERT INTO public\.uploaded_files/i);
    expect(migration).toMatch(/DELETE FROM public\.private_attachment_cleanup/i);
    expect(migration).toMatch(/'temporary-attachments', 'unavailable'/i);
  });

  test('keeps legacy orphan cleanup obligations for the service-role worker', () => {
    const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/032_legacy_cleanup_record_remediation.sql'), 'utf8');

    expect(migration).not.toMatch(/DELETE\s+FROM\s+public\.private_attachment_cleanup/i);
    expect(migration).toMatch(/service-role cleanup worker[\s\S]*?delete.*object,[\s\S]*?then.*cleanup/i);
  });

  test('uses read-only catalog checks for private bucket, Storage RLS, and browser policies', () => {
    const liveAttestation = readFileSync(resolve(process.cwd(), 'supabase/migrations/033_private_attachment_live_attestation.sql'), 'utf8');
    const effectiveAttestation = readFileSync(resolve(process.cwd(), 'supabase/migrations/034_private_attachment_effective_attestation.sql'), 'utf8');

    for (const migration of [liveAttestation, effectiveAttestation]) {
      expect(migration).toMatch(/SECURITY DEFINER SET search_path = public, pg_catalog/i);
      expect(migration).toMatch(/storage\.buckets.*public = false/is);
      expect(migration).toMatch(/pg_class.*relrowsecurity/is);
      expect(migration).toMatch(/pg_policies/i);
      expect(migration).toMatch(/'public'::name/i);
      expect(migration).toMatch(/REVOKE ALL ON FUNCTION/i);
      expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION.*service_role/i);
      expect(migration).not.toMatch(/information_schema\.role_table_grants|has_table_privilege/i);
    }

    expect(effectiveAttestation).toMatch(/WITH RECURSIVE/i);
    expect(effectiveAttestation).toMatch(/pg_auth_members/i);
    expect(effectiveAttestation).toMatch(/role_names/i);
    expect(effectiveAttestation).toMatch(/role_name = ANY\(p\.roles\)/i);
    expect(liveAttestation).toMatch(/'anon'::name/i);
    expect(liveAttestation).toMatch(/'authenticated'::name/i);
  });

  test('never mutates Supabase Storage relations', () => {
    const migrations = ['029', '030', '031', '032', '033', '034'].map((version) =>
      readFileSync(resolve(process.cwd(), `supabase/migrations/${version}_${[
        'private_attachment_storage',
        'private_attachment_retention',
        'private_attachment_cleanup_hardening',
        'legacy_cleanup_record_remediation',
        'private_attachment_live_attestation',
        'private_attachment_effective_attestation',
      ][Number(version) - 29]}.sql`), 'utf8'),
    );

    for (const migration of migrations) {
      for (const pattern of storageMutationPatterns) expect(migration).not.toMatch(pattern);
    }
  });

  test('keeps bundled private Storage migrations identical and owner-safe', () => {
    const bundle = readFileSync(resolve(process.cwd(), 'supabase/production-migrations-019-043.sql'), 'utf8');

    for (const filename of [
      '029_private_attachment_storage.sql',
      '030_private_attachment_retention.sql',
      '031_private_attachment_cleanup_hardening.sql',
      '032_legacy_cleanup_record_remediation.sql',
      '033_private_attachment_live_attestation.sql',
      '034_private_attachment_effective_attestation.sql',
    ]) {
      const source = readFileSync(resolve(process.cwd(), `supabase/migrations/${filename}`), 'utf8').trim();
      const section = bundle.match(new RegExp(`-- BEGIN ${filename}\\r?\\n(?:-- =+\\r?\\n)?([\\s\\S]*?)\\r?\\n-- END ${filename}`))?.[1];

      expect(section?.trimEnd()).toBe(source);
      for (const pattern of storageMutationPatterns) expect(section).not.toMatch(pattern);
    }
  });
});
