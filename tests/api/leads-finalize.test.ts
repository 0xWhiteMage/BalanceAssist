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

  test('delegates finalization to the atomic RPC without accepting browser qualification or draft values', async () => {
    rpc.mockResolvedValue({ data: [{ persisted: true, consent_required: false, qualification_status: 'qualified', score: 8, recommended_next_step: 'schedule', handoff_id: 'handoff-rpc' }], error: null });
    const response = await finalize({ sessionId: '11111111-2222-3333-4444-555555555555', qualificationStatus: 'misfit', score: 0, leadDraft: { projectScope: 'browser-controlled' } });

    expect(rpc).toHaveBeenCalledWith('finalize_session_lead', { p_session_id: '11111111-2222-3333-4444-555555555555' });
    await expect(response.json()).resolves.toMatchObject({ qualificationStatus: 'qualified', score: 8, handoffId: 'handoff-rpc' });
  });

  test('preserves producer-transfer denial from the transaction', async () => {
    rpc.mockResolvedValue({ data: [{ persisted: false, consent_required: true }], error: null });
    const response = await finalize({ sessionId: '11111111-2222-3333-4444-555555555555' });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'consent_required', persisted: false });
  });
});
