import { eventPayloadSchema } from '@/lib/api/contracts';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, eventPayloadSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sessionId, eventName, properties } = parsed.data;

  if (hasSupabaseServerConfig()) {
    const supabase = createServerSupabaseClient();

    if (supabase) {
      const { error } = await supabase
        .from('events')
        .insert({ session_id: sessionId, event_name: eventName, properties: properties ?? null });

      if (!error) {
        return jsonWithCors({ ok: true, eventName });
      }
    }
  }

  return jsonWithCors({ ok: true, eventName });
}