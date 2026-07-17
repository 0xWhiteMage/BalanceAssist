// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { createServerSupabaseClientMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn()
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: createServerSupabaseClientMock
}));

import { POST } from '@/app/api/deletions/status/route';

describe('deletion receipt status', () => {
  beforeEach(() => createServerSupabaseClientMock.mockReset());

  test('returns PII-free status using the hashed receipt secret', async () => {
    const rpc = vi.fn(async () => ({ data: [{
      receipt_id: '11111111-1111-4111-8111-111111111111',
      status: 'completed',
      requested_at: '2026-07-17T00:00:00.000Z',
      updated_at: '2026-07-17T01:00:00.000Z',
      completed_at: '2026-07-17T01:00:00.000Z',
      failed_at: null
    }], error: null }));
    createServerSupabaseClientMock.mockReturnValue({ rpc });

    const response = await POST(new Request('http://localhost/api/deletions/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receipt: '11111111-1111-4111-8111-111111111111.receipt-secret' })
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(body).toEqual(expect.objectContaining({ ok: true, status: 'completed' }));
    expect(body).not.toHaveProperty('sessionId');
    expect(body).not.toHaveProperty('receipt');
    expect(rpc).toHaveBeenCalledWith('get_session_deletion_status', {
      p_receipt_id: '11111111-1111-4111-8111-111111111111',
      p_receipt_hash: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
  });

  test('does not distinguish an invalid secret from an unknown receipt', async () => {
    createServerSupabaseClientMock.mockReturnValue({ rpc: vi.fn(async () => ({ data: [], error: null })) });
    const response = await POST(new Request('http://localhost/api/deletions/status', {
      method: 'POST', body: JSON.stringify({ receipt: '11111111-1111-4111-8111-111111111111.wrong' })
    }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'DELETION_RECEIPT_NOT_FOUND' });
  });

  test('keeps transient database failures retryable instead of invalidating the receipt', async () => {
    createServerSupabaseClientMock.mockReturnValue({ rpc: vi.fn(async () => ({ data: null, error: { message: 'temporary failure' } })) });
    const response = await POST(new Request('http://localhost/api/deletions/status', {
      method: 'POST', body: JSON.stringify({ receipt: '11111111-1111-4111-8111-111111111111.still-valid' })
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'DELETION_STATUS_UNAVAILABLE' });
  });
});
