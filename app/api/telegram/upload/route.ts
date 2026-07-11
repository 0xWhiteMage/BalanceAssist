import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { ensureTelegramTopic, sendDocument } from '@/lib/telegram';
import { HUMAN_UPLOAD_GUIDANCE, validateUploadFile } from '@/lib/uploads/file-policy';
import { extractTextFromBuffer } from '@/lib/uploads/extract-text';
import { validateFileBatch, type FileQuarantineResult } from '@/lib/uploads/quarantine';
import { hasRequiredConsent, type AttachmentConsent } from '@/lib/uploads/consent';

type SupabaseClient = NonNullable<ReturnType<typeof createServerSupabaseClient>>;

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

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    console.warn('[telegram-upload] failed to parse form data', error);
    return jsonWithCors({ ok: false, error: 'Invalid form data' }, { status: 400 });
  }

  const sessionId = String(form.get('sessionId') ?? '').trim();
  const kind = coerceKind(form.get('kind'));
  const files = form
    .getAll('files')
    .concat(form.getAll('file'))
    .filter((value): value is File => value instanceof File);

  if (!sessionId || files.length === 0) {
    return jsonWithCors({ ok: false, error: 'Missing sessionId or files' }, { status: 400 });
  }

  const consent = parseConsent(form.get('consent'));
  if (!hasRequiredConsent(consent)) {
    return jsonWithCors(
      { ok: false, error: 'Consent to file analysis and sharing is required before uploading.' },
      { status: 403 }
    );
  }

  for (const file of files) {
    const validation = validateUploadFile(file);
    if (!validation.ok) {
      const isSizeCap = validation.reason?.includes('too large') ?? false;
      return jsonWithCors(
        { ok: false, error: validation.reason, guidance: HUMAN_UPLOAD_GUIDANCE },
        { status: isSizeCap ? 400 : 415 }
      );
    }
  }

  const buffers = await Promise.all(files.map((f) => f.arrayBuffer()));
  const batchResult = validateFileBatch(files.map((file, i) => ({ file, buffer: buffers[i] })));
  if (!batchResult.ok) {
    return jsonWithCors({ ok: false, error: batchResult.reason }, { status: 400 });
  }

  if (!hasSupabaseServerConfig()) {
    return jsonWithCors({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return jsonWithCors({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  }

  const { data: sessionRow } = await supabase
    .from('sessions')
    .select('telegram_thread_id, file_request_open, contact_name, contact_company')
    .eq('id', sessionId)
    .maybeSingle();

  const session = sessionRow as { telegram_thread_id?: number | null; file_request_open?: boolean; contact_name?: string | null; contact_company?: string | null } | null;
  if (!session) {
    return jsonWithCors({ ok: false, error: 'Session not found' }, { status: 404 });
  }

  if (kind === 'deliverable' && !session.file_request_open) {
    return jsonWithCors({ ok: false, error: 'File upload has not been requested by the team' }, { status: 403 });
  }

  const isAiOnlyIntake = !session.file_request_open && !session.telegram_thread_id;

  let lastTelegramFileId: string | null = null;
  let uploadedCount = 0;
  let extractedText = '';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const buffer = Buffer.from(buffers[i]);

    if (!isAiOnlyIntake) {
      const shortId = sessionId.slice(0, 8);
      const threadId = session.telegram_thread_id
        ? session.telegram_thread_id
        : await ensureTelegramTopic(supabase, sessionId, session.contact_name ?? null, session.contact_company ?? null, shortId);

      const caption = `${file.name} (${kind})`;
      const result = await sendDocument(threadId, buffer, caption, file.name);

      if (!result.ok) {
        return jsonWithCors(
          {
            ok: false,
            error: result.description ?? 'Failed to forward file to Telegram',
            telegramStatus: result.status
          },
          { status: 502 }
        );
      }

      if (result.fileId === null) {
        return jsonWithCors(
          { ok: false, error: 'Telegram accepted the upload but did not return a file_id' },
          { status: 502 }
        );
      }

      lastTelegramFileId = result.fileId;
    }

    const { error: insertError } = await supabase.from('uploaded_files').insert({
      session_id: sessionId,
      telegram_file_id: lastTelegramFileId ?? `quarantined-${Date.now()}-${i}`,
      name: file.name,
      size_bytes: file.size,
      mime: file.type || null,
      kind
    });

    if (insertError) {
      return jsonWithCors({ ok: false, error: insertError.message }, { status: 500 });
    }

    const fileText = extractTextFromBuffer(buffer, file.name);
    if (fileText) {
      extractedText = extractedText ? `${extractedText}\n${fileText}` : fileText;
    }

    uploadedCount += 1;
  }

  if (!isAiOnlyIntake) {
    const { error: closeError } = await supabase
      .from('sessions')
      .update({ file_request_open: false, file_request_note: null })
      .eq('id', sessionId);

    if (closeError) {
      console.warn('[telegram-upload] failed to reset file_request_open', closeError);
    }
  }

  return jsonWithCors({
    ok: true,
    telegramFileId: lastTelegramFileId,
    count: uploadedCount,
    ...(extractedText ? { extractedText } : {})
  });
}
