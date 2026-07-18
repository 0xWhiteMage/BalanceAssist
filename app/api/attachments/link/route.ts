import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, readJsonBodyLimited } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { normalizePublicReferenceUrl } from '@/lib/uploads/url-detect';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

const linkSchema = z.object({
  sessionId: z.string().min(1).optional(),
  url: z.string().url(),
  kind: z.enum(['youtube', 'vimeo', 'figma', 'loom', 'gdrive', 'other'])
});
const MAX_LINK_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  const authResult = await requireSession(request);
  if (!authResult.ok) return authResult.response;
  const body = await readJsonBodyLimited(request, MAX_LINK_BODY_BYTES);
  if (!body.ok) return jsonWithCors(
    { error: body.tooLarge ? 'Payload too large' : 'Invalid JSON body' },
    { status: body.tooLarge ? 413 : 400 },
    request
  );
  const parsed = linkSchema.safeParse(body.data);
  if (!parsed.success) return jsonWithCors({ error: 'Invalid request payload', issues: parsed.error.issues }, { status: 400 }, request);
  if (parsed.data.sessionId && parsed.data.sessionId !== authResult.auth.sessionId) {
    return jsonWithCors({ error: 'Session mismatch' }, { status: 403 }, request);
  }
  const normalizedUrl = normalizePublicReferenceUrl(parsed.data.url);
  if (!normalizedUrl) {
    return jsonWithCors({ ok: false, persisted: false, error: 'https_reference_required' }, { status: 400 }, request);
  }

  const { supabase, auth } = authResult;

  const sessionId = parsed.data.sessionId ?? auth.sessionId;
  const { data, error } = await supabase.from('reference_links').insert({
    session_id: sessionId,
    url: normalizedUrl,
    kind: parsed.data.kind
  }).select('id, url, kind').single();

  if (error) {
    return jsonWithCors({ ok: false, persisted: false, error: 'attachment_link_persist_failed' }, { status: 500 }, request);
  }

  if (!data?.id) {
    return jsonWithCors({ ok: false, persisted: false, error: 'attachment_link_persist_failed' }, { status: 500 }, request);
  }

  return jsonWithCors({
    ok: true,
    persisted: true,
    link: { id: data.id, sessionId, url: data.url, kind: data.kind }
  }, undefined, request);
}
