import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/044_monday_crm_projection_tables.sql');

describe('Monday CRM projection migration', () => {
  test('defines the protected CRM aggregate, revision ledger, and durable outbox', () => {
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toMatch(/CREATE TABLE public\.crm_leads/i);
    expect(migration).toMatch(/CREATE TABLE public\.crm_lead_revisions/i);
    expect(migration).toMatch(/CREATE TABLE public\.monday_sync_outbox/i);
    expect(migration).toMatch(/desired_revision.*CHECK \(desired_revision >= 0\)/is);
    expect(migration).toMatch(/applied_revision.*CHECK \(applied_revision >= 0\)/is);
    expect(migration).toMatch(/CHECK \(applied_revision <= desired_revision\)/i);
    expect(migration).toMatch(/lifecycle_state.*active.*review_overdue.*deletion_requested.*deleted.*expired/is);
    expect(migration).toMatch(/review_due_at timestamptz NOT NULL/i);
    expect(migration).toMatch(/approval_input_hash.*\^\[0-9a-f\]\{64\}\$/is);
    expect(migration).toMatch(/payload_hash.*\^\[0-9a-f\]\{64\}\$/is);
    expect(migration).toMatch(/PRIMARY KEY \(crm_lead_id, revision\)/i);
    expect(migration).toMatch(/UNIQUE \(crm_lead_id, approval_input_hash\)/i);
    expect(migration).toMatch(/CREATE TABLE public\.monday_sync_outbox.*revision integer NOT NULL CHECK \(revision > 0\)/is);
    expect(migration).toMatch(/FOREIGN KEY \(crm_lead_id, revision\) REFERENCES public\.crm_lead_revisions \(crm_lead_id, revision\)/i);
    expect(migration).toMatch(/operation.*upsert.*delete/is);
    expect(migration).toMatch(/state.*pending.*claiming.*sending.*synced.*delivery_unknown.*conflict.*failed.*suppressed/is);
    expect(migration).toMatch(/provider_operation.*create.*update.*scrub.*delete/is);
    expect(migration).toMatch(/request_key uuid NOT NULL DEFAULT gen_random_uuid\(\)/i);
    expect(migration).toMatch(/attempts.*CHECK \(attempts >= 0\)/is);
  });

  test('keeps PII only in the approved revision payload and protects browser roles', () => {
    const migration = readFileSync(migrationPath, 'utf8');
    const aggregate = migration.match(/CREATE TABLE public\.crm_leads \((.*?)\);/is)?.[1] ?? '';
    const outbox = migration.match(/CREATE TABLE public\.monday_sync_outbox \((.*?)\);/is)?.[1] ?? '';

    expect(aggregate).not.toMatch(/contact|email|company|scope|payload/i);
    expect(outbox).not.toMatch(/contact|email|company|scope|payload jsonb/i);
    expect(migration).toMatch(/ALTER TABLE public\.crm_leads ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/ALTER TABLE public\.crm_lead_revisions ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/ALTER TABLE public\.monday_sync_outbox ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.crm_leads, public\.crm_lead_revisions, public\.monday_sync_outbox FROM PUBLIC/i);
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.crm_leads, public\.crm_lead_revisions, public\.monday_sync_outbox FROM anon/i);
    expect(migration).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.crm_leads, public\.crm_lead_revisions, public\.monday_sync_outbox FROM authenticated/i);
  });

  test('indexes due work and prevents concurrent or unknown provider delivery hazards', () => {
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toMatch(/CREATE INDEX.*monday_sync_outbox_due.*next_attempt_at/is);
    expect(migration).toMatch(/CREATE INDEX.*monday_sync_outbox_lease_expiry.*claim_expires_at/is);
    expect(migration).toMatch(/CREATE INDEX.*crm_leads_lifecycle_retention.*lifecycle_state.*retention_expires_at/is);
    expect(migration).toMatch(/CREATE INDEX.*crm_leads_monday_item_receipt.*monday_item_id/is);
    expect(migration).toMatch(/CREATE INDEX.*monday_sync_outbox_item_receipt.*target_item_id/is);
    expect(migration).toMatch(/CREATE UNIQUE INDEX.*monday_sync_outbox_active_execution.*crm_lead_id.*claiming.*sending/is);
    expect(migration).toMatch(/provider intent.*request key/i);
    expect(migration).toMatch(/delivery_unknown/i);
    expect(migration).toMatch(/CREATE TRIGGER.*monday_sync_outbox_provider_intent/i);
    expect(migration).toMatch(/NEW\.request_key IS DISTINCT FROM OLD\.request_key.*NOT intent_changed/is);
    expect(migration).toMatch(/request key cannot change without changing provider intent/i);
    expect(migration).toMatch(/CREATE FUNCTION public\.enforce_monday_sync_outbox_frozen_payload/i);
    expect(migration).toMatch(/WHERE crm_lead_id = NEW\.crm_lead_id AND revision = NEW\.revision/i);
    expect(migration).toMatch(/frozen payload hash must match the approved revision/i);
  });

  test('makes the approved revision ledger immutable after insertion', () => {
    const migration = readFileSync(migrationPath, 'utf8');

    expect(migration).toMatch(/CREATE FUNCTION public\.reject_crm_lead_revision_update/i);
    expect(migration).toMatch(/approved revision ledger is immutable/i);
    expect(migration).toMatch(/CREATE TRIGGER crm_lead_revision_immutable/i);
  });
});
