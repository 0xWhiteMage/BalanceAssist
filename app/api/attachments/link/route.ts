import { NextResponse } from 'next/server';
import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

export async function OPTIONS() {
  return corsOptionsResponse();
}

const linkSchema = z.object({
  sessionId: z.string().min(1).optional(),
  url: z.string().url(),
  kind: z.enum(['youtube', 'vimeo', 'figma', 'loom', 'gdrive', 'other'])
});

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, linkSchema);
  if (!parsed.ok) return parsed.response;

  if (!hasSupabaseServerConfig()) {
    return jsonWithCors({ ok: true, persisted: false, reason: 'Supabase not configured.' });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) return jsonWithCors({ ok: true, persisted: false, reason: 'Supabase client failed.' });

  const { error } = await supabase.from('reference_links').insert({
    session_id: parsed.data.sessionId ?? null,
    url: parsed.data.url,
    kind: parsed.data.kind
  });

  if (error) {
    return jsonWithCors({ ok: true, persisted: false, reason: error.message });
  }

  return jsonWithCors({ ok: true, persisted: true });
}