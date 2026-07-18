import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, readJsonBodyLimited } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';

const payloadSchema = z.object({
  sessionId: z.string().min(1)
});
const MAX_SCHEDULE_BODY_BYTES = 8 * 1024;

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  const authResult = await requireSession(request);
  if (!authResult.ok) {
    return authResult.response;
  }
  const body = await readJsonBodyLimited(request, MAX_SCHEDULE_BODY_BYTES);
  if (!body.ok) return jsonWithCors(
    { error: body.tooLarge ? 'Payload too large' : 'Invalid JSON body' },
    { status: body.tooLarge ? 413 : 400 }, request
  );
  const parsed = payloadSchema.safeParse(body.data);
  if (!parsed.success) return jsonWithCors({ error: 'Invalid request payload' }, { status: 400 }, request);
  if (parsed.data.sessionId !== authResult.auth.sessionId) {
    return jsonWithCors({ error: 'Session mismatch' }, { status: 403 }, request);
  }

  return jsonWithCors(
    {
      ok: false,
      error: 'Booking verification required before notifying the Balance team.'
    },
    { status: 409 },
    request
  );
}
