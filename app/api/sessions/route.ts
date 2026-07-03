import { createSessionPayloadSchema } from '@/lib/api/contracts';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

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
      const { data, error } = await supabase
        .from('sessions')
        .insert({ source_url: sourceUrl, referrer: referrer ?? null, utm: utm ?? null, status: 'open' })
        .select('id, status, source_url, created_at')
        .single();

      if (!error && data) {
        return jsonWithCors({
          sessionId: data.id,
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

  return jsonWithCors({
    sessionId: crypto.randomUUID(),
    status: 'open',
    sourceUrl,
    persisted: false
  });
}