import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { deletePrivateUpload, PrivateStorageError, privateStorageAvailable, privateUploadBucketFromEnv, storePrivateUpload, type PrivateStorageClient } from '@/lib/uploads/private-storage';
import { classifyConfidentialFilename, classifyConfidentialIntent } from '@/lib/privacy/confidential-intent';
import { extractTextResultFromBufferAsync, type TextExtractionResult } from '@/lib/uploads/extract-text';
import { PRIVATE_ANALYSIS_UPLOAD_POLICY, validateFile, validateFileBatch } from '@/lib/uploads/quarantine';
import {
  HUMAN_UPLOAD_POLICY,
  hasBlockedHumanUploadContent,
  safeHumanUploadMime,
  validateHumanUploadBatch
} from '@/lib/uploads/file-policy';
import { consumeRateLimit } from '@/lib/security/rate-limit';

const ANALYSIS_MULTIPART_BODY_BYTES = PRIVATE_ANALYSIS_UPLOAD_POLICY.maxTotalSizeBytes + 64 * 1024;
const HUMAN_MULTIPART_BODY_BYTES = HUMAN_UPLOAD_POLICY.maxTotalSizeBytes + 1024 * 1024;
const SESSION_UPLOAD_QUOTA_BYTES = 100 * 1024 * 1024;

class MultipartBodyTooLargeError extends Error {}

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  return typeof file.arrayBuffer === 'function'
    ? file.arrayBuffer()
    : new Response(file).arrayBuffer();
}

