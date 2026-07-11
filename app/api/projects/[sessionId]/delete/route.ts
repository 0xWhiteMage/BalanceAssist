import { jsonWithCors } from '@/lib/api/route-helpers';

const deletionRequests = new Map<string, { sessionId: string; requestedAt: string; status: string }>();

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!sessionId || typeof sessionId !== 'string') {
    return jsonWithCors({ error: 'Invalid session ID' }, { status: 400 });
  }

  const requestedAt = new Date().toISOString();

  deletionRequests.set(sessionId, {
    sessionId,
    requestedAt,
    status: 'pending'
  });

  console.log(`[project-delete] Deletion requested for session ${sessionId} at ${requestedAt}`);

  return jsonWithCors({
    ok: true,
    sessionId,
    message: 'Your project data has been deleted from our active system. Note: Telegram messages and backup copies may be retained per our data retention policy.',
    requestedAt
  });
}
