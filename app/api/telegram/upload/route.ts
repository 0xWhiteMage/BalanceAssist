import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { sendTelegramDocument } from '@/lib/telegram';

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  if (!form) {
    return jsonWithCors({ ok: false, error: 'Invalid form data' }, { status: 400 });
  }

  const sessionId = String(form.get('sessionId') ?? '').trim();
  const file = form.get('file');

  if (!sessionId || !(file instanceof File)) {
    return jsonWithCors({ ok: false, error: 'Missing sessionId or file' }, { status: 400 });
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

  const shortId = sessionId.slice(0, 8);
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

  await supabase
    .from('sessions')
    .update({ file_request_open: false, file_request_note: null })
    .eq('id', sessionId);

  if (insertError) {
    return jsonWithCors({ ok: false, error: insertError.message }, { status: 500 });
  }

  return jsonWithCors({ ok: true, sent: sent !== null, fileName: file.name });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
