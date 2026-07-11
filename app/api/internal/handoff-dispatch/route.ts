import { NextResponse } from 'next/server';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { getPendingHandoffs, markDelivered, markFailed } from '@/lib/handoff/outbox';
import { sendTelegramMessage } from '@/lib/telegram';
import { getMaxRetries, shouldEscalate, type HandoffSLA } from '@/lib/handoff/sla';

export async function POST(request: Request) {
  // Basic auth check — only internal callers should hit this
  const authHeader = request.headers.get('authorization');
  const internalSecret = process.env.INTERNAL_DISPATCH_SECRET;

  if (internalSecret) {
    const provided = authHeader?.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7)
      : authHeader;
    if (provided !== internalSecret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
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
    retryBackoffMs: [1000, 5000, 15000],
    escalationThresholdMs: 300_000,
  };

  const pending = await getPendingHandoffs(supabase, 5);
  const results: Array<{ id: string; status: string; escalated?: boolean; retryDelayMs?: number }> = [];

  for (const handoff of pending) {
    try {
      const { payload } = handoff;

      if (payload.type === 'approval' || payload.type === 'relay') {
        const result = await sendTelegramMessage(payload.summary, {
          threadId: payload.threadId ?? undefined
        });

        if (result) {
          await markDelivered(supabase, handoff.id);
          results.push({ id: handoff.id, status: 'sent' });
        } else {
          const outcome = await markFailed(supabase, handoff.id, 'Telegram send failed', sla);
          console.warn('[handoff-dispatch] Send failed', {
            handoffId: handoff.id,
            escalated: outcome.escalated,
            shouldRetry: outcome.shouldRetry,
            retryDelayMs: outcome.retryDelayMs,
          });
          results.push({
            id: handoff.id,
            status: outcome.escalated ? 'escalated' : 'failed',
            escalated: outcome.escalated,
            retryDelayMs: outcome.retryDelayMs,
          });
        }
      } else {
        const outcome = await markFailed(supabase, handoff.id, `Unknown handoff type: ${payload.type}`, sla);
        console.warn('[handoff-dispatch] Unknown type', {
          handoffId: handoff.id,
          type: payload.type,
          escalated: outcome.escalated,
        });
        results.push({
          id: handoff.id,
          status: outcome.escalated ? 'escalated' : 'failed',
          escalated: outcome.escalated,
          retryDelayMs: outcome.retryDelayMs,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const outcome = await markFailed(supabase, handoff.id, message, sla);
      console.error('[handoff-dispatch] Error processing handoff', {
        handoffId: handoff.id,
        error: message,
        escalated: outcome.escalated,
      });
      results.push({
        id: handoff.id,
        status: outcome.escalated ? 'escalated' : 'failed',
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
