import { NextResponse } from 'next/server';

import schema from '../../../../config/monday-crm-schema.json';
import { buildMondayCreatePayload, buildMondayUpdatePayload } from '@/lib/monday/projection';
import { getMondayConfig } from '@/lib/monday/config';
import {
  MondayClientError,
  createMondayItem,
  deleteMondayItem,
  findItemsByCrmRecordId,
  getMondayItemById,
  renameMondayItem,
  scrubMondayItem,
  updateMondayItem,
  verifyMondayCleanupSchema,
  verifyMondaySchema,
} from '@/lib/monday/client';
import {
  claimNextMondaySync,
  completeMondaySyncDelete,
  completeMondaySyncScrub,
  completeMondaySyncUpsert,
  markMondaySyncConflict,
  markMondaySyncRetry,
  markMondaySyncUnknown,
  reserveMondaySyncSend,
} from '@/lib/monday/outbox';
import { emitEvent } from '@/lib/observability/events';
import { extractRequestId } from '@/lib/logger';
import { validateAdminRequestAny } from '@/lib/security/config';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

const MAX_BATCH_SIZE = 5;
const DEADLINE_MS = 45_000;
const MIN_REMAINING_MS = 12_000;
const RETRY_DELAY_SECONDS = 60;
const MONDAY_FAILURE_CODES = new Set([
  'monday_auth_failed', 'monday_permission_denied', 'monday_rate_limited',
  'monday_schema_drift', 'monday_payload_invalid', 'monday_temporary_failure',
  'monday_provider_idempotency_conflict', 'monday_delivery_unknown', 'monday_duplicate_key_conflict',
]);
const SCRUB_COLUMN_VALUES = Object.fromEntries(
  schema.sourceOwnedColumns
    .filter((column) => column !== 'crm_record_id')
    .map((column) => [schema.columns[column as keyof typeof schema.columns].id, null]),
);

type Claim = NonNullable<Awaited<ReturnType<typeof claimNextMondaySync>>>;

function safeCode(error: unknown) {
  const code = error instanceof MondayClientError || error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as MondayClientError).code
    : undefined;
  return typeof code === 'string' && MONDAY_FAILURE_CODES.has(code) ? code : 'monday_temporary_failure';
}

function providerRequestId(error: unknown) {
  const value = error && typeof error === 'object' ? (error as { metadata?: { requestId?: unknown } }).metadata?.requestId : undefined;
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,200}$/.test(value) ? value : undefined;
}

function verifiedItem(item: { boardId: string; state: string; crmRecordId: string }, crmRecordId: string) {
  return item.boardId === schema.boardId && item.state === 'active' && item.crmRecordId === crmRecordId;
}

function eventData(claim: Claim, startedAt: number, reason?: string) {
  return {
    crmRecordId: claim.crm_lead_id,
    syncId: claim.id,
    revision: claim.revision,
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(reason ? { reason } : {}),
  };
}

async function recordFailure(supabase: NonNullable<ReturnType<typeof createServerSupabaseClient>>, claim: Claim, requestId: string | undefined, startedAt: number, error: unknown, createMayHaveBeenSent: boolean, providerId?: string) {
  if (!claim.claim_token) return 'stale';
  const code = safeCode(error);
  if (createMayHaveBeenSent && !['monday_auth_failed', 'monday_permission_denied', 'monday_payload_invalid'].includes(code)) {
    await markMondaySyncUnknown(supabase, claim.id, claim.claim_token, 'monday_delivery_unknown', providerId);
    emitEvent('monday_sync_unknown', eventData(claim, startedAt, 'monday_delivery_unknown'), requestId);
    return 'unknown';
  }
  await markMondaySyncRetry(supabase, claim.id, claim.claim_token, code, RETRY_DELAY_SECONDS, providerId);
  emitEvent('monday_sync_failed', eventData(claim, startedAt, code), requestId);
  return claim.operation === 'delete' && (code === 'monday_auth_failed' || code === 'monday_permission_denied')
    ? 'manual_dsr_required'
    : 'retry_scheduled';
}

