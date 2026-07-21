import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, readJsonBodyLimited } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { extractClientRequestId } from '@/lib/logger';
import { consumeRateLimit } from '@/lib/security/rate-limit';

const relayPayloadSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(4000)
});
const MAX_RELAY_BODY_BYTES = 8 * 1024;

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  const authResult = await requireSession(request);
  if (!authResult.ok) return authResult.response;
  try {
    const limit = await consumeRateLimit(`relay:${authResult.auth.capability}`, 30, 60 * 60);
    if (!limit.permitted) return jsonWithCors(
      { ok: false, code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }, request
    );
  } catch {
    return jsonWithCors({ ok: false, code: 'rate_limit_unavailable' }, { status: 503 }, request);
  }
  const body = await readJsonBodyLimited(request, MAX_RELAY_BODY_BYTES);
  if (!body.ok) return jsonWithCors(
    { ok: false, code: body.tooLarge ? 'payload_too_large' : 'invalid_json' },
    { status: body.tooLarge ? 413 : 400 }, request
  );
  const parsed = relayPayloadSchema.safeParse(body.data);
  if (!parsed.success) return jsonWithCors({ ok: false, error: 'Invalid request payload' }, { status: 400 }, request);
  const { sessionId, text } = parsed.data;
  if (sessionId !== authResult.auth.sessionId) {
    return jsonWithCors({ ok: false, error: 'Session mismatch' }, { status: 403 }, request);
  }
  const requestId = extractClientRequestId(request);
  if (!requestId) return jsonWithCors({ ok: false, error: 'request_id_required' }, { status: 400 }, request);

  const { data, error } = await authResult.supabase.rpc('relay_human_message', {
    p_session_id: sessionId,
    p_request_id: requestId,
    p_text: text
  });
  const result = Array.isArray(data) ? data[0] as {
    persisted?: boolean; consent_required?: boolean; handoff_id?: string | null;
  } : null;
  if (error || !result) return jsonWithCors({ ok: false, error: 'relay_persist_failed' }, { status: 500 }, request);
  if (result.consent_required) return jsonWithCors({ ok: false, code: 'consent_required' }, { status: 403 }, request);

  const dispatchSecret = process.env.INTERNAL_DISPATCH_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  let delivered = false;
  if (result.persisted === true && result.handoff_id && dispatchSecret) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      // The durable scheduler remains the recovery path; this removes its normal interactive delay.
      const dispatchResponse = await fetch(new URL('/api/internal/handoff-dispatch', request.url), {
        method: 'POST',
        headers: { Authorization: `Bearer ${dispatchSecret}` },
        signal: controller.signal
      });
      if (dispatchResponse.ok) {
        const dispatchResult = await dispatchResponse.json() as {
          results?: Array<{ id?: string; status?: string }>;
        };
        delivered = dispatchResult.results?.some(
          (entry) => entry.id === result.handoff_id && entry.status === 'sent'
        ) === true;
      }
    } catch {
      // The outbox row is already durable and will be retried by the scheduler.
    } finally {
      clearTimeout(timeout);
    }
  }

  return jsonWithCors({
    ok: result.persisted === true,
    persisted: result.persisted === true,
    queued: Boolean(result.handoff_id),
    delivered
  }, undefined, request);
}
