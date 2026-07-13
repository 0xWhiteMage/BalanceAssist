import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { normalizeVersionedDraft } from '@/lib/conversation/draft-versioning';
import { getRecordedAttachmentConsent, recordAttachmentConsent } from '@/lib/uploads/consent';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

const linkSchema = z.object({
  sessionId: z.string().min(1).optional(),
  url: z.string().url(),
  kind: z.enum(['youtube', 'vimeo', 'figma', 'loom', 'gdrive', 'other']),
  consent: z
    .object({
      aiAnalysis: z.boolean(),
      producerShare: z.boolean(),
      consentedAt: z.string().datetime()
    })
    .optional()
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
  const { data: sessionRow, error: sessionError } = await supabase
    .from('sessions')
    .select('draft, draft_version')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionError) {
    return jsonWithCors({ ok: false, error: sessionError.message }, { status: 500 }, request);
  }

  if (!sessionRow) {
    return jsonWithCors({ ok: false, error: 'Session not found' }, { status: 404 }, request);
  }

  const row = sessionRow as { draft?: unknown; draft_version?: number | null };
  const currentDraft = normalizeVersionedDraft(row.draft);
  const nextDraft = recordAttachmentConsent(currentDraft, parsed.data.consent ?? null);

  if (JSON.stringify(nextDraft) !== JSON.stringify(currentDraft)) {
    const { error: updateError } = await supabase
      .from('sessions')
      .update({ draft: nextDraft, draft_version: (row.draft_version ?? 0) + 1 })
      .eq('id', sessionId);

    if (updateError) {
      return jsonWithCors({ ok: false, error: updateError.message }, { status: 500 }, request);
    }
  }

  const recordedConsent = getRecordedAttachmentConsent(nextDraft);

  if (!recordedConsent.producerShare) {
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
