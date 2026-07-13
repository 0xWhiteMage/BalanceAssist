import { NextResponse } from 'next/server';
import { createSessionPayloadSchema } from '@/lib/api/contracts';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { SESSION_CAPABILITY_COOKIE_NAME } from '@/lib/api/require-session';
import { createLogger, extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { generateCapability, hashCapability } from '@/lib/security/session-capability';
import { consumeRateLimit, getClientIpMaterial } from '@/lib/security/rate-limit';

const SESSION_CREATION_LIMIT = 10;
const SESSION_CREATION_WINDOW_SECONDS = 60 * 60;

function setSessionCapabilityCookie(response: NextResponse, request: Request, capability: string, expiresAt: string) {
  const url = new URL(request.url);
  const isSecure = url.protocol === 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1';

  response.cookies.set({
    name: SESSION_CAPABILITY_COOKIE_NAME,
    value: capability,
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure,
    path: '/',
    expires: new Date(expiresAt)
  });

  return response;
}

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, createSessionPayloadSchema);
  const requestId = extractRequestId(request);
  const logger = createLogger('sessions', requestId);

  try {
    const limit = await consumeRateLimit(`session-create:${getClientIpMaterial(request)}`, SESSION_CREATION_LIMIT, SESSION_CREATION_WINDOW_SECONDS);
    if (!limit.permitted) {
      return jsonWithCors({ ok: false, code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }, request);
    }
  } catch {
    logger.error('Session creation rate limit is unavailable');
    return jsonWithCors({ ok: false, code: 'session_unavailable' }, { status: 503 }, request);
  }

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sourceUrl, referrer, utm, consentVersion, consentedAt } = parsed.data;

  if (!hasSupabaseServerConfig()) {
    logger.error('Supabase server configuration is unavailable');
    return jsonWithCors({ ok: false, code: 'session_unavailable' }, { status: 503 }, request);
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    logger.error('Supabase client creation failed despite configured server credentials');
    return jsonWithCors({ ok: false, code: 'session_unavailable' }, { status: 503 }, request);
  }

  const sessionId = crypto.randomUUID();
  const capability = generateCapability(sessionId);
  try {
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        id: sessionId,
        source_url: sourceUrl,
        referrer: referrer ?? null,
        utm: utm ?? null,
        consent_version: consentVersion ?? null,
        consented_at: consentedAt ?? null,
        status: 'open',
        capability_hash: hashCapability(capability.capability),
        capability_expires_at: capability.expiresAt
      })
      .select('id, status, source_url, created_at')
      .single();

    if (error || !data || data.id !== sessionId) {
      logger.error('Failed to persist session', { errorCode: error?.code });
      return jsonWithCors({ ok: false, code: 'session_unavailable' }, { status: 503 }, request);
    }

    emitEvent('consent_granted', { sessionId, consentVersion }, requestId);
    emitEvent('capability_issued', { sessionId }, requestId);
    return setSessionCapabilityCookie(jsonWithCors({
      sessionId,
      expiresAt: capability.expiresAt,
      status: data.status,
      sourceUrl: data.source_url,
      createdAt: data.created_at,
      persisted: true
    }, undefined, request), request, capability.capability, capability.expiresAt);
  } catch {
    logger.error('Session persistence request threw');
    return jsonWithCors({ ok: false, code: 'session_unavailable' }, { status: 503 }, request);
  }
}
