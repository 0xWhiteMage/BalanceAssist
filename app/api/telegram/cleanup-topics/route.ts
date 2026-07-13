import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { deleteForumTopic } from '@/lib/telegram';
import { validateAdminRequest } from '@/lib/security/config';

const cleanupPayloadSchema = z.object({
  threadIds: z.array(z.number().int().positive()).min(1).max(200)
});

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const authResult = validateAdminRequest(request);
  if (!authResult.ok) {
    return jsonWithCors({ ok: false, error: authResult.error }, { status: authResult.status });
  }

  const parsed = await parseRequestBody(request, cleanupPayloadSchema);

  if (!parsed.ok) {
    return jsonWithCors({ ok: false, error: 'Invalid payload', issues: parsed.response }, { status: 400 });
  }

  const { threadIds } = parsed.data;
  const results: { threadId: number; deleted: boolean; error?: string }[] = [];

  for (const threadId of threadIds) {
    const deleted = await deleteForumTopic(threadId).catch((error: Error) => {
      results.push({ threadId, deleted: false, error: error.message });
      return false;
    });

    if (deleted) {
      results.push({ threadId, deleted: true });
    } else if (!results.find((r) => r.threadId === threadId)) {
      results.push({ threadId, deleted: false, error: 'deleteForumTopic returned false' });
    }
  }

  const deleted = results.filter((r) => r.deleted).length;
  const failed = results.filter((r) => !r.deleted).length;

  return jsonWithCors({
    ok: failed === 0,
    summary: { requested: threadIds.length, deleted, failed },
    results
  });
}