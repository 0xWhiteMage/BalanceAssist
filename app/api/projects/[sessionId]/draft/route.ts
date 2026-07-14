import { z } from 'zod';
import { jsonWithCors } from '@/lib/api/route-helpers';
import { clearField, normalizeVersionedDraft, updateField, type VersionedDraft } from '@/lib/conversation/draft-versioning';
import { requireSession } from '@/lib/api/require-session';
import { extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { temporaryDraftExpiry } from '@/lib/privacy/session-retention';

const updateFieldSchema = z.object({
  field: z.string().min(1).max(100),
  value: z.string().max(500),
  provenance: z.enum(['user-stated', 'inferred', 'confirmed', 'cleared'] as const)
});

const updateDraftSchema = z.object({
  expectedDraftVersion: z.number().int().min(0).optional(),
  fields: z.array(updateFieldSchema).min(1).max(20)
});

type SessionDraftRow = {
  draft: unknown;
  draft_version: number | null;
};

async function loadSessionDraft(supabase: { from: (table: string) => { select: (query: string) => { eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }> } } } }, sessionId: string) {
  const { data, error } = await supabase
    .from('sessions')
    .select('draft, draft_version')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    return { error: 'project_draft_load_failed', draft: {} as VersionedDraft, draftVersion: 0 };
  }

  if (!data) {
    return { error: 'Session not found', draft: {} as VersionedDraft, draftVersion: 0 };
  }

  const row = data as SessionDraftRow;

  return {
    error: null,
    draft: normalizeVersionedDraft(row.draft),
    draftVersion: typeof row.draft_version === 'number' ? row.draft_version : 0
  };
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!sessionId || typeof sessionId !== 'string') {
    return jsonWithCors({ error: 'Invalid session ID' }, { status: 400 });
  }

  const session = await requireSession(request);
  if (!session.ok) {
    return session.response;
  }

  if (session.auth.sessionId !== sessionId) {
    return jsonWithCors({ error: 'Session mismatch' }, { status: 403 });
  }

  const draftState = await loadSessionDraft(session.supabase as never, sessionId);
  if (draftState.error) {
    return jsonWithCors({ error: draftState.error }, { status: 404 });
  }

  return jsonWithCors({
    sessionId,
    draft: draftState.draft,
    draftVersion: draftState.draftVersion,
    fieldCount: Object.keys(draftState.draft).length
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const requestId = extractRequestId(request);
  const { sessionId } = await params;

  if (!sessionId || typeof sessionId !== 'string') {
    return jsonWithCors({ error: 'Invalid session ID' }, { status: 400 });
  }

  const session = await requireSession(request);
  if (!session.ok) {
    return session.response;
  }

  if (session.auth.sessionId !== sessionId) {
    return jsonWithCors({ error: 'Session mismatch' }, { status: 403 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return jsonWithCors({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = updateDraftSchema.safeParse(json);
  if (!parsed.success) {
    return jsonWithCors(
      { error: 'Invalid request payload', issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const draftState = await loadSessionDraft(session.supabase as never, sessionId);
  if (draftState.error) {
    return jsonWithCors({ error: draftState.error }, { status: 404 });
  }

  if (
    typeof parsed.data.expectedDraftVersion === 'number' &&
    parsed.data.expectedDraftVersion !== draftState.draftVersion
  ) {
    return jsonWithCors({
      error: 'Draft version conflict. Reload the latest canonical draft before saving.',
      draft: draftState.draft,
      draftVersion: draftState.draftVersion,
      fieldCount: Object.keys(draftState.draft).length
    }, { status: 409 });
  }

  let updatedDraft = { ...draftState.draft };

  for (const { field, value, provenance } of parsed.data.fields) {
    if (provenance === 'cleared') {
      updatedDraft = clearField(updatedDraft, field);
    } else {
      updatedDraft = updateField(updatedDraft, field, value, provenance);
    }
  }

  const nextDraftVersion = draftState.draftVersion + 1;
  const { error } = await session.supabase
    .from('sessions')
    .update({ draft: updatedDraft, draft_version: nextDraftVersion, last_activity_at: new Date().toISOString(), draft_expires_at: temporaryDraftExpiry().toISOString() })
    .eq('id', sessionId);

  if (error) {
    return jsonWithCors({ error: 'project_draft_update_failed' }, { status: 500 });
  }

  for (const { field, provenance } of parsed.data.fields) {
    emitEvent('draft_updated', { sessionId, field, provenance }, requestId);
  }

  return jsonWithCors({
    sessionId,
    draft: updatedDraft,
    draftVersion: nextDraftVersion,
    fieldCount: Object.keys(updatedDraft).length
  });
}
