import { createHash } from 'crypto';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type RateLimitResult = {
  permitted: boolean;
  retryAfterSeconds: number;
};

export function hashRateLimitKey(material: string): string {
  return createHash('sha256').update(material).digest('hex');
}

export function getClientIpMaterial(request: Request): string | null {
  const trustedHeader = process.env.TRUSTED_CLIENT_IP_HEADER?.toLowerCase();
  if (trustedHeader === 'x-vercel-forwarded-for') {
    return request.headers.get(trustedHeader)?.trim() || null;
  }

  // Never accept client-controlled forwarding headers without an explicit deployment guarantee.
  return null;
}

export async function consumeRateLimit(
  material: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    throw new Error('rate limit database unavailable');
  }

  const { data, error } = await supabase.rpc('consume_api_rate_limit', {
    p_key_hash: hashRateLimitKey(material),
    p_limit: limit,
    p_window_seconds: windowSeconds
  });
  const row = Array.isArray(data) ? data[0] : data;

  if (error || !row || typeof row.permitted !== 'boolean' || typeof row.retry_after_seconds !== 'number') {
    throw new Error('rate limit database unavailable');
  }

  return { permitted: row.permitted, retryAfterSeconds: Math.max(0, Math.ceil(row.retry_after_seconds)) };
}
