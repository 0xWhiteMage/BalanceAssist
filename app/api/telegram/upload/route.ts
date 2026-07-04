import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { sendTelegramDocument, sendTelegramMessage } from '@/lib/telegram';
import { HUMAN_UPLOAD_GUIDANCE, UPLOAD_BUCKET_NAME, validateUploadFile } from '@/lib/uploads/file-policy';

type SupabaseClient = NonNullable<ReturnType<typeof createServerSupabaseClient>>;

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) {
    return jsonWithCors({ ok: false, error: 'Invalid form data' }, { status: 400 });
  }

  const sessionId = String(form.get('sessionId') ?? '').trim();
  const files = form
    .getAll('files')
    .concat(form.getAll('file'))
    .filter((value): value is File => value instanceof File);

  if (!sessionId || files.length === 0) {
    return jsonWithCors({ ok: false, error: 'Missing sessionId or files' }, { status: 400 });
  }

  for (const file of files) {
    const validation = validateUploadFile(file);
    if (!validation.ok) {
      return jsonWithCors(
        { ok: false, error: validation.reason, guidance: HUMAN_UPLOAD_GUIDANCE },
        { status: 415 }
      );
    }
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
    .select('telegram_thread_id, file_request_open')
    .eq('id', sessionId)
    .maybeSingle();

  const session = sessionRow as { telegram_thread_id?: number | null; file_request_open?: boolean } | null;
  if (!session) {
    return jsonWithCors({ ok: false, error: 'Session not found' }, { status: 404 });
  }

  if (!session.file_request_open) {
    return jsonWithCors({ ok: false, error: 'File upload has not been requested by the team' }, { status: 403 });
  }

  await ensureUploadBucket(supabase);

  const shortId = sessionId.slice(0, 8);
  const uploaded: Array<{ fileName: string; sent: boolean; storagePath: string | null }> = [];

  for (const file of files) {
    const storagePath = `${sessionId}/${Date.now()}-${safeFilename(file.name)}`;
    const { error: storageError } = await supabase.storage
      .from(UPLOAD_BUCKET_NAME)
      .upload(storagePath, file, {
        upsert: false,
        contentType: file.type || undefined
      });

    if (storageError) {
      return jsonWithCors({ ok: false, error: storageError.message }, { status: 500 });
    }

    const caption = `<b>📎 File upload</b>\n<code>${shortId}</code>\n${escapeHtml(file.name)}`;

    const sent = await sendTelegramDocument(file, {
      caption,
      threadId: session.telegram_thread_id ?? undefined
    });

    const { error: insertError } = await supabase.from('human_messages').insert({
      session_id: sessionId,
      sender: 'user',
      text: `[File] ${file.name}`,
      telegram_message_id: sent?.messageId ?? null,
      telegram_thread_id: session.telegram_thread_id ?? null
    });

    if (insertError) {
      return jsonWithCors({ ok: false, error: insertError.message }, { status: 500 });
    }

    const { error: metadataError } = await supabase.from('uploaded_files').insert({
      session_id: sessionId,
      storage_path: storagePath,
      original_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      telegram_message_id: sent?.messageId ?? null
    });

    if (metadataError) {
      return jsonWithCors({ ok: false, error: metadataError.message }, { status: 500 });
    }

    uploaded.push({ fileName: file.name, sent: sent !== null, storagePath });
  }

  if (files.length > 1) {
    const summary = `<b>📦 Upload batch</b>\n<code>${shortId}</code>\n${files
      .map((file) => `• ${escapeHtml(file.name)}`)
      .join('\n')}`;
    await sendTelegramMessage(summary, {
      threadId: session.telegram_thread_id ?? undefined
    });
  }

  await supabase
    .from('sessions')
    .update({ file_request_open: false, file_request_note: null })
    .eq('id', sessionId);

  return jsonWithCors({ ok: true, files: uploaded, count: uploaded.length });
}

async function ensureUploadBucket(supabase: SupabaseClient) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    throw new Error(error.message);
  }

  if (buckets.some((bucket) => bucket.name === UPLOAD_BUCKET_NAME)) {
    return;
  }

  const { error: createError } = await supabase.storage.createBucket(UPLOAD_BUCKET_NAME, {
    public: false,
    fileSizeLimit: `${Math.floor(50)}MB`
  });
  if (createError) {
    throw new Error(createError.message);
  }
}

function safeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
