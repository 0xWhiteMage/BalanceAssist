import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { getSessionConsent } from '@/lib/privacy/session-consent';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

const linkSchema = z.object({
  sessionId: z.string().min(1).optional(),
  url: z.string().url(),
  kind: z.enum(['youtube', 'vimeo', 'figma', 'loom', 'gdrive', 'other']),
  consent: z.unknown().optional()
});

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, linkSchema);
  if (!parsed.ok) return parsed.response;

  const authResult = await requireSession(request, parsed.data.sessionId ?? undefined);
  if (!authResult.ok) {
    return authResult.response;
  }

  const { supabase, auth } = authResult;

  const sessionId = parsed.data.sessionId ?? auth.sessionId;
  let consent;
  try {
    consent = await getSessionConsent(supabase as never, sessionId);
  } catch {
    return jsonWithCors({ ok: false, error: 'Consent ledger unavailable' }, { status: 500 }, request);
  }

  if (!consent.producerTransfer) {
    return jsonWithCors(
      { ok: false, error: 'Consent to let the Balance team review this link is required before adding it.' },
      { status: 403 },
      request
    );
  }

  const { error } = await supabase.from('reference_links').insert({
    session_id: sessionId,
    url: parsed.data.url,
    kind: parsed.data.kind
  });

  if (error) {
    return jsonWithCors({ ok: false, persisted: false, error: error.message }, { status: 500 }, request);
  }

  return jsonWithCors({ ok: true, persisted: true }, undefined, request);
}
