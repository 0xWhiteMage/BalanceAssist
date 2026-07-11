import { NextResponse } from 'next/server';
import { verifyCapability, extractSessionIdFromCapability } from '@/lib/security/session-capability';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

export type SessionAuth = {
  sessionId: string;
  capability: string;
};

export async function requireSession(request: Request): Promise<
  | { ok: true; auth: SessionAuth; supabase: ReturnType<typeof createServerSupabaseClient> }
  | { ok: false; response: NextResponse }
> {
  if (!hasSupabaseServerConfig()) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
    };
  }

  // Try capability header first
  const capabilityHeader = request.headers.get('x-session-capability');
  // Then cookie
  const cookieHeader = request.headers.get('cookie') ?? '';
  const capabilityCookie = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('session_capability='))
    ?.slice('session_capability='.length);

  const capability = capabilityHeader ?? capabilityCookie;

  if (!capability) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Session capability required' }, { status: 401 })
    };
  }

  const sessionId = extractSessionIdFromCapability(capability);
  if (!sessionId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid session capability' }, { status: 401 })
    };
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
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
      response: NextResponse.json({ error: 'Session not found' }, { status: 401 })
    };
  }

  const row = session as { capability_hash: string | null; capability_expires_at: string | null };

  if (!row.capability_hash || !row.capability_expires_at) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Session not authorized' }, { status: 401 })
    };
  }

  const valid = verifyCapability(capability, row.capability_hash, row.capability_expires_at);

  if (!valid) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid or expired session capability' }, { status: 401 })
    };
  }

  return { ok: true, auth: { sessionId, capability }, supabase };
}
