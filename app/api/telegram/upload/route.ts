import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { normalizeVersionedDraft } from '@/lib/conversation/draft-versioning';
import { createLogger, extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { sendDocument } from '@/lib/telegram';
import { HUMAN_UPLOAD_GUIDANCE, validateUploadFile } from '@/lib/uploads/file-policy';
import { extractTextFromBuffer } from '@/lib/uploads/extract-text';
import { validateFile, validateFileBatch } from '@/lib/uploads/quarantine';
import {
  getRecordedAttachmentConsent,
  recordAttachmentConsent,
  type AttachmentConsent
} from '@/lib/uploads/consent';

const ALLOWED_KINDS = ['reference', 'brief', 'deliverable'] as const;
type AllowedKind = (typeof ALLOWED_KINDS)[number];
const MAX_KIND_LENGTH = 32;

function coerceKind(raw: unknown): AllowedKind {
  const value = typeof raw === 'string' ? raw.trim().slice(0, MAX_KIND_LENGTH) : '';
  return (ALLOWED_KINDS as readonly string[]).includes(value) ? (value as AllowedKind) : 'reference';
}

function parseConsent(raw: unknown): AttachmentConsent | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.aiAnalysis === 'boolean' &&
      typeof parsed.producerShare === 'boolean' &&
      typeof parsed.consentedAt === 'string'
    ) {
      return parsed as AttachmentConsent;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function POST(request: Request) {
  const requestId = extractRequestId(request);
  const logger = createLogger('telegram-upload', requestId);
  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    logger.warn('Failed to parse form data', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return jsonWithCors({ ok: false, error: 'Invalid form data' }, { status: 400 }, request);
  }

  const requestedSessionId = String(form.get('sessionId') ?? '').trim();
  const kind = coerceKind(form.get('kind'));
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

  const consent = parseConsent(form.get('consent'));

  for (const file of files) {
    const validation = validateUploadFile(file);
    if (!validation.ok) {
      const isSizeCap = validation.reason?.includes('too large') ?? false;
        return jsonWithCors(
          { ok: false, error: validation.reason, guidance: HUMAN_UPLOAD_GUIDANCE },
          { status: isSizeCap ? 400 : 415 },
          request
        );
      }
    }

  const buffers = await Promise.all(files.map((f) => f.arrayBuffer()));
  const batchResult = validateFileBatch(files.map((file, i) => ({ file, buffer: buffers[i] })));
  if (!batchResult.ok) {
    return jsonWithCors({ ok: false, error: batchResult.reason }, { status: 400 }, request);
  }

  const detectedMimes: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const buffer = buffers[i];
    const fileResult = validateFile(file, buffer);
    if (!fileResult.ok) {
      return jsonWithCors(
        { ok: false, error: fileResult.reason, guidance: HUMAN_UPLOAD_GUIDANCE },
        { status: 415 },
        request
      );
    }

    detectedMimes.push(fileResult.mime);
  }

  const { supabase } = authResult;

  const { data: sessionRow, error: sessionError } = await supabase
    .from('sessions')
    .select('telegram_thread_id, file_request_open, contact_name, contact_company, status, draft, draft_version')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionError) {
    return jsonWithCors({ ok: false, error: sessionError.message }, { status: 500 }, request);
  }

  const session = sessionRow as {
    telegram_thread_id?: number | null;
    file_request_open?: boolean;
    contact_name?: string | null;
    contact_company?: string | null;
    status?: string;
    draft?: unknown;
    draft_version?: number | null;
  } | null;
  if (!session) {
    return jsonWithCors({ ok: false, error: 'Session not found' }, { status: 404 }, request);
  }

  const currentDraft = normalizeVersionedDraft(session.draft);
  const nextDraft = recordAttachmentConsent(currentDraft, consent);

  if (JSON.stringify(nextDraft) !== JSON.stringify(currentDraft)) {
    const { error: updateError } = await supabase
      .from('sessions')
      .update({ draft: nextDraft, draft_version: (session.draft_version ?? 0) + 1 })
      .eq('id', sessionId);

    if (updateError) {
      return jsonWithCors({ ok: false, error: updateError.message }, { status: 500 }, request);
    }
  }

  const recordedConsent = getRecordedAttachmentConsent(nextDraft);
  const canAnalyze = recordedConsent.aiAnalysis;
  const canShareWithTeam = recordedConsent.producerShare;

  if (kind === 'deliverable' && !canShareWithTeam) {
    return jsonWithCors(
      { ok: false, error: 'Consent to share files with the Balance team is required before delivering uploads.' },
      { status: 403 },
      request
    );
  }

  if (!canAnalyze && !canShareWithTeam) {
    return jsonWithCors(
      { ok: false, error: 'Consent to file analysis or team sharing is required before uploading.' },
      { status: 403 },
      request
    );
  }

  if (kind === 'deliverable' && !session.file_request_open) {
    return jsonWithCors({ ok: false, error: 'File upload has not been requested by the team' }, { status: 403 }, request);
  }

  let lastTelegramFileId: string | null = null;
  let uploadedCount = 0;
  let extractedText = '';

  const isFinalized = session.status === 'completed' || session.status === 'escalated';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const buffer = Buffer.from(buffers[i]);

    if (canShareWithTeam && isFinalized && session.telegram_thread_id) {
      const caption = `${file.name} (${kind})`;
      const result = await sendDocument(session.telegram_thread_id, buffer, caption, file.name);

      if (!result.ok) {
        return jsonWithCors(
          {
            ok: false,
            error: result.description ?? 'Failed to forward file to Telegram',
            telegramStatus: result.status
          },
          { status: 502 },
          request
        );
      }

      if (result.fileId === null) {
        return jsonWithCors(
          { ok: false, error: 'Telegram accepted the upload but did not return a file_id' },
          { status: 502 },
          request
        );
      }

      lastTelegramFileId = result.fileId;
    }

    const uploadStatus = lastTelegramFileId ? 'sent' : 'quarantined';

    const { error: insertError } = await supabase.from('uploaded_files').insert({
      session_id: sessionId,
      telegram_file_id: lastTelegramFileId ?? `quarantined-${Date.now()}-${i}`,
      name: file.name,
      original_name: file.name,
      size_bytes: file.size,
      mime: detectedMimes[i] ?? null,
      mime_type: detectedMimes[i] ?? null,
      status: uploadStatus,
      storage_path: null,
      kind
    });

    if (insertError) {
      return jsonWithCors({ ok: false, error: insertError.message }, { status: 500 }, request);
    }

    emitEvent(lastTelegramFileId ? 'attachment_forwarded' : 'attachment_quarantined', {
      sessionId,
      originalName: file.name,
      mimeType: detectedMimes[i] ?? null,
      ...(lastTelegramFileId ? {} : { reason: 'not_forwarded' })
    }, requestId);

    if (canAnalyze) {
      const fileText = extractTextFromBuffer(buffer, file.name);
      if (fileText) {
        extractedText = extractedText ? `${extractedText}\n${fileText}` : fileText;
      }
    }

    uploadedCount += 1;
  }

  if (canShareWithTeam && session.file_request_open) {
    const { error: closeError } = await supabase
      .from('sessions')
      .update({ file_request_open: false, file_request_note: null })
      .eq('id', sessionId);

    if (closeError) {
      logger.warn('Failed to reset file_request_open', {
        error:
          closeError instanceof Error
            ? closeError.message
            : (closeError as { message?: string }).message ?? 'Unknown error'
      });
    }
  }

  return jsonWithCors({
    ok: true,
    telegramFileId: lastTelegramFileId,
    count: uploadedCount,
    forwarded: lastTelegramFileId !== null,
    ...(extractedText ? { extractedText } : {})
  }, undefined, request);
}
