import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function GET(request: Request) {
  const setupToken = process.env.SETUP_TOKEN;

  if (setupToken) {
    const auth = request.headers.get('authorization') ?? '';
    const provided = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : auth;
    if (provided !== setupToken) {
      return jsonWithCors({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get('id');

  if (!sessionId) {
    return jsonWithCors({ ok: false, error: 'Missing ?id=' }, { status: 400 });
  }

  if (!hasSupabaseServerConfig()) {
    return jsonWithCors({ ok: false, error: 'Supabase not configured on this deployment' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return jsonWithCors({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  }

  const { data, error } = await supabase
    .from('sessions')
    .select('id, status, source_url, telegram_thread_id, contact_name, contact_company, created_at')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    return jsonWithCors({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return jsonWithCors({
      ok: true,
      exists: false,
      sessionId,
      message: 'Session not found in DB. The widget is likely using a mock UUID from before Supabase was configured, or a stale session ID. Hard-refresh the widget to get a fresh session.'
    });
  }

  return jsonWithCors({
    ok: true,
    exists: true,
    session: data
  });
}