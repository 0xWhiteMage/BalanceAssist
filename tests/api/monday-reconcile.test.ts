// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(() => ({ ok: true })),
  hasSupabase: vi.fn(() => true),
  createSupabase: vi.fn(() => ({})),
  config: vi.fn(() => ({ upsertEnabled: false, cleanupEnabled: false })),
  verifySchema: vi.fn(),
  claimPage: vi.fn(),
  recordItem: vi.fn(),
  recordCursor: vi.fn(),
  finish: vi.fn(),
  scan: vi.fn(),
}));

vi.mock('@/lib/security/config', () => ({ validateAdminRequestAny: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ hasSupabaseServerConfig: mocks.hasSupabase, createServerSupabaseClient: mocks.createSupabase }));
vi.mock('@/lib/monday/config', () => ({ getMondayConfig: mocks.config }));
vi.mock('@/lib/monday/client', () => ({ verifyMondaySchema: mocks.verifySchema, scanMondayBoardPage: mocks.scan }));
vi.mock('@/lib/monday/outbox', () => ({
  claimMondayReconciliationPage: mocks.claimPage,
  recordMondayReconciledItem: mocks.recordItem,
  recordMondayReconciliationCursor: mocks.recordCursor,
  finishMondayReconciliation: mocks.finish,
}));

describe('POST /api/internal/monday-reconcile', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.auth.mockReturnValue({ ok: true });
    mocks.hasSupabase.mockReturnValue(true);
    mocks.createSupabase.mockReturnValue({});
    mocks.config.mockReturnValue({ upsertEnabled: false, cleanupEnabled: false });
    mocks.verifySchema.mockResolvedValue({});
    mocks.claimPage.mockResolvedValue({ id: 'checkpoint-1', cursor: null });
    mocks.scan.mockResolvedValue({ cursor: null, items: [] });
    mocks.recordItem.mockResolvedValue('ignored');
    mocks.recordCursor.mockResolvedValue(true);
    mocks.finish.mockResolvedValue({ repairs: 0 });
  });

  async function reconcile() {
    const { POST } = await import('@/app/api/internal/monday-reconcile/route');
    return POST(new Request('http://localhost/api/internal/monday-reconcile', { method: 'POST', headers: { authorization: 'Bearer secret' } }));
  }

  test('authenticates before reading Monday or claiming a checkpoint', async () => {
    mocks.auth.mockReturnValue({ ok: false, status: 401, error: 'Unauthorized' } as never);
    const response = await reconcile();
    expect(response.status).toBe(401);
    expect(mocks.verifySchema).not.toHaveBeenCalled();
    expect(mocks.claimPage).not.toHaveBeenCalled();
  });

  test('records one bounded page and its continuation without mutating Monday', async () => {
    mocks.scan.mockResolvedValue({ cursor: 'next-page', items: [{ id: 'item-1', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1', sourceColumnTexts: [] }] });
    mocks.recordItem.mockResolvedValue('adopted');

    const response = await reconcile();

    expect(response.status).toBe(200);
    expect(mocks.scan).toHaveBeenCalledWith(null);
    expect(mocks.recordItem).toHaveBeenCalledWith(expect.anything(), 'checkpoint-1', {
      itemId: 'item-1', crmRecordId: 'crm-1', active: true, sourceDrift: false,
    });
    expect(mocks.recordCursor).toHaveBeenCalledWith(expect.anything(), 'checkpoint-1', 'next-page');
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  test('records duplicate CRM keys as terminal conflicts and never repairs them directly', async () => {
    mocks.scan.mockResolvedValue({ cursor: null, items: [
      { id: 'item-1', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1', sourceColumnTexts: [] },
      { id: 'item-2', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1', sourceColumnTexts: [] },
    ] });
    mocks.recordItem.mockResolvedValue('conflict');

    const response = await reconcile();

    expect(response.status).toBe(200);
    expect(mocks.recordItem).toHaveBeenCalledTimes(2);
    expect(mocks.finish).toHaveBeenCalledWith(expect.anything(), 'checkpoint-1');
  });

  test('records archived items and source-field drift through RPCs', async () => {
    mocks.scan.mockResolvedValue({ cursor: null, items: [
      { id: 'item-1', boardId: '18421762586', state: 'archived', crmRecordId: 'crm-1', sourceColumnTexts: ['stale'] },
    ] });

    await reconcile();

    expect(mocks.recordItem).toHaveBeenCalledWith(expect.anything(), 'checkpoint-1', {
      itemId: 'item-1', crmRecordId: 'crm-1', active: false, sourceDrift: true,
    });
  });
});
