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

const CLAIM_LEASE_MS = 60_000;

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
  const deliveredAt = new Date().toISOString();
  await supabase
    .from('handoff_outbox')
    .update({ state: 'sent', updated_at: deliveredAt, next_attempt_at: deliveredAt, claim_expires_at: null })
    .eq('id', handoffId);
}

export async function markFailed(
  supabase: SupabaseServerClient,
  handoffId: string,
  error: string,
  sla?: HandoffSLA
): Promise<{ shouldRetry: boolean; escalated: boolean; retryDelayMs: number }> {
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

  await supabase
    .from('handoff_outbox')
    .update({
      state: escalated ? 'escalated' : shouldRetry ? 'pending' : 'failed',
      last_error: error,
      attempts: currentAttempts,
      updated_at: now.toISOString(),
      next_attempt_at: nextAttemptAt,
      claim_expires_at: null
    })
    .eq('id', handoffId);

  return { shouldRetry, escalated, retryDelayMs };
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
): Promise<{ id: string; session_id: string; payload: HandoffPayload; created_at?: string } | null> {
  const now = new Date();
  const nowIso = now.toISOString();
  const claimExpiresAt = new Date(now.getTime() + CLAIM_LEASE_MS).toISOString();

  const tryClaim = async (
    row: { id: string; session_id: string; payload: HandoffPayload; created_at?: string } | null,
    expectedState: 'pending' | 'claiming',
    expiryColumn: 'next_attempt_at' | 'claim_expires_at'
  ): Promise<{ id: string; session_id: string; payload: HandoffPayload; created_at?: string } | null> => {
    if (!row) return null;

    let query = supabase
      .from('handoff_outbox')
      .update({ state: 'claiming', updated_at: nowIso, claim_expires_at: claimExpiresAt })
      .eq('id', row.id)
      .eq('state', expectedState)
      .lte(expiryColumn, nowIso)
      .select('id, session_id, payload, created_at');

    const { data, error } = await query.maybeSingle();

    if (error || !data) {
      return null;
    }

    return data as { id: string; session_id: string; payload: HandoffPayload; created_at?: string };
  };

  const { data: expiredClaims } = await supabase
    .from('handoff_outbox')
    .select('id, session_id, payload, created_at')
    .eq('state', 'claiming')
    .lte('claim_expires_at', nowIso)
    .order('claim_expires_at', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1)

  const reclaimed = await tryClaim(
    ((expiredClaims ?? [])[0] as { id: string; session_id: string; payload: HandoffPayload; created_at?: string } | undefined) ?? null,
    'claiming',
    'claim_expires_at'
  );

  if (reclaimed) {
    return reclaimed;
  }

  const { data: pendingRows } = await supabase
    .from('handoff_outbox')
    .select('id, session_id, payload, created_at')
    .eq('state', 'pending')
    .lte('next_attempt_at', nowIso)
    .order('next_attempt_at', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(1);

  return tryClaim(
    ((pendingRows ?? [])[0] as { id: string; session_id: string; payload: HandoffPayload; created_at?: string } | undefined) ?? null,
    'pending',
    'next_attempt_at'
  );
}

export async function authorizeHandoffSend(
  supabase: SupabaseServerClient,
  handoffId: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('authorize_handoff_send', { p_handoff_id: handoffId });
  return !error && data === true;
}

export async function suppressHandoff(
  supabase: SupabaseServerClient,
  handoffId: string
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('handoff_outbox')
    .update({ state: 'failed', last_error: 'session_unavailable', updated_at: now, claim_expires_at: null })
    .eq('id', handoffId)
    .eq('state', 'claiming');
}

export async function releaseClaim(
  supabase: SupabaseServerClient,
  handoffId: string,
  finalState: 'pending' | 'sent' | 'failed' | 'escalated'
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('handoff_outbox')
    .update({ state: finalState, updated_at: now, claim_expires_at: null })
    .eq('id', handoffId)
    .eq('state', 'claiming');
}
