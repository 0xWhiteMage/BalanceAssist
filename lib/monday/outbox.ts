import type { SupabaseServerClient } from '@/lib/supabase/server';

type MondaySyncClaimBase = {
  id: string;
  crm_lead_id: string;
  revision: number;
  operation: 'upsert' | 'delete';
  payload: Record<string, unknown> | null;
};

export type MondaySyncClaim = MondaySyncClaimBase & {
  claim_token: string;
  resolution: 'claimed' | 'recovery';
};

export type MondaySyncSuppressed = MondaySyncClaimBase & {
  claim_token: null;
  resolution: 'suppressed';
};

export type MondaySyncClaimResult = MondaySyncClaim | MondaySyncSuppressed;

export type MondaySyncReservation = {
  providerOperation: 'create' | 'update' | 'scrub' | 'delete';
  targetItemId: string | null;
  itemName: string;
  frozenPayloadHash: string | null;
  requestKey: string;
};

function isClaim(value: unknown): value is MondaySyncClaimResult {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const validBase = typeof row.id === 'string' && typeof row.crm_lead_id === 'string'
    && typeof row.revision === 'number' && (row.operation === 'upsert' || row.operation === 'delete')
    && (row.payload === null || (typeof row.payload === 'object' && !Array.isArray(row.payload)));
  return validBase && (((row.resolution === 'claimed' || row.resolution === 'recovery') && typeof row.claim_token === 'string')
    || (row.resolution === 'suppressed' && row.claim_token === null));
}

export async function claimNextMondaySync(supabase: SupabaseServerClient, leaseSeconds = 120, operations: Array<'upsert' | 'delete'> = ['upsert', 'delete']): Promise<MondaySyncClaimResult | null> {
  const { data, error } = await supabase.rpc('claim_next_monday_sync', { p_lease_seconds: leaseSeconds, p_operations: operations });
  if (error || !Array.isArray(data) || data.length !== 1 || !isClaim(data[0])) return null;
  return data[0];
}

async function transition(supabase: SupabaseServerClient, name: string, args: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await supabase.rpc(name, args);
  return !error && data === true;
}

function isReservation(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (row.provider_operation === 'create' || row.provider_operation === 'update' || row.provider_operation === 'scrub' || row.provider_operation === 'delete')
    && (typeof row.target_item_id === 'string' || row.target_item_id === null)
    && typeof row.item_name === 'string' && row.item_name.length >= 1 && row.item_name.length <= 255
    && (row.frozen_payload_hash === null || (typeof row.frozen_payload_hash === 'string' && /^[0-9a-f]{64}$/.test(row.frozen_payload_hash)))
    && typeof row.request_key === 'string';
}

export async function reserveMondaySyncSend(supabase: SupabaseServerClient, syncId: string, claimToken: string): Promise<MondaySyncReservation | null> {
  const { data, error } = await supabase.rpc('reserve_monday_sync_send', { p_sync_id: syncId, p_claim_token: claimToken });
  if (error || !Array.isArray(data) || data.length !== 1 || !isReservation(data[0])) return null;
  const row = data[0];
  return {
    providerOperation: row.provider_operation as MondaySyncReservation['providerOperation'],
    targetItemId: row.target_item_id as string | null,
    itemName: row.item_name as string,
    frozenPayloadHash: row.frozen_payload_hash as string | null,
    requestKey: row.request_key as string,
  };
}

export function completeMondaySyncUpsert(supabase: SupabaseServerClient, syncId: string, claimToken: string, itemId: string, providerRequestId?: string) {
  return transition(supabase, 'complete_monday_sync_upsert', { p_sync_id: syncId, p_claim_token: claimToken, p_item_id: itemId, p_provider_request_id: providerRequestId ?? null });
}

export function completeMondaySyncScrub(supabase: SupabaseServerClient, syncId: string, claimToken: string, providerRequestId?: string) {
  return transition(supabase, 'complete_monday_sync_scrub', { p_sync_id: syncId, p_claim_token: claimToken, p_provider_request_id: providerRequestId ?? null });
}

export function completeMondaySyncDelete(supabase: SupabaseServerClient, syncId: string, claimToken: string, providerRequestId?: string) {
  return transition(supabase, 'complete_monday_sync_delete', { p_sync_id: syncId, p_claim_token: claimToken, p_provider_request_id: providerRequestId ?? null });
}

export function markMondaySyncRetry(supabase: SupabaseServerClient, syncId: string, claimToken: string, code: string, delaySeconds: number, providerRequestId?: string) {
  return transition(supabase, 'mark_monday_sync_retry', { p_sync_id: syncId, p_claim_token: claimToken, p_code: code, p_delay_seconds: delaySeconds, p_provider_request_id: providerRequestId ?? null });
}

export function markMondaySyncUnknown(supabase: SupabaseServerClient, syncId: string, claimToken: string, code: string, providerRequestId?: string) {
  return transition(supabase, 'mark_monday_sync_unknown', { p_sync_id: syncId, p_claim_token: claimToken, p_code: code, p_provider_request_id: providerRequestId ?? null });
}

export function markMondaySyncConflict(supabase: SupabaseServerClient, syncId: string, claimToken: string, providerRequestId?: string) {
  return transition(supabase, 'mark_monday_sync_conflict', { p_sync_id: syncId, p_claim_token: claimToken, p_provider_request_id: providerRequestId ?? null });
}

export async function claimMondayReconciliationPage(supabase: SupabaseServerClient) {
  const { data, error } = await supabase.rpc('claim_monday_reconciliation_page');
  if (error || !Array.isArray(data) || data.length !== 1) return null;
  const row = data[0] as Record<string, unknown>;
  return typeof row.id === 'string' && (typeof row.cursor === 'string' || row.cursor === null)
    ? { id: row.id, cursor: row.cursor as string | null }
    : null;
}

export function recordMondayReconciledItem(supabase: SupabaseServerClient, checkpointId: string, item: { itemId: string; crmRecordId: string; active: boolean; sourceDrift: boolean }) {
  return supabase.rpc('record_monday_reconciled_item', {
    p_checkpoint_id: checkpointId,
    p_item_id: item.itemId,
    p_crm_record_id: item.crmRecordId,
    p_active: item.active,
    p_source_drift: item.sourceDrift,
  }).then(({ data, error }) => !error && typeof data === 'string' ? data : 'unavailable');
}

export function recordMondayReconciliationCursor(supabase: SupabaseServerClient, checkpointId: string, cursor: string | null) {
  return transition(supabase, 'record_monday_reconciliation_cursor', { p_checkpoint_id: checkpointId, p_cursor: cursor });
}

export async function finishMondayReconciliation(supabase: SupabaseServerClient, checkpointId: string) {
  const { data, error } = await supabase.rpc('finish_monday_reconciliation', { p_checkpoint_id: checkpointId });
  return !error && data && typeof data === 'object' ? data as { repairs: number } : null;
}
