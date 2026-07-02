import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

const querySchema = z.object({
  sessionId: z.string().min(1),
  sinceId: z.coerce.number().int().nonnegative().optional()
});

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    sessionId: url.searchParams.get('sessionId'),
    sinceId: url.searchParams.get('sinceId') ?? undefined
  });

  if (!parsed.success) {
    return jsonWithCors({ error: 'Invalid query', issues: parsed.error.issues }, { status: 400 });
  }

  const { sessionId, sinceId } = parsed.data;

  if (!hasSupabaseServerConfig()) {
    return jsonWithCors({ messages: [] });
  }

  const supabase = createServerSupabaseClient();

  if (!supabase) {
    return jsonWithCors({ messages: [] });
  }

  let query = supabase
    .from('human_messages')
    .select('id, sender, text, created_at')
    .eq('session_id', sessionId)
    .eq('sender', 'team')
    .order('id', { ascending: true })
    .limit(100);

  if (sinceId !== undefined) {
    query = query.gt('id', sinceId);
  }

  const { data, error } = await query;

  if (error) {
    return jsonWithCors({ messages: [] });
  }

  return jsonWithCors({
    messages: (data ?? []).map((row) => ({
      id: Number(row.id),
      sender: row.sender,
      text: row.text,
      createdAt: row.created_at
    }))
  });
}