import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationsDir = resolve(__dirname, '../../supabase/migrations');

function readMigration(filename: string): string {
  return readFileSync(resolve(migrationsDir, filename), 'utf-8');
}

describe('014_trust_security_foundation', () => {
  const sql = readMigration('014_trust_security_foundation.sql');

  it('adds capability_hash and capability_expires_at to sessions', () => {
    expect(sql).toContain('capability_hash');
    expect(sql).toContain('capability_expires_at');
    expect(sql).toContain('sessions');
  });

  it('adds consent tracking columns', () => {
    expect(sql).toContain('consent_version');
    expect(sql).toContain('consented_at');
  });

  it('adds draft and draft_version columns', () => {
    expect(sql).toContain('draft jsonb');
    expect(sql).toContain('draft_version integer');
  });

  it('creates processed_telegram_updates table', () => {
    expect(sql).toContain('processed_telegram_updates');
    expect(sql).toContain('update_id bigint');
    expect(sql).toContain('received_at');
  });

  it('adds idempotency_key to leads', () => {
    expect(sql).toContain('idempotency_key');
    expect(sql).toContain('leads');
  });
});

describe('015_trust_delivery_outbox', () => {
  const sql = readMigration('015_trust_delivery_outbox.sql');

  it('creates handoff_outbox table', () => {
    expect(sql).toContain('handoff_outbox');
  });

  it('includes required columns', () => {
    expect(sql).toContain('session_id uuid');
    expect(sql).toContain('payload jsonb');
    expect(sql).toContain('state text');
    expect(sql).toContain('idempotency_key text');
    expect(sql).toContain('attempts integer');
    expect(sql).toContain('last_error text');
    expect(sql).toContain('next_attempt_at timestamptz');
  });

  it('constrains state to valid values', () => {
    expect(sql).toContain("'pending'");
    expect(sql).toContain("'sent'");
    expect(sql).toContain("'failed'");
    expect(sql).toContain("'escalated'");
  });

  it('creates indexes for query performance', () => {
    expect(sql).toContain('handoff_outbox_session_id_idx');
    expect(sql).toContain('handoff_outbox_state_idx');
  });
});

describe('016_uploaded_files_metadata_alignment', () => {
  const sql = readMigration('016_uploaded_files_metadata_alignment.sql');

  it('adds normalized uploaded file metadata columns', () => {
    expect(sql).toContain('original_name');
    expect(sql).toContain('mime_type');
    expect(sql).toContain('status');
    expect(sql).toContain('storage_path');
  });
});

describe('017_handoff_claim_leases', () => {
  const sql = readMigration('017_handoff_claim_leases.sql');

  it('adds claim_expires_at to handoff_outbox', () => {
    expect(sql).toContain('claim_expires_at');
    expect(sql).toContain('handoff_outbox');
  });
});
