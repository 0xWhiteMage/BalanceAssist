// @vitest-environment node
import { describe, expect, test, vi } from 'vitest';

const { createServerSupabaseClientMock, hasSupabaseServerConfigMock } = vi.hoisted(() => ({
  createServerSupabaseClientMock: vi.fn(),
  hasSupabaseServerConfigMock: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: createServerSupabaseClientMock, hasSupabaseServerConfig: hasSupabaseServerConfigMock }));
vi.mock('@/lib/security/config', () => ({ validateAdminRequestAny: () => ({ ok: true }) }));

import { POST } from '@/app/api/internal/monday-lifecycle/route';

describe('Monday lifecycle worker', () => {
  test('drains bounded lifecycle pages until no due records remain', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: 100, error: null })
      .mockResolvedValueOnce({ data: 3, error: null });
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue({ rpc });

    const response = await POST(new Request('http://localhost/api/internal/monday-lifecycle', { method: 'POST' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, processed: 103 });
    expect(rpc).toHaveBeenCalledWith('queue_expired_crm_leads', { p_limit: 100 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  test('does not report success when lifecycle queuing fails', async () => {
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'unavailable' } }) });

    const response = await POST(new Request('http://localhost/api/internal/monday-lifecycle', { method: 'POST' }));

    expect(response.status).toBe(503);
  });
});
