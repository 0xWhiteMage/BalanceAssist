import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { sendDocument } from '@/lib/telegram';
import { HUMAN_UPLOAD_GUIDANCE, validateUploadFile } from '@/lib/uploads/file-policy';

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
  const kind = String(form.get('kind') ?? 'reference').trim() || 'reference';
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
      const isSizeCap = validation.reason?.includes('too large') ?? false;
      return jsonWithCors(
        { ok: false, error: validation.reason, guidance: HUMAN_UPLOAD_GUIDANCE },
        { status: isSizeCap ? 400 : 415 }
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

  let lastTelegramFileId: string | null = null;
  let uploadedCount = 0;

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const caption = `${file.name} (${kind})`;
    const result = await sendDocument(session.telegram_thread_id ?? null, buffer, caption, file.name);
    const telegramFileId = result?.result?.document?.file_id ?? null;
    lastTelegramFileId = telegramFileId;

    const { error: insertError } = await supabase.from('uploaded_files').insert({
      session_id: sessionId,
      telegram_file_id: telegramFileId,
      name: file.name,
      size_bytes: file.size,
      mime: file.type || null,
      kind
    });

    if (insertError) {
      return jsonWithCors({ ok: false, error: insertError.message }, { status: 500 });
    }

    uploadedCount += 1;
  }

  await supabase
    .from('sessions')
    .update({ file_request_open: false, file_request_note: null })
    .eq('id', sessionId);

  return jsonWithCors({
    ok: true,
    telegramFileId: lastTelegramFileId,
    count: uploadedCount
  });
}