export async function POST(request: Request) {
  const requestId = extractRequestId(request);
  const auth = validateAdminRequestAny(request, ['CRON_SECRET', 'INTERNAL_DISPATCH_SECRET']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  if (!hasSupabaseServerConfig()) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  const supabase = createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });

  let config;
  try {
    config = getMondayConfig();
  } catch {
    return NextResponse.json({ ok: false, error: 'Monday integration unavailable' }, { status: 503 });
  }
  if (!config.upsertEnabled && !config.cleanupEnabled) {
    return NextResponse.json({ ok: false, error: 'Monday integration disabled' }, { status: 503 });
  }

  let upsertsAllowed = false;
  let cleanupAllowed = false;
  if (config.upsertEnabled) {
    try {
      await verifyMondaySchema(schema);
      upsertsAllowed = true;
    } catch {
      emitEvent('monday_schema_drift', { reason: 'monday_schema_drift' }, requestId);
    }
  }
  if (config.cleanupEnabled) {
    try {
      await verifyMondayCleanupSchema(schema);
      cleanupAllowed = true;
    } catch {
      emitEvent('monday_schema_drift', { reason: 'monday_schema_drift' }, requestId);
    }
  }
  if (!upsertsAllowed && !cleanupAllowed) {
    return NextResponse.json({ ok: false, error: 'Monday schema unavailable' }, { status: 503 });
  }

  const deadline = Date.now() + DEADLINE_MS;
  const results: Array<{ id: string; status: string }> = [];
  const operations = [
    ...(upsertsAllowed ? ['upsert' as const] : []),
    ...(cleanupAllowed ? ['delete' as const] : []),
  ];
  for (let batch = 0; batch < MAX_BATCH_SIZE && Date.now() + MIN_REMAINING_MS < deadline; batch++) {
    const claim = await claimNextMondaySync(supabase, 120, operations);
    if (!claim) break;
    const startedAt = Date.now();

    if (claim.resolution === 'suppressed' || !claim.claim_token) {
      emitEvent('monday_sync_suppressed', eventData(claim, startedAt, 'producer_transfer_revoked'), requestId);
      results.push({ id: claim.id, status: 'suppressed' });
      continue;
    }
    if (claim.operation === 'upsert' && !upsertsAllowed || claim.operation === 'delete' && !cleanupAllowed) {
      // Do not reserve or send while the applicable schema attestation is unavailable.
      results.push({ id: claim.id, status: 'deferred' });
      break;
    }

    let providerMayHaveSucceeded = false;
    try {
      const reservation = await reserveMondaySyncSend(supabase, claim.id, claim.claim_token);
      if (!reservation) {
        results.push({ id: claim.id, status: 'stale' });
        continue;
      }

      if (reservation.providerOperation === 'create') {
        if (!claim.payload || typeof claim.payload.crmRecordId !== 'string') throw new MondayClientError('monday_payload_invalid', false);
        const found = await findItemsByCrmRecordId(claim.payload.crmRecordId);
        if (found.items.length > 1) throw new MondayClientError('monday_duplicate_key_conflict', false);
        if (found.items.length === 1) {
          const item = await getMondayItemById(found.items[0].id);
          if (!verifiedItem(item, claim.payload.crmRecordId)) throw new MondayClientError('monday_duplicate_key_conflict', false);
          providerMayHaveSucceeded = true;
          const updated = await updateMondayItem(item.id, buildMondayUpdatePayload(claim.payload), reservation.requestKey);
          if (!await completeMondaySyncUpsert(supabase, claim.id, claim.claim_token, updated.itemId, updated.metadata?.requestId)) throw new MondayClientError('monday_delivery_unknown', true, updated.metadata);
        } else {
          if (claim.resolution === 'recovery') {
            await markMondaySyncUnknown(supabase, claim.id, claim.claim_token, 'monday_delivery_unknown');
            emitEvent('monday_sync_unknown', eventData(claim, startedAt, 'monday_delivery_unknown'), requestId);
            results.push({ id: claim.id, status: 'unknown' });
            continue;
          }
          const payload = buildMondayCreatePayload(claim.payload);
          providerMayHaveSucceeded = true;
          const created = await createMondayItem(payload.itemName, payload.columnValues, reservation.requestKey);
          if (!await completeMondaySyncUpsert(supabase, claim.id, claim.claim_token, created.itemId, created.metadata?.requestId)) throw new MondayClientError('monday_delivery_unknown', true, created.metadata);
        }
      } else {
        if (!reservation.targetItemId || !claim.payload || typeof claim.payload.crmRecordId !== 'string' && reservation.providerOperation !== 'scrub') {
          throw new MondayClientError('monday_payload_invalid', false);
        }
        const item = await getMondayItemById(reservation.targetItemId);
        const expectedKey = typeof claim.payload?.crmRecordId === 'string' ? claim.payload.crmRecordId : claim.crm_lead_id;
        if (!verifiedItem(item, expectedKey)) throw new MondayClientError('monday_duplicate_key_conflict', false);
        if (reservation.providerOperation === 'update') {
          providerMayHaveSucceeded = true;
          const updated = await updateMondayItem(item.id, buildMondayUpdatePayload(claim.payload), reservation.requestKey);
          if (!await completeMondaySyncUpsert(supabase, claim.id, claim.claim_token, updated.itemId, updated.metadata?.requestId)) throw new MondayClientError('monday_delivery_unknown', true, updated.metadata);
        } else if (reservation.providerOperation === 'scrub') {
          providerMayHaveSucceeded = true;
          const renamed = await renameMondayItem(item.id, expectedKey, reservation.requestKey);
          await scrubMondayItem(item.id, {
            [schema.columns.crm_record_id.id]: expectedKey,
            ...SCRUB_COLUMN_VALUES,
          }, reservation.requestKey);
          const scrubbed = await getMondayItemById(item.id);
          if (!verifiedItem(scrubbed, expectedKey) || scrubbed.name !== expectedKey || scrubbed.sourceColumnTexts.some(Boolean)) throw new MondayClientError('monday_payload_invalid', false, renamed.metadata);
          if (!await completeMondaySyncScrub(supabase, claim.id, claim.claim_token, renamed.metadata?.requestId)) throw new MondayClientError('monday_delivery_unknown', true, renamed.metadata);
        } else {
          providerMayHaveSucceeded = true;
          await deleteMondayItem(item.id, reservation.requestKey);
          if (!await completeMondaySyncDelete(supabase, claim.id, claim.claim_token)) throw new MondayClientError('monday_delivery_unknown', true);
        }
      }
      emitEvent('monday_sync_succeeded', eventData(claim, startedAt), requestId);
      results.push({ id: claim.id, status: 'synced' });
    } catch (error) {
      if (safeCode(error) === 'monday_duplicate_key_conflict') {
        await markMondaySyncConflict(supabase, claim.id, claim.claim_token, providerRequestId(error));
        emitEvent('monday_sync_conflict', eventData(claim, startedAt, 'monday_duplicate_key_conflict'), requestId);
        results.push({ id: claim.id, status: 'conflict' });
      } else {
        const status = await recordFailure(supabase, claim, requestId, startedAt, error, providerMayHaveSucceeded, providerRequestId(error));
        results.push({ id: claim.id, status });
      }
    }
  }
  return NextResponse.json({ ok: true, processed: results.length, results });
}
