import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonWithCors({ ok: false, error: 'Invalid form data' }, { status: 400 }, request);
  }

  const requestedSessionId = String(form.get('sessionId') ?? '').trim();
  const files = form
    .getAll('files')
    .concat(form.getAll('file'))
    .filter((value): value is File => value instanceof File);

  if (files.length === 0) {
    return jsonWithCors({ ok: false, error: 'Missing files' }, { status: 400 }, request);
  }

  const authResult = await requireSession(request, requestedSessionId || undefined);

  if (!authResult.ok) {
    return authResult.response;
  }

  const sessionId = requestedSessionId || authResult.auth.sessionId;

  return jsonWithCors({ ok: false, code: 'file_uploads_unavailable' }, { status: 503 }, request);
}
