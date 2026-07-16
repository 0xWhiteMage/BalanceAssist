import { NextResponse } from 'next/server';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { claimNextHandoff, deferTelegramReceiptPersistence, markDelivered, markFailed, persistTelegramMessageDelivery, recordTelegramReceipt, renewHandoffSend, reserveHandoffSend } from '@/lib/handoff/outbox';
import { createLogger, extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { ensureTelegramTopic, sendTelegramMessage } from '@/lib/telegram';
import { getMaxRetries, type HandoffSLA } from '@/lib/handoff/sla';
import { validateAdminRequestAny } from '@/lib/security/config';
import { getSessionConsent } from '@/lib/privacy/session-consent';

export const HANDOFF_DISPATCH_BATCH_SIZE = 2;

export async function POST(request: Request) {
  const requestId = extractRequestId(request);
  const logger = createLogger('handoff-dispatch', requestId);
  const authResult = validateAdminRequestAny(request, ['CRON_SECRET', 'INTERNAL_DISPATCH_SECRET']);
  if (!authResult.ok) {
    return NextResponse.json({ ok: false, error: authResult.error }, { status: authResult.status });
  }

  if (!hasSupabaseServerConfig()) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  }

  const sla: HandoffSLA = {
    maxRetryAttempts: getMaxRetries(),
    retryBackoffMs: [300_000, 300_000, 300_000],
    escalationThresholdMs: 900_000,
  };

  const results: Array<{ id: string; status: string; escalated?: boolean; retryDelayMs?: number }> = [];

  for (let batch = 0; batch < HANDOFF_DISPATCH_BATCH_SIZE; batch++) {
    const handoff = await claimNextHandoff(supabase);
    if (!handoff) break;

    try {
      const { payload } = handoff;

      if (handoff.resolution === 'suppressed') {
        emitEvent('handoff_suppressed', { handoffId: handoff.id, reason: 'session_unavailable' }, requestId);
        logger.info('Suppressed unavailable session handoff', { handoffId: handoff.id });
        results.push({ id: handoff.id, status: 'suppressed' });
        continue;
      }

      if (payload.type === 'approval') {
        const consent = await getSessionConsent(supabase as never, handoff.session_id);
        if (!consent.producerTransfer) {
          const outcome = await markFailed(supabase, handoff.id, handoff.claim_token ?? '', 'producer_transfer_revoked', {
            maxRetryAttempts: 0,
            retryBackoffMs: [],
            escalationThresholdMs: 0
          });
          if (outcome.applied) {
            emitEvent('handoff_suppressed', { handoffId: handoff.id, reason: 'producer_transfer_revoked' }, requestId);
            results.push({ id: handoff.id, status: 'suppressed' });
          } else {
            results.push({ id: handoff.id, status: 'stale' });
          }
          continue;
        }
      }

      if (!handoff.claim_token || !await reserveHandoffSend(supabase, handoff.id, handoff.claim_token)) {
        logger.info('Skipped stale handoff claim', { handoffId: handoff.id });
        results.push({ id: handoff.id, status: 'stale' });
        continue;
      }

      if (payload.type === 'approval' || payload.type === 'relay') {
        if (typeof payload.telegramMessageId === 'number' && typeof payload.telegramThreadId === 'number') {
          const persisted = payload.type !== 'relay' || (
            typeof payload.messageId === 'number' &&
            await persistTelegramMessageDelivery(supabase, payload.messageId, payload.telegramThreadId, payload.telegramMessageId)
          );
          if (!persisted) {
            const deferred = await deferTelegramReceiptPersistence(supabase, handoff.id, handoff.claim_token);
            logger.warn('Telegram receipt persistence deferred', { handoffId: handoff.id, deferred });
            results.push({ id: handoff.id, status: deferred ? 'retry_scheduled' : 'stale' });
            continue;
          }

          const applied = await markDelivered(supabase, handoff.id, handoff.claim_token);
          if (!applied) {
            logger.warn('Skipped stale receipt completion', { handoffId: handoff.id });
            results.push({ id: handoff.id, status: 'stale' });
            continue;
          }
          const durationMs = handoff.created_at
            ? Math.max(0, Date.now() - new Date(handoff.created_at).getTime())
            : 0;
          emitEvent('handoff_delivered', { handoffId: handoff.id, durationMs }, requestId);
          results.push({ id: handoff.id, status: 'sent' });
          continue;
        }

        const threadId = await ensureTelegramTopic(
          supabase,
          handoff.session_id,
          null,
          null,
          handoff.session_id.slice(0, 8)
        );
        if (!threadId) {
          const outcome = await markFailed(supabase, handoff.id, handoff.claim_token, 'telegram_topic_unavailable', sla);
          if (!outcome.applied) {
            results.push({ id: handoff.id, status: 'stale' });
            continue;
          }
          emitEvent(
            outcome.escalated ? 'handoff_escalated' : 'handoff_failed',
            { handoffId: handoff.id, reason: 'telegram_topic_unavailable' },
            requestId
          );
          logger.warn('Telegram topic unavailable', {
            handoffId: handoff.id,
            escalated: outcome.escalated,
            shouldRetry: outcome.shouldRetry,
            retryDelayMs: outcome.retryDelayMs,
          });
          results.push({
            id: handoff.id,
            status: outcome.escalated ? 'escalated' : outcome.shouldRetry ? 'retry_scheduled' : 'failed',
            escalated: outcome.escalated,
            retryDelayMs: outcome.retryDelayMs,
          });
          continue;
        }

        if (!await renewHandoffSend(supabase, handoff.id, handoff.claim_token)) {
          logger.info('Skipped stale handoff after topic resolution', { handoffId: handoff.id });
          results.push({ id: handoff.id, status: 'stale' });
          continue;
        }

        const result = await sendTelegramMessage(payload.summary, {
          threadId
        });

        if (result) {
          const receiptPayload = { ...payload, telegramMessageId: result.messageId, telegramThreadId: threadId };
          if (!await recordTelegramReceipt(supabase, handoff.id, handoff.claim_token, receiptPayload)) {
            logger.warn('Telegram receipt ownership lost', { handoffId: handoff.id });
            results.push({ id: handoff.id, status: 'stale' });
            continue;
          }

          if (payload.type === 'relay' && (
            typeof payload.messageId !== 'number' ||
            !await persistTelegramMessageDelivery(supabase, payload.messageId, threadId, result.messageId)
          )) {
            const deferred = await deferTelegramReceiptPersistence(supabase, handoff.id, handoff.claim_token);
            logger.warn('Telegram receipt persistence deferred', { handoffId: handoff.id, deferred });
            results.push({ id: handoff.id, status: deferred ? 'retry_scheduled' : 'stale' });
            continue;
          }

          const applied = await markDelivered(supabase, handoff.id, handoff.claim_token);
          if (!applied) {
            logger.warn('Skipped stale handoff completion', { handoffId: handoff.id });
            results.push({ id: handoff.id, status: 'stale' });
            continue;
          }
          const durationMs = handoff.created_at
            ? Math.max(0, Date.now() - new Date(handoff.created_at).getTime())
            : 0;
          emitEvent('handoff_delivered', { handoffId: handoff.id, durationMs }, requestId);
          results.push({ id: handoff.id, status: 'sent' });
        } else {
          const outcome = await markFailed(supabase, handoff.id, handoff.claim_token, 'telegram_send_failed', sla);
          if (!outcome.applied) {
            results.push({ id: handoff.id, status: 'stale' });
            continue;
          }
          emitEvent(
            outcome.escalated ? 'handoff_escalated' : 'handoff_failed',
            { handoffId: handoff.id, reason: 'telegram_send_failed' },
            requestId
          );
          logger.warn('Send failed', {
            handoffId: handoff.id,
            escalated: outcome.escalated,
            shouldRetry: outcome.shouldRetry,
            retryDelayMs: outcome.retryDelayMs,
          });
          results.push({
            id: handoff.id,
            status: outcome.escalated ? 'escalated' : outcome.shouldRetry ? 'retry_scheduled' : 'failed',
            escalated: outcome.escalated,
            retryDelayMs: outcome.retryDelayMs,
          });
        }
      } else {
        const outcome = await markFailed(supabase, handoff.id, handoff.claim_token, 'handoff_type_invalid', sla);
        if (!outcome.applied) {
          results.push({ id: handoff.id, status: 'stale' });
          continue;
        }
        emitEvent(
          outcome.escalated ? 'handoff_escalated' : 'handoff_failed',
          { handoffId: handoff.id, reason: 'handoff_type_invalid' },
          requestId
        );
        logger.warn('Unknown type', {
          handoffId: handoff.id,
          type: payload.type,
          escalated: outcome.escalated,
        });
        results.push({
          id: handoff.id,
          status: outcome.escalated ? 'escalated' : outcome.shouldRetry ? 'retry_scheduled' : 'failed',
          escalated: outcome.escalated,
          retryDelayMs: outcome.retryDelayMs,
        });
      }
    } catch (error) {
      const outcome = await markFailed(supabase, handoff.id, handoff.claim_token ?? '', 'handoff_processing_failed', sla);
      if (!outcome.applied) {
        results.push({ id: handoff.id, status: 'stale' });
        continue;
      }
      emitEvent(
        outcome.escalated ? 'handoff_escalated' : 'handoff_failed',
        { handoffId: handoff.id, reason: 'handoff_processing_failed' },
        requestId
      );
      logger.error('Error processing handoff', {
        handoffId: handoff.id,
        error: 'handoff_processing_failed',
        escalated: outcome.escalated,
      });
      results.push({
        id: handoff.id,
        status: outcome.escalated ? 'escalated' : outcome.shouldRetry ? 'retry_scheduled' : 'failed',
        escalated: outcome.escalated,
        retryDelayMs: outcome.retryDelayMs,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results
  });
}
