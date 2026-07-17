import { z } from 'zod';
import { createHash } from 'node:crypto';
import { jsonWithCors } from '@/lib/api/route-helpers';
import { normalizeVersionedDraft, type VersionedDraft } from '@/lib/conversation/draft-versioning';
import { requireSession } from '@/lib/api/require-session';
import { extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { MAX_PROJECT_SCOPE_CHARACTERS } from '@/lib/api/contracts';
import { normalizePublicReferenceUrl } from '@/lib/uploads/url-detect';

const updateFieldSchema = z.object({
  field: z.string().min(1).max(100),
  value: z.string().max(MAX_PROJECT_SCOPE_CHARACTERS),
  provenance: z.enum(['user-stated', 'inferred', 'confirmed', 'cleared'] as const)
}).superRefine((field, context) => {
  if (field.field !== 'projectScope' && field.value.length > 500) {
    context.addIssue({ code: z.ZodIssueCode.too_big, type: 'string', maximum: 500, inclusive: true });
  }
});

const updateDraftSchema = z.object({
  expectedDraftVersion: z.number().int().min(0),
  fields: z.array(updateFieldSchema).min(1).max(20)
});

type SessionDraftRow = {
  draft: unknown;
  draft_version: number | null;
};

type ReferenceLinkRow = { id: string; kind: string; url: string };

function canonicalReferenceSetHash(links: Array<Pick<ReferenceLinkRow, 'kind' | 'url'>>): string {
  const canonicalLinks = links
    .map((link) => ({ kind: link.kind, url: normalizePublicReferenceUrl(link.url) }))
    .filter((link): link is { kind: string; url: string } => link.url !== null)
    .sort((left, right) => left.url.localeCompare(right.url) || left.kind.localeCompare(right.kind));
  return createHash('sha256').update(JSON.stringify(canonicalLinks)).digest('hex');
}

async function loadApprovalMetadata(supabase: any, sessionId: string) {
  try {
    const { data: links, error: linksError } = await supabase
      .from('reference_links')
      .select('id, kind, url')
      .eq('session_id', sessionId);
    if (linksError) return { referenceLinks: [] as ReferenceLinkRow[] };

    const referenceLinks = Array.isArray(links) ? links as ReferenceLinkRow[] : [];
    const { data: crmLead, error: crmError } = await supabase
      .from('crm_leads')
      .select('id')
      .eq('source_session_id', sessionId)
      .maybeSingle();
    if (crmError || !crmLead || typeof crmLead.id !== 'string') {
      return { referenceLinks, canonicalReferenceSetHash: canonicalReferenceSetHash(referenceLinks) };
    }

    const { data: revision, error: revisionError } = await supabase
      .from('crm_lead_revisions')
      .select('revision, source_draft_version, approval_input_hash, payload')
      .eq('crm_lead_id', crmLead.id)
      .order('revision', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (revisionError || !revision) {
      return { referenceLinks, canonicalReferenceSetHash: canonicalReferenceSetHash(referenceLinks) };
    }

    const approvedLinks = Array.isArray((revision.payload as { referenceLinks?: unknown } | null)?.referenceLinks)
      ? (revision.payload as { referenceLinks: Array<{ url?: unknown; label?: unknown }> }).referenceLinks
        .filter((link): link is { url: string; label?: string } => typeof link.url === 'string')
        .map((link) => ({ kind: link.label ?? '', url: link.url }))
      : [];
    return {
      referenceLinks,
      canonicalReferenceSetHash: canonicalReferenceSetHash(referenceLinks),
      approvedReferenceSetHash: canonicalReferenceSetHash(approvedLinks),
      approvedDraftVersion: typeof revision.source_draft_version === 'number' ? revision.source_draft_version : undefined,
      approvalInputHash: typeof revision.approval_input_hash === 'string' ? revision.approval_input_hash : undefined,
      crmRevision: typeof revision.revision === 'number' ? revision.revision : undefined
    };
  } catch {
    return { referenceLinks: [] as ReferenceLinkRow[] };
  }
}

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
  const approval = await loadApprovalMetadata(session.supabase, sessionId);

  return jsonWithCors({
    sessionId,
    draft: draftState.draft,
    draftVersion: draftState.draftVersion,
    fieldCount: Object.keys(draftState.draft).length,
    ...approval
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

  const { data, error } = await session.supabase.rpc('update_session_draft', {
    p_session_id: sessionId,
    p_expected_draft_version: parsed.data.expectedDraftVersion,
    p_fields: parsed.data.fields
  });
  const result = Array.isArray(data) ? data[0] as { draft?: unknown; draft_version?: number; conflict?: boolean } : null;
  if (error || !result || typeof result.draft_version !== 'number') {
    return jsonWithCors({ error: 'project_draft_update_failed' }, { status: 500 });
  }
  const updatedDraft = normalizeVersionedDraft(result.draft);
  if (result.conflict) {
    return jsonWithCors({
      error: 'Draft version conflict. Reload the latest canonical draft before saving.',
      draft: updatedDraft,
      draftVersion: result.draft_version,
      fieldCount: Object.keys(updatedDraft).length
    }, { status: 409 });
  }

  for (const { field, provenance } of parsed.data.fields) {
    emitEvent('draft_updated', { sessionId, field, provenance }, requestId);
  }

  return jsonWithCors({
    sessionId,
    draft: updatedDraft,
    draftVersion: result.draft_version,
    fieldCount: Object.keys(updatedDraft).length
  });
}
