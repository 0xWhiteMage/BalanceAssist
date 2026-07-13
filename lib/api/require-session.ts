import { NextResponse } from 'next/server';
import { verifyCapability, extractSessionIdFromCapability } from '@/lib/security/session-capability';
import { isAllowedOrigin } from '@/lib/security/origin';
import { jsonWithCors } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

export type SessionAuth = {
  sessionId: string;
  capability: string;
};

export const SESSION_CAPABILITY_COOKIE_NAME = 'session_capability';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function requireSession(request: Request, expectedSessionId?: string | null): Promise<
  | { ok: true; auth: SessionAuth; supabase: NonNullable<ReturnType<typeof createServerSupabaseClient>> }
  | { ok: false; response: NextResponse }
> {
  if (!hasSupabaseServerConfig()) {
    return {
      ok: false,
      response: jsonWithCors({ error: 'Service unavailable' }, { status: 503 }, request)
    };
  }

  if (STATE_CHANGING_METHODS.has(request.method.toUpperCase())) {
    const origin = request.headers.get('origin');
    if (!isAllowedOrigin(origin)) {
      return {
        ok: false,
        response: jsonWithCors({ error: 'Untrusted origin' }, { status: 403 }, request)
      };
    }
  }

  // Try capability header first
  const capabilityHeader = request.headers.get('x-session-capability');
  // Then cookie
  const cookieHeader = request.headers.get('cookie') ?? '';
  const capabilityCookie = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${SESSION_CAPABILITY_COOKIE_NAME}=`))
    ?.slice(`${SESSION_CAPABILITY_COOKIE_NAME}=`.length);

  const capability = capabilityHeader ?? capabilityCookie;

  if (!capability) {
    return {
      ok: false,
      response: jsonWithCors({ error: 'Session capability required' }, { status: 401 }, request)
    };
  }

  const sessionId = extractSessionIdFromCapability(capability);
  if (!sessionId) {
    return {
      ok: false,
      response: jsonWithCors({ error: 'Invalid session capability' }, { status: 401 }, request)
    };
  }

  if (expectedSessionId && expectedSessionId !== sessionId) {
    return {
      ok: false,
      response: jsonWithCors({ error: 'Session mismatch' }, { status: 403 }, request)
    };
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return {
      ok: false,
      response: jsonWithCors({ error: 'Service unavailable' }, { status: 503 }, request)
    };
  }

  const { data: session, error } = await supabase
    .from('sessions')
    .select('capability_hash, capability_expires_at')
    .eq('id', sessionId)
    .maybeSingle();

  if (error || !session) {
    return {
      ok: false,
      response: jsonWithCors({ error: 'Session not found' }, { status: 401 }, request)
    };
  }

  const row = session as { capability_hash: string | null; capability_expires_at: string | null };

  if (!row.capability_hash || !row.capability_expires_at) {
    return {
      ok: false,
      response: jsonWithCors({ error: 'Session not authorized' }, { status: 401 }, request)
    };
  }

  const valid = verifyCapability(capability, row.capability_hash, row.capability_expires_at);

  if (!valid) {
    return {
      ok: false,
      response: jsonWithCors({ error: 'Invalid or expired session capability' }, { status: 401 }, request)
    };
  }

  return { ok: true, auth: { sessionId, capability }, supabase };
}
