// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(() => ({ ok: true })),
  hasSupabase: vi.fn(() => true),
  createSupabase: vi.fn(() => ({})),
  config: vi.fn(() => ({ upsertEnabled: true, cleanupEnabled: true })),
  verifySchema: vi.fn(),
  verifyCleanupSchema: vi.fn(),
  claim: vi.fn(),
  reserve: vi.fn(),
  completeUpsert: vi.fn(),
  completeScrub: vi.fn(),
  completeDelete: vi.fn(),
  retry: vi.fn(),
  unknown: vi.fn(),
  conflict: vi.fn(),
  find: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  scrub: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  createPayload: vi.fn(),
  updatePayload: vi.fn(),
  event: vi.fn(),
}));

vi.mock('@/lib/security/config', () => ({ validateAdminRequestAny: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ hasSupabaseServerConfig: mocks.hasSupabase, createServerSupabaseClient: mocks.createSupabase }));
vi.mock('@/lib/monday/config', () => ({ getMondayConfig: mocks.config }));
vi.mock('@/lib/monday/client', () => ({
  MondayClientError: class MondayClientError extends Error {
    constructor(public code: string, public retryable: boolean, public metadata: { requestId?: string } = {}) { super(code); }
  },
  verifyMondaySchema: mocks.verifySchema,
  verifyMondayCleanupSchema: mocks.verifyCleanupSchema,
  findItemsByCrmRecordId: mocks.find,
  getMondayItemById: mocks.get,
  createMondayItem: mocks.create,
  updateMondayItem: mocks.update,
  scrubMondayItem: mocks.scrub,
  renameMondayItem: mocks.rename,
  deleteMondayItem: mocks.remove,
}));
vi.mock('@/lib/monday/outbox', () => ({
  claimNextMondaySync: mocks.claim,
  reserveMondaySyncSend: mocks.reserve,
  completeMondaySyncUpsert: mocks.completeUpsert,
  completeMondaySyncScrub: mocks.completeScrub,
  completeMondaySyncDelete: mocks.completeDelete,
  markMondaySyncRetry: mocks.retry,
  markMondaySyncUnknown: mocks.unknown,
  markMondaySyncConflict: mocks.conflict,
}));
vi.mock('@/lib/monday/projection', () => ({ buildMondayCreatePayload: mocks.createPayload, buildMondayUpdatePayload: mocks.updatePayload }));
vi.mock('@/lib/observability/events', () => ({ emitEvent: mocks.event }));

const token = '11111111-1111-4111-8111-111111111111';
const claim = (overrides = {}) => ({ id: 'sync-1', crm_lead_id: 'lead-1', revision: 1, operation: 'upsert', payload: { crmRecordId: 'crm-1' }, claim_token: token, resolution: 'claimed', ...overrides });
const reservation = (overrides = {}) => ({ providerOperation: 'update', targetItemId: 'item-1', itemName: 'Balance Assist - crm-1', frozenPayloadHash: 'a'.repeat(64), requestKey: 'key-1', ...overrides });

