import { NextResponse } from 'next/server';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { claimNextHandoff, markDelivered, markFailed, reserveHandoffSend } from '@/lib/handoff/outbox';
import { createLogger, extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { sendTelegramMessage } from '@/lib/telegram';
import { getMaxRetries, type HandoffSLA } from '@/lib/handoff/sla';
import { validateAdminRequestAny } from '@/lib/security/config';

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

  for (let batch = 0; batch < 5; batch++) {
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

      if (!handoff.claim_token || !await reserveHandoffSend(supabase, handoff.id, handoff.claim_token)) {
        logger.info('Skipped stale handoff claim', { handoffId: handoff.id });
        results.push({ id: handoff.id, status: 'stale' });
        continue;
      }

      if (payload.type === 'approval' || payload.type === 'relay') {
        const result = await sendTelegramMessage(payload.summary, {
          threadId: payload.threadId ?? undefined
        });

        if (result) {
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
          const outcome = await markFailed(supabase, handoff.id, handoff.claim_token, 'Telegram send failed', sla);
          if (!outcome.applied) {
            results.push({ id: handoff.id, status: 'stale' });
            continue;
          }
          emitEvent(
            outcome.escalated ? 'handoff_escalated' : 'handoff_failed',
            { handoffId: handoff.id, reason: 'Telegram send failed' },
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
        const outcome = await markFailed(supabase, handoff.id, handoff.claim_token, `Unknown handoff type: ${payload.type}`, sla);
        if (!outcome.applied) {
          results.push({ id: handoff.id, status: 'stale' });
          continue;
        }
        emitEvent(
          outcome.escalated ? 'handoff_escalated' : 'handoff_failed',
          { handoffId: handoff.id, reason: `Unknown handoff type: ${payload.type}` },
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      const outcome = await markFailed(supabase, handoff.id, handoff.claim_token ?? '', message, sla);
      if (!outcome.applied) {
        results.push({ id: handoff.id, status: 'stale' });
        continue;
      }
      emitEvent(
        outcome.escalated ? 'handoff_escalated' : 'handoff_failed',
        { handoffId: handoff.id, reason: message },
        requestId
      );
      logger.error('Error processing handoff', {
        handoffId: handoff.id,
        error: message,
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
