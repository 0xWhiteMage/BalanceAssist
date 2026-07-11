import { createSessionPayloadSchema } from '@/lib/api/contracts';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { generateCapability, hashCapability } from '@/lib/security/session-capability';

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, createSessionPayloadSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sourceUrl, referrer, utm } = parsed.data;

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
          status: 'open',
          capability_hash: hashCapability(capability.capability),
          capability_expires_at: capability.expiresAt
        })
        .select('id, status, source_url, created_at')
        .single();

      if (!error && data) {
        return jsonWithCors({
          sessionId: data.id,
          capability: capability.capability,
          expiresAt: capability.expiresAt,
          status: data.status,
          sourceUrl: data.source_url,
          createdAt: data.created_at,
          persisted: true
        });
      }

      console.error('[sessions] Failed to insert session into Supabase', {
        errorCode: error?.code,
        errorMessage: error?.message,
        errorDetails: error?.details,
        hint: error?.hint
      });
    } else {
      console.error('[sessions] Supabase client creation failed despite hasSupabaseServerConfig() returning true');
    }
  }

  const fallbackCapability = generateCapability(crypto.randomUUID());

  return jsonWithCors({
    sessionId: fallbackCapability.sessionId,
    capability: fallbackCapability.capability,
    expiresAt: fallbackCapability.expiresAt,
    status: 'open',
    sourceUrl,
    persisted: false
  });
}
