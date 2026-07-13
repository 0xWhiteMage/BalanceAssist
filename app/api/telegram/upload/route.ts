import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { PrivateStorageError, privateStorageAvailable, privateUploadBucketFromEnv, storePrivateUpload, type PrivateStorageClient } from '@/lib/uploads/private-storage';

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function GET(request: Request) {
  const bucket = privateUploadBucketFromEnv();
  const client = hasSupabaseServerConfig() ? createServerSupabaseClient() : null;
  const available = Boolean(bucket && client && await privateStorageAvailable(client as unknown as PrivateStorageClient, bucket).catch(() => false));
  return jsonWithCors({ available }, { status: available ? 200 : 503 }, request);
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
  if (files.length > 5 || files.reduce((total, file) => total + file.size, 0) > 25 * 1024 * 1024) {
    return jsonWithCors({ ok: false, code: 'file_uploads_unavailable' }, { status: 413 }, request);
  }

  const authResult = await requireSession(request, requestedSessionId || undefined);

  if (!authResult.ok) {
    return authResult.response;
  }

  const sessionId = requestedSessionId || authResult.auth.sessionId;

  const bucket = privateUploadBucketFromEnv();
  if (!bucket) {
    return jsonWithCors({ ok: false, code: 'file_uploads_unavailable' }, { status: 503 }, request);
  }

  const { data: consents, error: consentError } = await authResult.supabase
    .from('session_consents')
    .select('scope, granted')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });
  if (consentError) {
    return jsonWithCors({ ok: false, code: 'file_uploads_unavailable' }, { status: 503 }, request);
  }
  const analysisConsent = (consents ?? []).find((entry: { scope?: unknown }) => entry.scope === 'analysis') as { granted?: unknown } | undefined;
  if (analysisConsent?.granted !== true) {
    return jsonWithCors({ ok: false, code: 'analysis_consent_required' }, { status: 403 }, request);
  }

  try {
    for (const file of files) {
      await storePrivateUpload({ client: authResult.supabase as unknown as PrivateStorageClient, bucket, sessionId, file });
    }
  } catch (error) {
    const code = error instanceof PrivateStorageError ? error.code : 'private_storage_unavailable';
    return jsonWithCors({ ok: false, code }, { status: 503 }, request);
  }

  return jsonWithCors({ ok: true, status: 'stored' }, undefined, request);
}
