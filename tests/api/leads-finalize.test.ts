// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn() }));
vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));

async function finalize(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/leads/finalize/route');
  return POST(new Request('http://localhost/api/leads/finalize', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }));
}

describe('POST /api/leads/finalize', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    requireSessionMock.mockResolvedValue({ ok: true, auth: { sessionId: '11111111-2222-3333-4444-555555555555' }, supabase: { rpc } });
  });

  test('returns server-owned CRM approval fields from the atomic RPC', async () => {
    rpc.mockResolvedValue({ data: [{ persisted: true, consent_required: false, qualification_status: 'qualified', score: 8, recommended_next_step: 'schedule', handoff_id: 'handoff-rpc', crm_record_id: 'crm-rpc', crm_revision: 1, approved_draft_version: 4, crm_queued: true }], error: null });
    const response = await finalize({ sessionId: '11111111-2222-3333-4444-555555555555' });

    expect(rpc).toHaveBeenCalledWith('finalize_session_lead', { p_session_id: '11111111-2222-3333-4444-555555555555' });
    await expect(response.json()).resolves.toMatchObject({ qualificationStatus: 'qualified', score: 8, handoffId: 'handoff-rpc', crmRecordId: 'crm-rpc', crmRevision: 1, approvedDraftVersion: 4, crmQueued: true });
  });

  test('preserves producer-transfer denial from the transaction', async () => {
    rpc.mockResolvedValue({ data: [{ persisted: false, consent_required: true }], error: null });
    const response = await finalize({ sessionId: '11111111-2222-3333-4444-555555555555' });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'consent_required', persisted: false });
  });

  test('rejects browser-supplied approval fields before calling the RPC', async () => {
    const response = await finalize({ sessionId: '11111111-2222-3333-4444-555555555555', crmQueued: true });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('returns a stable failure when the atomic RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'database detail must not reach the browser' } });
    const response = await finalize({ sessionId: '11111111-2222-3333-4444-555555555555' });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: 'lead_finalize_failed', persisted: false }));
  });

  test('returns false when a duplicate approval did not enqueue a new CRM obligation', async () => {
    rpc.mockResolvedValue({ data: [{ persisted: true, consent_required: false, crm_queued: false }], error: null });
    const response = await finalize({ sessionId: '11111111-2222-3333-4444-555555555555' });

    await expect(response.json()).resolves.toMatchObject({ crmQueued: false });
  });
});
