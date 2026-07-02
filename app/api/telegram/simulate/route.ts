import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

const simulatePayloadSchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(4000),
  senderName: z.string().optional()
});

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    return jsonWithCors({ error: 'Not available in production' }, { status: 404 });
  }

  const parsed = await parseRequestBody(request, simulatePayloadSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { sessionId, text, senderName } = parsed.data;

  if (!hasSupabaseServerConfig()) {
    return jsonWithCors({ error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();

  if (!supabase) {
    return jsonWithCors({ error: 'Supabase client failed' }, { status: 503 });
  }

  const prefix = senderName ? `${senderName}: ` : '';
  const { error } = await supabase.from('human_messages').insert({
    session_id: sessionId,
    sender: 'team',
    text: `${prefix}${text}`
  });

  if (error) {
    return jsonWithCors({ error: error.message }, { status: 500 });
  }

  return jsonWithCors({ ok: true });
}