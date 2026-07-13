import { NextResponse } from 'next/server';
import { createSessionPayloadSchema } from '@/lib/api/contracts';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { SESSION_CAPABILITY_COOKIE_NAME } from '@/lib/api/require-session';
import { createLogger, extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { generateCapability, hashCapability } from '@/lib/security/session-capability';

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

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sourceUrl, referrer, utm, consentVersion, consentedAt } = parsed.data;

  if (hasSupabaseServerConfig()) {
    const supabase = createServerSupabaseClient();

    if (supabase) {
      const capability = generateCapability(crypto.randomUUID());

      const { data, error } = await supabase
        .from('sessions')
        .insert({
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

      if (!error && data) {
        emitEvent('consent_granted', { sessionId: data.id, consentVersion }, requestId);
        emitEvent('capability_issued', { sessionId: data.id }, requestId);
        return setSessionCapabilityCookie(jsonWithCors({
          sessionId: data.id,
          expiresAt: capability.expiresAt,
          status: data.status,
          sourceUrl: data.source_url,
          createdAt: data.created_at,
          persisted: true
        }, undefined, request), request, capability.capability, capability.expiresAt);
      }

      logger.error('Failed to insert session into Supabase', {
        errorCode: error?.code,
        errorMessage: error?.message,
        errorDetails: error?.details,
        hint: error?.hint
      });
    } else {
      logger.error('Supabase client creation failed despite hasSupabaseServerConfig() returning true');
    }
  }

  const fallbackCapability = generateCapability(crypto.randomUUID());

  return setSessionCapabilityCookie(jsonWithCors({
    sessionId: fallbackCapability.sessionId,
    expiresAt: fallbackCapability.expiresAt,
    status: 'open',
    sourceUrl,
    persisted: false
  }, undefined, request), request, fallbackCapability.capability, fallbackCapability.expiresAt);
}