describe('POST /api/internal/monday-dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.auth.mockReturnValue({ ok: true });
    mocks.hasSupabase.mockReturnValue(true);
    mocks.createSupabase.mockReturnValue({});
    mocks.config.mockReturnValue({ upsertEnabled: true, cleanupEnabled: true });
    mocks.verifySchema.mockResolvedValue({});
    mocks.verifyCleanupSchema.mockResolvedValue({});
    mocks.claim.mockResolvedValue(null);
    mocks.reserve.mockResolvedValue(reservation());
    mocks.completeUpsert.mockResolvedValue(true);
    mocks.completeScrub.mockResolvedValue(true);
    mocks.completeDelete.mockResolvedValue(true);
    mocks.retry.mockResolvedValue(true);
    mocks.unknown.mockResolvedValue(true);
    mocks.conflict.mockResolvedValue(true);
    mocks.get.mockResolvedValue({ id: 'item-1', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1' });
    mocks.createPayload.mockReturnValue({ itemName: 'Balance Assist - crm-1', columnValues: { crm_record_id: 'crm-1' } });
    mocks.updatePayload.mockReturnValue({ crm_record_id: 'crm-1' });
    mocks.scrub.mockResolvedValue({ itemId: 'item-1' });
    mocks.rename.mockResolvedValue({ itemId: 'item-1' });
  });

  async function dispatch() {
    const { POST } = await import('@/app/api/internal/monday-dispatch/route');
    return POST(new Request('http://localhost/api/internal/monday-dispatch', { method: 'POST', headers: { authorization: 'Bearer secret', 'x-request-id': 'rid-1' } }));
  }

  test('authenticates before any provider or database access', async () => {
    mocks.auth.mockReturnValue({ ok: false, status: 401, error: 'Unauthorized' } as never);
    const response = await dispatch();
    expect(response.status).toBe(401);
    expect(mocks.hasSupabase).not.toHaveBeenCalled();
    expect(mocks.verifySchema).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  test('fails closed with 503 when every Monday lane is disabled', async () => {
    mocks.config.mockReturnValue({ upsertEnabled: false, cleanupEnabled: false });
    const response = await dispatch();
    expect(response.status).toBe(503);
    expect(mocks.verifySchema).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  test('attests the cleanup schema even when cleanup is the only enabled lane', async () => {
    mocks.config.mockReturnValue({ upsertEnabled: false, cleanupEnabled: true });
    mocks.claim.mockResolvedValue(null);
    const response = await dispatch();
    expect(response.status).toBe(200);
    expect(mocks.verifySchema).not.toHaveBeenCalled();
    expect(mocks.verifyCleanupSchema).toHaveBeenCalledTimes(1);
  });

  test('claims cleanup work directly instead of leasing a disabled upsert first', async () => {
    mocks.config.mockReturnValue({ upsertEnabled: false, cleanupEnabled: true });
    mocks.claim.mockImplementation(async (_supabase, _leaseSeconds, operations) => {
      if (operations?.includes('delete')) return claim({ id: 'cleanup-1', operation: 'delete' });
      return claim({ id: 'upsert-1' });
    });
    mocks.reserve.mockResolvedValue(reservation({ providerOperation: 'scrub', targetItemId: 'item-1' }));
    mocks.get
      .mockResolvedValueOnce({ id: 'item-1', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1', name: 'Jane Doe', sourceColumnTexts: ['Jane Doe'] })
      .mockResolvedValueOnce({ id: 'item-1', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1', name: 'crm-1', sourceColumnTexts: [] });
    mocks.scrub.mockResolvedValue({ itemId: 'item-1' });
    await dispatch();
    expect(mocks.claim).toHaveBeenCalledWith(expect.anything(), 120, ['delete']);
    expect(mocks.reserve).toHaveBeenCalledWith(expect.anything(), 'cleanup-1', token);
    expect(mocks.completeScrub).toHaveBeenCalledWith(expect.anything(), 'cleanup-1', token, undefined);
  });

  test('does not mutate an upsert after full schema drift', async () => {
    mocks.verifySchema.mockRejectedValue(new Error('drift'));
    mocks.claim.mockResolvedValueOnce(claim()).mockResolvedValueOnce(null);
    const response = await dispatch();
    expect(response.status).toBe(200);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.event).toHaveBeenCalledWith('monday_schema_drift', expect.any(Object), expect.stringMatching(/^[a-z0-9-]{8}$/i));
  });

  test('continues an independently attested cleanup lane after full schema drift', async () => {
    mocks.verifySchema.mockRejectedValue(new Error('drift'));
    mocks.claim.mockResolvedValueOnce(claim({ operation: 'delete' })).mockResolvedValueOnce(null);
    mocks.reserve.mockResolvedValue(reservation({ providerOperation: 'scrub', targetItemId: 'item-1' }));
    mocks.get
      .mockResolvedValueOnce({ id: 'item-1', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1', name: 'Jane Doe', sourceColumnTexts: ['Jane Doe'] })
      .mockResolvedValueOnce({ id: 'item-1', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1', name: 'crm-1', sourceColumnTexts: [] });
    mocks.scrub.mockResolvedValue({ itemId: 'item-1' });
    await dispatch();
    expect(mocks.verifyCleanupSchema).toHaveBeenCalled();
    expect(mocks.rename).toHaveBeenCalled();
    expect(mocks.completeScrub).toHaveBeenCalled();
  });

  test('verifies a stored item ID before updating it', async () => {
    mocks.claim.mockResolvedValueOnce(claim()).mockResolvedValueOnce(null);
    mocks.update.mockResolvedValue({ itemId: 'item-1' });
    await dispatch();
    expect(mocks.get).toHaveBeenCalledWith('item-1');
    expect(mocks.update).toHaveBeenCalledWith('item-1', { crm_record_id: 'crm-1' }, 'key-1');
    expect(mocks.completeUpsert).toHaveBeenCalledWith(expect.anything(), 'sync-1', token, 'item-1', undefined);
  });

  test('marks a stored ID with a mismatched key as conflict without writing', async () => {
    mocks.claim.mockResolvedValueOnce(claim()).mockResolvedValueOnce(null);
    mocks.get.mockResolvedValue({ id: 'item-1', boardId: '18421762586', state: 'active', crmRecordId: 'other-record' });
    await dispatch();
    expect(mocks.conflict).toHaveBeenCalledWith(expect.anything(), 'sync-1', token, undefined);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test('looks up a missing ID and creates only when the lookup is empty', async () => {
    mocks.claim.mockResolvedValueOnce(claim()).mockResolvedValueOnce(null);
    mocks.reserve.mockResolvedValue(reservation({ providerOperation: 'create', targetItemId: null }));
    mocks.find.mockResolvedValue({ items: [] });
    mocks.create.mockResolvedValue({ itemId: 'created-1' });
    await dispatch();
    expect(mocks.find).toHaveBeenCalledWith('crm-1');
    expect(mocks.create).toHaveBeenCalledWith('Balance Assist - crm-1', { crm_record_id: 'crm-1' }, 'key-1');
    expect(mocks.completeUpsert).toHaveBeenCalledWith(expect.anything(), 'sync-1', token, 'created-1', undefined);
  });

  test('adopts one recovered item and updates it rather than creating', async () => {
    mocks.claim.mockResolvedValueOnce(claim({ resolution: 'recovery' })).mockResolvedValueOnce(null);
    mocks.reserve.mockResolvedValue(reservation({ providerOperation: 'create', targetItemId: null }));
    mocks.find.mockResolvedValue({ items: [{ id: 'recovered-1' }] });
    mocks.get.mockResolvedValue({ id: 'recovered-1', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1' });
    mocks.update.mockResolvedValue({ itemId: 'recovered-1' });
    await dispatch();
    expect(mocks.update).toHaveBeenCalledWith('recovered-1', { crm_record_id: 'crm-1' }, 'key-1');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test('never recreates after an empty delivery-unknown lookup', async () => {
    mocks.claim.mockResolvedValueOnce(claim({ resolution: 'recovery' })).mockResolvedValueOnce(null);
    mocks.reserve.mockResolvedValue(reservation({ providerOperation: 'create', targetItemId: null }));
    mocks.find.mockResolvedValue({ items: [] });
    await dispatch();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.unknown).toHaveBeenCalledWith(expect.anything(), 'sync-1', token, 'monday_delivery_unknown');
  });

  test('marks create delivery as unknown after a provider error without recreating', async () => {
    mocks.claim.mockResolvedValueOnce(claim()).mockResolvedValueOnce(null);
    mocks.reserve.mockResolvedValue(reservation({ providerOperation: 'create', targetItemId: null }));
    mocks.find.mockResolvedValue({ items: [] });
    mocks.create.mockRejectedValue(new Error('email=user@example.com token=private'));
    await dispatch();
    expect(mocks.unknown).toHaveBeenCalledWith(expect.anything(), 'sync-1', token, 'monday_delivery_unknown', undefined);
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.event).toHaveBeenCalledWith('monday_sync_unknown', expect.objectContaining({ syncId: 'sync-1', reason: 'monday_delivery_unknown' }), expect.stringMatching(/^[a-z0-9-]{8}$/i));
  });

  test('scrubs to an opaque CRM key and refetches PII-free state before completion', async () => {
    mocks.claim.mockResolvedValueOnce(claim({ operation: 'delete' })).mockResolvedValueOnce(null);
    mocks.reserve.mockResolvedValue(reservation({ providerOperation: 'scrub', targetItemId: 'item-1' }));
    mocks.get
      .mockResolvedValueOnce({ id: 'item-1', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1', name: 'Jane Doe', sourceColumnTexts: ['Jane Doe', 'user@example.com'] })
      .mockResolvedValueOnce({ id: 'item-1', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1', name: 'crm-1', sourceColumnTexts: [] });
    mocks.update.mockResolvedValue({ itemId: 'item-1' });
    await dispatch();
    expect(mocks.rename).toHaveBeenCalledWith('item-1', 'crm-1', 'key-1');
    expect(mocks.scrub).toHaveBeenCalledWith('item-1', expect.any(Object), 'key-1');
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.completeScrub).toHaveBeenCalledWith(expect.anything(), 'sync-1', token, undefined);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  test('does not complete a scrub when the refetch contains PII', async () => {
    mocks.claim.mockResolvedValueOnce(claim({ operation: 'delete' })).mockResolvedValueOnce(null);
    mocks.reserve.mockResolvedValue(reservation({ providerOperation: 'scrub', targetItemId: 'item-1' }));
    mocks.get.mockResolvedValue({ id: 'item-1', boardId: '18421762586', state: 'active', crmRecordId: 'crm-1', name: 'Jane Doe', sourceColumnTexts: ['user@example.com'] });
    mocks.update.mockResolvedValue({ itemId: 'item-1' });
    await dispatch();
    expect(mocks.completeScrub).not.toHaveBeenCalled();
    expect(mocks.retry).toHaveBeenCalledWith(expect.anything(), 'sync-1', token, 'monday_payload_invalid', expect.any(Number), undefined);
  });

  test('keeps credential failures stable and records the sanitized provider request ID', async () => {
    mocks.claim.mockResolvedValueOnce(claim()).mockResolvedValueOnce(null);
    mocks.update.mockRejectedValue({ code: 'monday_permission_denied', metadata: { requestId: 'monday:req-1' } });
    await dispatch();
    expect(mocks.retry).toHaveBeenCalledWith(expect.anything(), 'sync-1', token, 'monday_permission_denied', expect.any(Number), 'monday:req-1');
    expect(mocks.event).toHaveBeenCalledWith('monday_sync_failed', expect.objectContaining({ reason: 'monday_permission_denied' }), expect.stringMatching(/^[a-z0-9-]{8}$/i));
  });

  test('keeps a credential-blocked deletion outstanding for the manual DSR path', async () => {
    mocks.claim.mockResolvedValueOnce(claim({ operation: 'delete' })).mockResolvedValueOnce(null);
    mocks.reserve.mockResolvedValue(reservation({ providerOperation: 'delete', targetItemId: 'item-1' }));
    mocks.remove.mockRejectedValue({ code: 'monday_auth_failed', metadata: { requestId: 'request-8' } });
    const response = await dispatch();
    await expect(response.json()).resolves.toMatchObject({ results: [{ id: 'sync-1', status: 'manual_dsr_required' }] });
    expect(mocks.retry).toHaveBeenCalledWith(expect.anything(), 'sync-1', token, 'monday_auth_failed', expect.any(Number), 'request-8');
    expect(mocks.completeDelete).not.toHaveBeenCalled();
  });

  test('records unknown delivery when provider success cannot be completed locally', async () => {
    mocks.claim.mockResolvedValueOnce(claim()).mockResolvedValueOnce(null);
    mocks.update.mockResolvedValue({ itemId: 'item-1', metadata: { requestId: 'request-7' } });
    mocks.completeUpsert.mockResolvedValue(false);
    await dispatch();
    expect(mocks.unknown).toHaveBeenCalledWith(expect.anything(), 'sync-1', token, 'monday_delivery_unknown', 'request-7');
  });
});
