import { createHash } from 'crypto';
import type { SupabaseServerClient } from '@/lib/supabase/server';
import { getMaxRetries, getRetryDelay, shouldEscalate, type HandoffSLA } from '@/lib/handoff/sla';

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

export type HandoffFailureCode =
  | 'handoff_processing_failed'
  | 'handoff_type_invalid'
  | 'producer_transfer_revoked'
  | 'telegram_send_failed';

function normalizeFailureCode(value: string): HandoffFailureCode {
  return value === 'handoff_type_invalid' || value === 'producer_transfer_revoked' || value === 'telegram_send_failed'
    ? value
    : 'handoff_processing_failed';
}

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
    .select('id, state, attempts')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; state: string; attempts?: number | null };
    return {
      persisted: true,
      queued: row.state === 'pending',
      delivered: row.state === 'sent',
      retryable: row.state === 'pending' && (row.attempts ?? 0) > 0,
      handoffId: row.id
    };
  }

  const queuedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('handoff_outbox')
    .insert({
      session_id: payload.sessionId,
      payload: payload as unknown as Record<string, unknown>,
      state: 'pending',
      idempotency_key: idempotencyKey,
      next_attempt_at: queuedAt,
      claim_expires_at: null
    })
    .select('id')
    .single();

  if (error) {
    console.error('[handoff] Failed to enqueue', {
      sessionId: payload.sessionId,
      error: 'handoff_enqueue_failed'
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
  handoffId: string,
  claimToken: string
): Promise<boolean> {
  const deliveredAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('handoff_outbox')
    .update({ state: 'sent', updated_at: deliveredAt, next_attempt_at: deliveredAt, claim_expires_at: null })
    .eq('id', handoffId)
    .eq('state', 'sending')
    .eq('claim_token', claimToken)
    .select('id')
    .maybeSingle();
  return !error && Boolean(data);
}

export async function markFailed(
  supabase: SupabaseServerClient,
  handoffId: string,
  claimToken: string,
  error: HandoffFailureCode | string,
  sla?: HandoffSLA
): Promise<{ shouldRetry: boolean; escalated: boolean; retryDelayMs: number; applied: boolean }> {
  const maxRetries = getMaxRetries(sla);

  const { data: row } = await supabase
    .from('handoff_outbox')
    .select('attempts, created_at')
    .eq('id', handoffId)
    .maybeSingle();

  const currentAttempts = ((row as { attempts: number } | null)?.attempts ?? 0) + 1;
  const createdAt = (row as { created_at: string } | null)?.created_at ?? new Date().toISOString();
  const escalated = shouldEscalate(createdAt, sla);
  const shouldRetry = !escalated && currentAttempts < maxRetries;
  const retryDelayMs = shouldRetry ? getRetryDelay(currentAttempts - 1, sla) : 0;
  const now = new Date();
  const nextAttemptAt = shouldRetry
    ? new Date(now.getTime() + retryDelayMs).toISOString()
    : now.toISOString();

  const { data, error: updateError } = await supabase
    .from('handoff_outbox')
    .update({
      state: escalated ? 'escalated' : shouldRetry ? 'pending' : 'failed',
      last_error: normalizeFailureCode(error),
      attempts: currentAttempts,
      updated_at: now.toISOString(),
      next_attempt_at: nextAttemptAt,
      claim_expires_at: null
    })
    .eq('id', handoffId)
    .eq('state', 'sending')
    .eq('claim_token', claimToken)
    .select('id')
    .maybeSingle();

  return { shouldRetry, escalated, retryDelayMs, applied: !updateError && Boolean(data) };
}

export async function getPendingHandoffs(
  supabase: SupabaseServerClient,
  limit = 10
): Promise<Array<{ id: string; session_id: string; payload: HandoffPayload }>> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from('handoff_outbox')
    .select('id, session_id, payload')
    .eq('state', 'pending')
    .lte('next_attempt_at', now)
    .order('next_attempt_at', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit);

  return (data ?? []) as Array<{ id: string; session_id: string; payload: HandoffPayload }>;
}

export async function claimNextHandoff(
  supabase: SupabaseServerClient
): Promise<{ id: string; session_id: string; payload: HandoffPayload; created_at?: string; claim_token: string | null; resolution: 'claimed' | 'suppressed' } | null> {
  const { data, error } = await supabase.rpc('claim_next_handoff');
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return data[0] as { id: string; session_id: string; payload: HandoffPayload; created_at?: string; claim_token: string | null; resolution: 'claimed' | 'suppressed' };
}

export async function reserveHandoffSend(supabase: SupabaseServerClient, handoffId: string, claimToken: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('reserve_handoff_send', { p_handoff_id: handoffId, p_claim_token: claimToken });
  return !error && data === true;
}

export async function releaseClaim(
  supabase: SupabaseServerClient,
  handoffId: string,
  claimToken: string,
  finalState: 'pending' | 'sent' | 'failed' | 'escalated'
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('handoff_outbox')
    .update({ state: finalState, updated_at: now, claim_expires_at: null })
    .eq('id', handoffId)
    .eq('state', 'sending')
    .eq('claim_token', claimToken)
    .select('id')
    .maybeSingle();
  return !error && Boolean(data);
}
