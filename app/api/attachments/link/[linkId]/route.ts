import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';

const linkIdSchema = z.string().uuid();

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  if (!linkIdSchema.safeParse(linkId).success) {
    return jsonWithCors({ ok: false, error: 'Invalid link ID' }, { status: 400 }, request);
  }

  const session = await requireSession(request);
  if (!session.ok) return session.response;

  const { data, error } = await session.supabase
    .from('reference_links')
    .delete()
    .eq('id', linkId)
    .eq('session_id', session.auth.sessionId)
    .select('id');
  if (error) {
    return jsonWithCors({ ok: false, error: 'attachment_link_delete_failed' }, { status: 500 }, request);
  }
  if (!Array.isArray(data) || data.length !== 1) {
    return jsonWithCors({ ok: false, error: 'Reference link not found' }, { status: 404 }, request);
  }

  return jsonWithCors({ ok: true, deletedLinkId: linkId }, undefined, request);
}
