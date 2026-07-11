import { createHash } from 'crypto';
import { createServerSupabaseClient, type SupabaseServerClient } from '@/lib/supabase/server';

export type HandoffOutcome = {
  persisted: boolean;
  queued: boolean;
  delivered: boolean;
  retryable: boolean;
  handoffId?: string;
};

export type HandoffPayload = {
  sessionId: string;
  type: 'approval' | 'relay';
  summary: string;
  threadId?: number | null;
};

export function generateIdempotencyKey(sessionId: string, type: string, summary: string): string {
  const hash = createHash('sha256')
    .update(`${sessionId}:${type}:${summary}`)
    .digest('hex')
    .slice(0, 16);
  return `ho_${hash}`;
}

export async function enqueueHandoff(
  supabase: SupabaseServerClient,
  payload: HandoffPayload
): Promise<HandoffOutcome> {
  const idempotencyKey = generateIdempotencyKey(
    payload.sessionId,
    payload.type,
    payload.summary
  );

  const { data: existing } = await supabase
    .from('handoff_outbox')
    .select('id, state')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; state: string };
    return {
      persisted: true,
      queued: row.state === 'pending',
      delivered: row.state === 'sent',
      retryable: row.state === 'failed',
      handoffId: row.id
    };
  }

  const { data, error } = await supabase
    .from('handoff_outbox')
    .insert({
      session_id: payload.sessionId,
      payload: payload as unknown as Record<string, unknown>,
      state: 'pending',
      idempotency_key: idempotencyKey
    })
    .select('id')
    .single();

  if (error) {
    console.error('[handoff] Failed to enqueue', {
      sessionId: payload.sessionId,
      error: error.message
    });
    return {
      persisted: false,
      queued: false,
      delivered: false,
      retryable: false
    };
  }

  return {
    persisted: true,
    queued: true,
    delivered: false,
    retryable: false,
    handoffId: (data as { id: string }).id
  };
}

export async function markDelivered(
  supabase: SupabaseServerClient,
  handoffId: string
): Promise<void> {
  await supabase
    .from('handoff_outbox')
    .update({ state: 'sent', updated_at: new Date().toISOString() })
    .eq('id', handoffId);
}

export async function markFailed(
  supabase: SupabaseServerClient,
  handoffId: string,
  error: string
): Promise<void> {
  await supabase
    .from('handoff_outbox')
    .update({
      state: 'failed',
      last_error: error,
      attempts: supabase.rpc ? undefined : undefined, // will use raw increment
      updated_at: new Date().toISOString()
    })
    .eq('id', handoffId);

  // Increment attempts
  const { data: row } = await supabase
    .from('handoff_outbox')
    .select('attempts')
    .eq('id', handoffId)
    .maybeSingle();

  if (row) {
    await supabase
      .from('handoff_outbox')
      .update({ attempts: ((row as { attempts: number }).attempts ?? 0) + 1 })
      .eq('id', handoffId);
  }
}

export async function getPendingHandoffs(
  supabase: SupabaseServerClient,
  limit = 10
): Promise<Array<{ id: string; session_id: string; payload: HandoffPayload }>> {
  const { data } = await supabase
    .from('handoff_outbox')
    .select('id, session_id, payload')
    .eq('state', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  return (data ?? []) as Array<{ id: string; session_id: string; payload: HandoffPayload }>;
}
