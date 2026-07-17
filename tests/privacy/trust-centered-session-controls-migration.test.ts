// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve(process.cwd(), 'supabase/migrations/056_trust_centered_session_controls.sql');

describe('trust-centered session controls migration', () => {
  it('creates a PII-free receipt verifier and post-cascade status lookup', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    expect(sql).toMatch(/public_receipt_id uuid NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(sql).toMatch(/receipt_secret_hash text NOT NULL DEFAULT encode\(digest\(gen_random_bytes\(32\), 'sha256'\), 'hex'\)/);
    expect(sql).toContain('CREATE UNIQUE INDEX deletion_jobs_public_receipt_id_key');
    expect(sql).toMatch(/CREATE FUNCTION public\.get_session_deletion_status\(p_receipt_id uuid, p_receipt_hash text\)[\s\S]*WHERE j\.public_receipt_id = p_receipt_id[\s\S]*j\.receipt_secret_hash = p_receipt_hash/);
    expect(sql.match(/RETURNS TABLE \(\s*receipt_id uuid,\s*status text,\s*requested_at timestamptz,\s*updated_at timestamptz,\s*completed_at timestamptz,\s*failed_at timestamptz/gs)).toHaveLength(2);
  });

  it('backfills analysis consent without overriding an existing withdrawal', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toMatch(/INSERT INTO public\.session_consents[\s\S]*s\.deletion_state = 'active'[\s\S]*s\.consented_at IS NOT NULL[\s\S]*s\.consent_version = '1.1'/);
    expect(sql).toMatch(/NOT EXISTS \([\s\S]*c\.session_id = s\.id AND c\.scope = 'analysis'/);
  });

  it('freezes and revokes before suppressing or queueing deletion work', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const request = sql.slice(sql.indexOf('CREATE FUNCTION public.request_session_deletion'), sql.indexOf('CREATE FUNCTION public.get_session_deletion_status'));

    const lock = request.indexOf('FOR UPDATE;');
    const freeze = request.indexOf("SET deletion_state = CASE WHEN deletion_state = 'active' THEN 'requested' ELSE deletion_state END");
    const revocations = request.indexOf('INSERT INTO public.session_consents');
    const suppression = request.indexOf("state IN ('pending', 'claiming')");
    const crmCleanup = request.indexOf('queue_crm_lead_deletion');
    const deletionJob = request.indexOf('INSERT INTO public.deletion_jobs');
    expect([lock, freeze, revocations, suppression, crmCleanup, deletionJob].every((position) => position >= 0)).toBe(true);
    expect(lock).toBeLessThan(freeze);
    expect(freeze).toBeLessThan(revocations);
    expect(revocations).toBeLessThan(suppression);
    expect(suppression).toBeLessThan(crmCleanup);
    expect(crmCleanup).toBeLessThan(deletionJob);
    expect(request).toContain("c.scope IN ('analysis', 'human_contact', 'producer_transfer')");
    expect(request).toContain('WHERE latest.granted;');
    expect(request).not.toContain("state IN ('pending', 'claiming', 'sending')");
    expect(request).toContain("CASE WHEN deletion_state = 'active' THEN 'requested' ELSE deletion_state END");
    expect(request.indexOf('FROM public.deletion_jobs WHERE session_id = p_session_id FOR UPDATE')).toBeLessThan(request.indexOf('FROM public.sessions WHERE id = p_session_id FOR UPDATE'));
  });

  it('guards every protected mutation and preserves the 054/055 contracts', async () => {
    const sql = await readFile(migrationPath, 'utf8');

    for (const signature of [
      'record_session_consent(p_session_id uuid, p_scope text, p_granted boolean, p_notice_version text)',
      'update_session_draft(p_session_id uuid, p_expected_draft_version integer, p_fields jsonb)',
      'clear_session_draft(p_session_id uuid)',
      'assert_session_processing_allowed(p_session_id uuid)',
      'finalize_session_lead(p_session_id uuid)',
      'relay_human_message(p_session_id uuid, p_request_id text, p_text text)',
      'claim_next_handoff()',
      'reserve_handoff_send(p_handoff_id uuid, p_claim_token uuid)'
    ]) expect(sql).toContain(`FUNCTION public.${signature}`);

    expect(sql).toContain('RETURNS TABLE (analysis boolean, human_contact boolean, producer_transfer boolean)');
    expect(sql).toContain('RETURNS TABLE (draft jsonb, draft_version integer, conflict boolean)');
    expect(sql).toMatch(/crm_queued boolean,\s+approval_input_hash text,\s+approved_reference_set_hash text/);
    expect(sql).toContain('RETURNS TABLE (persisted boolean, consent_required boolean, message_id bigint, handoff_id uuid, thread_id bigint)');
    expect(sql).toContain('RETURNS TABLE (id uuid, session_id uuid, payload jsonb, created_at timestamptz, claim_token uuid, resolution text)');
    expect(sql).toContain("IF p_granted AND v_deletion_state <> 'active'");
    expect(sql.match(/SESSION_DELETION_REQUESTED/g)?.length).toBeGreaterThanOrEqual(6);
    expect(sql).toContain("RAISE EXCEPTION 'ANALYSIS_CONSENT_REQUIRED'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.record_session_consent_054');
    expect(sql).toMatch(/CREATE TRIGGER reference_links_require_active_session[\s\S]*BEFORE INSERT OR UPDATE ON public\.reference_links/);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.record_session_consent_054(uuid, text, boolean, text), public.update_session_draft_036(uuid, integer, jsonb), public.finalize_session_lead_055(uuid), public.relay_human_message_054(uuid, text, text) FROM service_role;');
  });

  it('places the finalization deletion guard before delegation to the write implementation', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    const finalizer = sql.slice(sql.indexOf('CREATE FUNCTION public.finalize_session_lead'), sql.indexOf('ALTER FUNCTION public.relay_human_message'));

    expect(finalizer.indexOf('FOR UPDATE;')).toBeLessThan(finalizer.indexOf('SESSION_DELETION_REQUESTED'));
    expect(finalizer.indexOf('SESSION_DELETION_REQUESTED')).toBeLessThan(finalizer.indexOf('finalize_session_lead_055(p_session_id)'));
    expect(finalizer).not.toMatch(/INSERT INTO public\.(leads|handoff_outbox|crm_leads|monday_sync_outbox)/);
  });
});
