import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { deletePrivateUpload, PrivateStorageError, privateStorageAvailable, privateUploadBucketFromEnv, storePrivateUpload, type PrivateStorageClient } from '@/lib/uploads/private-storage';
import { classifyConfidentialFilename } from '@/lib/privacy/confidential-intent';
import { PRIVATE_ANALYSIS_UPLOAD_POLICY, validateFile, validateFileBatch } from '@/lib/uploads/quarantine';

const MAX_MULTIPART_BODY_BYTES = 26 * 1024 * 1024;

class MultipartBodyTooLargeError extends Error {}

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return typeof file.arrayBuffer === 'function'
    ? file.arrayBuffer()
    : new Response(file).arrayBuffer();
}

function boundedBodyStream(body: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = body.getReader();
  let bytesRead = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        bytesRead += value.byteLength;
        if (bytesRead > maxBytes) {
          await reader.cancel();
          controller.error(new MultipartBodyTooLargeError());
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}

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
  const requestedSessionId = request.headers.get('x-session-id')?.trim();
  if (!requestedSessionId) {
    return jsonWithCors({ ok: false, error: 'Session ID required' }, { status: 400 }, request);
  }

  const authResult = await requireSession(request, requestedSessionId);
  if (!authResult.ok) {
    return authResult.response;
  }

  const contentLength = request.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_MULTIPART_BODY_BYTES) {
    return jsonWithCors({ ok: false, code: 'file_uploads_unavailable' }, { status: 413 }, request);
  }

  let form: FormData;
  try {
    const multipartRequest = request.body
      ? new Request(request, { body: boundedBodyStream(request.body, MAX_MULTIPART_BODY_BYTES), duplex: 'half' } as RequestInit)
      : request;
    form = await multipartRequest.formData();
  } catch (error) {
    if (error instanceof MultipartBodyTooLargeError) {
      return jsonWithCors({ ok: false, code: 'file_uploads_unavailable' }, { status: 413 }, request);
    }
    return jsonWithCors({ ok: false, error: 'Invalid form data' }, { status: 400 }, request);
  }

  const modeValue = form.get('mode');
  if (modeValue === null) {
    return jsonWithCors({ ok: false, code: 'upload_mode_required' }, { status: 400 }, request);
  }
  if (modeValue !== 'analysis' && modeValue !== 'human') {
    return jsonWithCors({ ok: false, code: 'invalid_upload_mode' }, { status: 400 }, request);
  }
  const mode = modeValue;

  const files = form
    .getAll('files')
    .concat(form.getAll('file'))
    .filter((value): value is File => value instanceof File);

  if (files.length === 0) {
    return jsonWithCors({ ok: false, error: 'Missing files' }, { status: 400 }, request);
  }
  if (
    files.length > PRIVATE_ANALYSIS_UPLOAD_POLICY.maxFiles ||
    files.reduce((total, file) => total + file.size, 0) > PRIVATE_ANALYSIS_UPLOAD_POLICY.maxTotalSizeBytes
  ) {
    return jsonWithCors({ ok: false, code: 'file_uploads_unavailable' }, { status: 413 }, request);
  }

  if (mode === 'analysis') {
    try {
      if (files.some((file) => classifyConfidentialFilename(file.name) !== 'allow')) {
        return jsonWithCors({ ok: false, code: 'confidential_file_not_allowed' }, { status: 422 }, request);
      }
    } catch {
      return jsonWithCors({ ok: false, code: 'confidential_file_not_allowed' }, { status: 422 }, request);
    }
  }

  const sessionId = authResult.auth.sessionId;

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
  const requiredScope = mode === 'analysis' ? 'analysis' : 'producer_transfer';
  const requiredConsent = (consents ?? []).find(
    (entry: { scope?: unknown }) => entry.scope === requiredScope
  ) as { granted?: unknown } | undefined;
  if (requiredConsent?.granted !== true) {
    const code = mode === 'analysis' ? 'analysis_consent_required' : 'producer_transfer_consent_required';
    return jsonWithCors({ ok: false, code }, { status: 403 }, request);
  }

  let preflight: Array<{ buffer: ArrayBuffer; verifiedMime: string }>;
  try {
    const buffers = await Promise.all(files.map(readFileBuffer));
    const batchValidation = validateFileBatch(files.map((file, index) => ({ file, buffer: buffers[index] })));
    if (!batchValidation.ok) {
      return jsonWithCors({ ok: false, code: 'file_validation_failed' }, { status: 422 }, request);
    }
    preflight = files.map((file, index) => {
      const validation = validateFile(file, buffers[index]);
      if (!validation.ok) throw new Error('file_validation_failed');
      return { buffer: buffers[index], verifiedMime: validation.mime };
    });
  } catch {
    return jsonWithCors({ ok: false, code: 'file_validation_failed' }, { status: 422 }, request);
  }

  const stored: Array<{ objectKey: string; mimeType: string; extractedText: string }> = [];
  try {
    for (const file of preflight) {
      stored.push(await storePrivateUpload({
        client: authResult.supabase as unknown as PrivateStorageClient,
        bucket,
        sessionId,
        ...file,
        extractText: mode === 'analysis'
      }));
    }
    const response = mode === 'analysis'
      ? { ok: true, status: 'stored', analyses: stored.map(({ mimeType, extractedText }) => ({ mimeType, extractedText })) }
      : { ok: true, status: 'stored' };
    return jsonWithCors(response, undefined, request);
  } catch (error) {
    const compensated = await Promise.all(stored.map(({ objectKey }) => deletePrivateUpload({
      client: authResult.supabase as unknown as PrivateStorageClient,
      bucket,
      objectKey
    })));
    if (compensated.some((deleted) => !deleted)) {
      return jsonWithCors({ ok: false, code: 'private_storage_recovery_unavailable' }, { status: 503 }, request);
    }
    const code = error instanceof PrivateStorageError ? error.code : 'private_storage_unavailable';
    return jsonWithCors({ ok: false, code }, { status: 503 }, request);
  }
}
