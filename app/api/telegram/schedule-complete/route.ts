import { z } from 'zod';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';

const payloadSchema = z.object({
  sessionId: z.string().min(1)
});

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, payloadSchema);
  if (!parsed.ok) {
    return parsed.response;
  }

  const { sessionId } = parsed.data;
  const authResult = await requireSession(request, sessionId);

  if (!authResult.ok) {
    return authResult.response;
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
