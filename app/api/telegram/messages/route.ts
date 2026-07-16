import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';

const querySchema = z.object({
  sessionId: z.string().min(1),
  sinceId: z.coerce.number().int().nonnegative().optional()
});

type RelayOutboxProjection = {
  state?: string;
  payload?: Record<string, unknown> | null;
};

function sanitizeReply(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 4000)
    : '';
}

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    sessionId: url.searchParams.get('sessionId'),
    sinceId: url.searchParams.get('sinceId') ?? undefined
  });

  if (!parsed.success) {
    return jsonWithCors({ error: 'Invalid query', issues: parsed.error.issues }, { status: 400 }, request);
  }

  const { sessionId, sinceId } = parsed.data;
  const authResult = await requireSession(request, sessionId);

  if (!authResult.ok) {
    return authResult.response;
  }

  const { supabase } = authResult;

  let query = supabase
    .from('human_messages')
    .select('id, sender, text, created_at')
    .eq('session_id', sessionId)
    .eq('sender', 'team')
    .order('id', { ascending: true })
    .limit(100);

  if (sinceId !== undefined) {
    query = query.gt('id', sinceId);
  }

  const { data, error } = await query;

  if (error) {
    return jsonWithCors({ error: 'relay_status_unavailable' }, { status: 503 }, request);
  }

  const { data: sessionRow, error: sessionError } = await supabase
    .from('sessions')
    .select('file_request_open, file_request_note, schedule_request_open')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionError) {
    return jsonWithCors({ error: 'relay_status_unavailable' }, { status: 503 }, request);
  }

  const { data: relayOutbox, error: relayOutboxError } = await supabase
    .from('handoff_outbox')
    .select('state, payload')
    .eq('session_id', sessionId)
    .contains('payload', { type: 'relay' })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (relayOutboxError) {
    return jsonWithCors({ error: 'relay_status_unavailable' }, { status: 503 }, request);
  }

  const sessionState = sessionRow as {
    file_request_open?: boolean;
    file_request_note?: string | null;
    schedule_request_open?: boolean;
  } | null;
  const persistedRelay = relayOutbox as RelayOutboxProjection | null;
  const hasPersistedReceipt =
    typeof persistedRelay?.payload?.telegramMessageId === 'number' &&
    typeof persistedRelay.payload.telegramThreadId === 'number';
  const outgoingStatus = !persistedRelay
    ? null
    : persistedRelay.state === 'sent' || hasPersistedReceipt
      ? 'delivered' as const
      : persistedRelay.state === 'failed' || persistedRelay.state === 'escalated'
        ? 'unavailable' as const
      : 'queued' as const;

  return jsonWithCors({
    outgoingStatus,
    fileRequestOpen: Boolean(sessionState?.file_request_open),
    fileRequestNote: sessionState?.file_request_note ?? null,
    scheduleRequestOpen: Boolean(sessionState?.schedule_request_open),
    messages: (data ?? []).map((row) => ({
      id: Number(row.id),
      sender: row.sender,
      text: sanitizeReply(row.text),
      createdAt: row.created_at
    }))
  }, undefined, request);
}