async function readBoundedBody(body: ReadableStream<Uint8Array>, maxBytes: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new MultipartBodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
    return jsonWithCors({ ok: false, code: 'session_id_required' }, { status: 400 }, request);
  }

  const authResult = await requireSession(request, requestedSessionId);
  if (!authResult.ok) {
    return authResult.response;
  }

  try {
    const limit = await consumeRateLimit(`upload:${authResult.auth.capability}`, 12, 60 * 60);
    if (!limit.permitted) return jsonWithCors(
      { ok: false, code: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }, request
    );
  } catch {
    return jsonWithCors({ ok: false, code: 'rate_limit_unavailable' }, { status: 503 }, request);
  }

  const modeHeader = request.headers.get('x-upload-mode')?.trim();
  if (!modeHeader) {
    return jsonWithCors({ ok: false, code: 'upload_mode_required' }, { status: 400 }, request);
  }
  if (modeHeader !== 'analysis' && modeHeader !== 'human') {
    return jsonWithCors({ ok: false, code: 'invalid_upload_mode' }, { status: 400 }, request);
  }
  const maxMultipartBodyBytes = modeHeader === 'analysis'
    ? ANALYSIS_MULTIPART_BODY_BYTES
    : HUMAN_MULTIPART_BODY_BYTES;

  const contentLength = request.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxMultipartBodyBytes) {
    return jsonWithCors({ ok: false, code: 'file_uploads_unavailable' }, { status: 413 }, request);
  }

  let form: FormData;
  try {
    const contentType = request.headers.get('content-type');
    if (!request.body || !contentType?.toLowerCase().startsWith('multipart/form-data;')) {
      return jsonWithCors({ ok: false, code: 'invalid_form_data' }, { status: 400 }, request);
    }
    const bytes = await readBoundedBody(request.body, maxMultipartBodyBytes);
    form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
  } catch (error) {
    if (error instanceof MultipartBodyTooLargeError) {
      return jsonWithCors({ ok: false, code: 'file_uploads_unavailable' }, { status: 413 }, request);
    }
    return jsonWithCors({ ok: false, code: 'invalid_form_data' }, { status: 400 }, request);
  }

  const modeValue = form.get('mode');
  if (modeValue !== modeHeader) {
    return jsonWithCors({ ok: false, code: 'upload_mode_mismatch' }, { status: 400 }, request);
  }
  const mode = modeHeader;

  const files = form
    .getAll('files')
    .concat(form.getAll('file'))
    .filter((value): value is File => value instanceof File);

  if (files.length === 0) {
    return jsonWithCors({ ok: false, code: 'files_required' }, { status: 400 }, request);
  }
  const activePolicy = mode === 'analysis' ? PRIVATE_ANALYSIS_UPLOAD_POLICY : HUMAN_UPLOAD_POLICY;
  if (
    files.length > activePolicy.maxFiles ||
    files.reduce((total, file) => total + file.size, 0) > activePolicy.maxTotalSizeBytes
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
    .select('scope, granted, notice_version')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false });
  if (consentError) {
    return jsonWithCors({ ok: false, code: 'file_uploads_unavailable' }, { status: 503 }, request);
  }
  const requiredScope = mode === 'analysis' ? 'analysis' : 'producer_transfer';
  const requiredConsent = (consents ?? []).find(
    (entry: { scope?: unknown }) => entry.scope === requiredScope
  ) as { granted?: unknown; notice_version?: unknown } | undefined;
  if (requiredConsent?.granted !== true || requiredConsent.notice_version !== '1.2') {
    const code = mode === 'analysis' ? 'analysis_consent_required' : 'producer_transfer_consent_required';
    return jsonWithCors({ ok: false, code }, { status: 403 }, request);
  }

  const preflight: Array<{ buffer: ArrayBuffer; verifiedMime: string; extractedText: string; extraction: TextExtractionResult }> = [];
  try {
    if (mode === 'analysis') {
      const candidates: Array<{ file: File; buffer: ArrayBuffer }> = [];
      for (const file of files) candidates.push({ file, buffer: await readFileBuffer(file) });
      const batchValidation = validateFileBatch(candidates);
      if (!batchValidation.ok) throw new Error('file_validation_failed');
      for (const { file, buffer } of candidates) {
        const validation = validateFile(file, buffer);
        if (!validation.ok) throw new Error('file_validation_failed');
        const extraction = await extractTextResultFromBufferAsync(Buffer.from(buffer), validation.mime);
        preflight.push({
          buffer,
          verifiedMime: validation.mime,
          extractedText: extraction.text,
          extraction
        });
      }
    } else {
      if (!validateHumanUploadBatch(files).ok) throw new Error('file_validation_failed');
      for (const file of files) {
        const buffer = await readFileBuffer(file);
        if (hasBlockedHumanUploadContent(file.type, buffer)) throw new Error('file_validation_failed');
        preflight.push({ buffer, verifiedMime: safeHumanUploadMime(file.type), extractedText: '', extraction: { status: 'unsupported', text: '' } });
      }
    }
  } catch {
    return jsonWithCors({ ok: false, code: 'file_validation_failed' }, { status: 422 }, request);
  }

  if (mode === 'analysis') {
    try {
      if (preflight.some(({ extractedText }) => extractedText.trim() && classifyConfidentialIntent(extractedText) !== 'allow')) {
        return jsonWithCors({ ok: false, code: 'confidential_file_not_allowed' }, { status: 422 }, request);
      }
    } catch {
      return jsonWithCors({ ok: false, code: 'confidential_file_not_allowed' }, { status: 422 }, request);
    }
  }

  let quota: { data: unknown; error: unknown };
  try {
    quota = await authResult.supabase.rpc('reserve_session_upload_quota', {
      p_session_id: sessionId,
      p_size_bytes: files.reduce((total, file) => total + file.size, 0),
      p_max_bytes: SESSION_UPLOAD_QUOTA_BYTES
    });
  } catch {
    return jsonWithCors({ ok: false, code: 'upload_quota_unavailable' }, { status: 503 }, request);
  }
  if (quota.error) return jsonWithCors({ ok: false, code: 'upload_quota_unavailable' }, { status: 503 }, request);
  if (typeof quota.data !== 'string') return jsonWithCors({ ok: false, code: 'upload_quota_exceeded' }, { status: 413 }, request);
  const quotaReservationId = quota.data;

  const stored: Array<{ objectKey: string; mimeType: string; extractedText: string }> = [];
  try {
    for (const file of preflight) {
      stored.push(await storePrivateUpload({
        client: authResult.supabase as unknown as PrivateStorageClient,
        bucket,
        sessionId,
        ...file
      }));
    }
    const response = mode === 'analysis'
      ? { ok: true, status: 'stored', analyses: stored.map(({ mimeType, extractedText }, index) => ({
          mimeType,
          extractedText,
          extractionStatus: preflight[index].extraction.status
        })) }
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
  } finally {
    try {
      await authResult.supabase.rpc('release_session_upload_quota', { p_reservation_id: quotaReservationId });
    } catch {
      // Reservations expire automatically; do not turn a completed upload into a client retry.
    }
  }
}
