import { NextResponse } from 'next/server';
import { createSessionPayloadSchema, MAX_SESSION_BODY_BYTES } from '@/lib/api/contracts';
import { corsOptionsResponse, jsonWithCors, readJsonBodyLimited } from '@/lib/api/route-helpers';
import { SESSION_CAPABILITY_COOKIE_NAME } from '@/lib/api/require-session';
import { createLogger, extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { generateCapability, hashCapability } from '@/lib/security/session-capability';
import { consumeRateLimit, getClientIpMaterial } from '@/lib/security/rate-limit';
import { temporaryDraftExpiry } from '@/lib/privacy/session-retention';
import { CONSENT_VERSION } from '@/lib/privacy/notice';

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
  const requestId = extractRequestId(request);
  const logger = createLogger('sessions', requestId);

  const clientIpMaterial = getClientIpMaterial(request);
  if (!clientIpMaterial) {
    logger.error('Session creation rate limit identity is unavailable');
    return jsonWithCors({ ok: false, code: 'session_rate_limit_identity_unavailable' }, { status: 503 }, request);
  }

  try {
    const limit = await consumeRateLimit(`session-create:${clientIpMaterial}`, SESSION_CREATION_LIMIT, SESSION_CREATION_WINDOW_SECONDS);
    if (!limit.permitted) {
      return jsonWithCors({ ok: false, code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }, request);
    }
  } catch {
    logger.error('Session creation rate limit is unavailable');
    return jsonWithCors({ ok: false, code: 'session_unavailable' }, { status: 503 }, request);
  }

  const body = await readJsonBodyLimited(request, MAX_SESSION_BODY_BYTES);
  if (!body.ok) {
    if (body.tooLarge) {
      return jsonWithCors({ ok: false, code: 'payload_too_large' }, { status: 413 }, request);
    }
    return jsonWithCors({ error: 'Invalid JSON body' }, { status: 400 }, request);
  }

  const parsed = createSessionPayloadSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonWithCors({ error: 'Invalid request payload', issues: parsed.error.issues }, { status: 400 }, request);
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
  const activityAt = new Date();
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
        capability_expires_at: capability.expiresAt,
        last_activity_at: activityAt.toISOString(),
        draft_expires_at: temporaryDraftExpiry(activityAt).toISOString()
      })
      .select('id, status, source_url, created_at')
      .single();

    if (error || !data || data.id !== sessionId) {
      logger.error('Failed to persist session', { errorCode: error?.code });
      return jsonWithCors({ ok: false, code: 'session_unavailable' }, { status: 503 }, request);
    }

    if (consentVersion === CONSENT_VERSION) {
      const { error: consentError } = await supabase.rpc('record_session_consent', {
        p_session_id: sessionId,
        p_scope: 'analysis',
        p_granted: true,
        p_notice_version: consentVersion
      });
      if (consentError) {
        await supabase.from('sessions').delete().eq('id', sessionId);
        logger.error('Failed to persist analysis consent');
        return jsonWithCors({ ok: false, code: 'session_unavailable' }, { status: 503 }, request);
      }
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
