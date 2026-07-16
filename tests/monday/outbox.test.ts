import { describe, expect, test, vi } from 'vitest';

import {
  claimNextMondaySync,
  completeMondaySyncDelete,
  completeMondaySyncScrub,
  completeMondaySyncUpsert,
  markMondaySyncConflict,
  markMondaySyncRetry,
  markMondaySyncUnknown,
  reserveMondaySyncSend,
} from '../../lib/monday/outbox';

function rpcClient(data: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data, error }) };
}

describe('Monday sync outbox RPC wrappers', () => {
  test('claims only a validated claimed row through the state-machine RPC', async () => {
    const client = rpcClient([{
      id: '3eb48b47-d6b4-4ff2-963e-2407e81001a7',
      crm_lead_id: 'c7ee06e3-4b6b-4484-b578-9260c2932b26',
      revision: 2,
      operation: 'upsert',
      payload: { crmRecordId: 'crm-1' },
      claim_token: '9124ae02-59b6-4371-a7f5-7511b97ab1c4',
      resolution: 'claimed',
    }]);

    await expect(claimNextMondaySync(client as never)).resolves.toMatchObject({ resolution: 'claimed', revision: 2 });
    expect(client.rpc).toHaveBeenCalledWith('claim_next_monday_sync', { p_lease_seconds: 120, p_operations: ['upsert', 'delete'] });
  });

  test('passes a cleanup-only operation filter without claiming upserts', async () => {
    const client = rpcClient([]);
    await claimNextMondaySync(client as never, 120, ['delete']);
    expect(client.rpc).toHaveBeenCalledWith('claim_next_monday_sync', { p_lease_seconds: 120, p_operations: ['delete'] });
  });

  test('rejects malformed claim results rather than passing unsafe data to a worker', async () => {
    await expect(claimNextMondaySync(rpcClient([{ id: 'not-a-uuid' }]) as never)).resolves.toBeNull();
  });

  test.each([['a payload string'], [42], [[]]])('rejects non-object claim payloads', async (payload) => {
    await expect(claimNextMondaySync(rpcClient([{
      id: '3eb48b47-d6b4-4ff2-963e-2407e81001a7',
      crm_lead_id: 'c7ee06e3-4b6b-4484-b578-9260c2932b26',
      revision: 1,
      operation: 'upsert',
      payload,
      claim_token: '9124ae02-59b6-4371-a7f5-7511b97ab1c4',
      resolution: 'claimed',
    }]) as never)).resolves.toBeNull();
  });

  test('preserves a suppressed claim with its observable nullable token', async () => {
    const client = rpcClient([{
      id: '3eb48b47-d6b4-4ff2-963e-2407e81001a7',
      crm_lead_id: 'c7ee06e3-4b6b-4484-b578-9260c2932b26',
      revision: 1,
      operation: 'upsert',
      payload: null,
      claim_token: null,
      resolution: 'suppressed',
    }]);

    await expect(claimNextMondaySync(client as never)).resolves.toMatchObject({ resolution: 'suppressed', claim_token: null });
  });

  test('exposes a delivery-unknown recovery claim without treating it as new work', async () => {
    const client = rpcClient([{
      id: '3eb48b47-d6b4-4ff2-963e-2407e81001a7',
      crm_lead_id: 'c7ee06e3-4b6b-4484-b578-9260c2932b26',
      revision: 1,
      operation: 'upsert',
      payload: { crmRecordId: 'opaque' },
      claim_token: '9124ae02-59b6-4371-a7f5-7511b97ab1c4',
      resolution: 'recovery',
    }]);

    await expect(claimNextMondaySync(client as never)).resolves.toMatchObject({ resolution: 'recovery', claim_token: expect.any(String) });
  });

  test('returns the complete frozen reservation intent needed for exactly one provider mutation', async () => {
    const client = rpcClient([{
      provider_operation: 'create',
      target_item_id: null,
      item_name: 'Balance Assist - a1b2c3d4',
      frozen_payload_hash: 'a'.repeat(64),
      request_key: '9124ae02-59b6-4371-a7f5-7511b97ab1c4',
    }]);

    await expect(reserveMondaySyncSend(client as never, 'sync-id', 'claim-token')).resolves.toEqual({
      providerOperation: 'create',
      targetItemId: null,
      itemName: 'Balance Assist - a1b2c3d4',
      frozenPayloadHash: 'a'.repeat(64),
      requestKey: '9124ae02-59b6-4371-a7f5-7511b97ab1c4',
    });
  });

  test('rejects incomplete reservation results so a worker cannot invent frozen intent', async () => {
    await expect(reserveMondaySyncSend(rpcClient(true) as never, 'sync-id', 'claim-token')).resolves.toBeNull();
    await expect(reserveMondaySyncSend(rpcClient([{ provider_operation: 'create' }]) as never, 'sync-id', 'claim-token')).resolves.toBeNull();
  });

  test.each([
    ['complete_monday_sync_upsert', completeMondaySyncUpsert, ['sync-id', 'claim-token', 'item-id']],
    ['complete_monday_sync_scrub', completeMondaySyncScrub, ['sync-id', 'claim-token']],
    ['complete_monday_sync_delete', completeMondaySyncDelete, ['sync-id', 'claim-token', 'provider-request-id']],
    ['mark_monday_sync_conflict', markMondaySyncConflict, ['sync-id', 'claim-token']],
    ['mark_monday_sync_unknown', markMondaySyncUnknown, ['sync-id', 'claim-token', 'monday_delivery_unknown']],
    ['mark_monday_sync_retry', markMondaySyncRetry, ['sync-id', 'claim-token', 'monday_temporary_failure', 30]],
  ])('uses %s and returns true only when the token-guarded transition applied', async (rpcName, method, args) => {
    const client = rpcClient(true);

    await expect(method(client as never, ...(args as [string, string, never, never]))).resolves.toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(rpcName, expect.any(Object));
  });

  test.each([
    [completeMondaySyncUpsert, ['sync-id', 'stale-token', 'item-id']],
    [completeMondaySyncScrub, ['sync-id', 'stale-token']],
    [completeMondaySyncDelete, ['sync-id', 'stale-token', 'provider-request-id']],
    [markMondaySyncConflict, ['sync-id', 'stale-token']],
    [markMondaySyncUnknown, ['sync-id', 'stale-token', 'monday_delivery_unknown']],
    [markMondaySyncRetry, ['sync-id', 'stale-token', 'monday_temporary_failure', 30]],
  ])('does not report a stale-token completion transition as applied', async (method, args) => {
    await expect(method(rpcClient(false) as never, ...(args as [string, string, never, never]))).resolves.toBe(false);
  });

  test('returns null when an RPC rejects a stale claim token', async () => {
    await expect(reserveMondaySyncSend(rpcClient([]) as never, 'sync-id', 'stale-token')).resolves.toBeNull();
  });
});
