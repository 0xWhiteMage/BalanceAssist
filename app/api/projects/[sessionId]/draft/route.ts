import { z } from 'zod';
import { jsonWithCors } from '@/lib/api/route-helpers';
import type { VersionedDraft, FieldProvenance } from '@/lib/conversation/draft-versioning';

const VALID_PROVENANCE: FieldProvenance[] = ['user-stated', 'inferred', 'confirmed', 'cleared'];

const updateFieldSchema = z.object({
  field: z.string().min(1).max(100),
  value: z.string().max(500),
  provenance: z.enum(['user-stated', 'inferred', 'confirmed', 'cleared'] as const)
});

const updateDraftSchema = z.object({
  fields: z.array(updateFieldSchema).min(1).max(20)
});

const draftStore = new Map<string, VersionedDraft>();

function getDraft(sessionId: string): VersionedDraft {
  return draftStore.get(sessionId) ?? {};
}

function setDraft(sessionId: string, draft: VersionedDraft): void {
  draftStore.set(sessionId, draft);
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!sessionId || typeof sessionId !== 'string') {
    return jsonWithCors({ error: 'Invalid session ID' }, { status: 400 });
  }

  const draft = getDraft(sessionId);

  return jsonWithCors({
    sessionId,
    draft,
    fieldCount: Object.keys(draft).length
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!sessionId || typeof sessionId !== 'string') {
    return jsonWithCors({ error: 'Invalid session ID' }, { status: 400 });
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

  const currentDraft = getDraft(sessionId);
  let updatedDraft = { ...currentDraft };

  for (const { field, value, provenance } of parsed.data.fields) {
    if (provenance === 'cleared') {
      updatedDraft[field] = {
        value: '',
        provenance: 'cleared',
        updatedAt: new Date().toISOString()
      };
    } else {
      updatedDraft[field] = {
        value,
        provenance,
        updatedAt: new Date().toISOString()
      };
    }
  }

  setDraft(sessionId, updatedDraft);

  return jsonWithCors({
    sessionId,
    draft: updatedDraft,
    fieldCount: Object.keys(updatedDraft).length
  });
}
