import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { requireSession } from '@/lib/api/require-session';
import { validateAdminRequest } from '@/lib/security/config';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

async function readSessionSnapshot(supabase: NonNullable<ReturnType<typeof createServerSupabaseClient>>, sessionId: string) {
  return supabase
    .from('sessions')
    .select('id, status, source_url, telegram_thread_id, contact_name, contact_company, created_at')
    .eq('id', sessionId)
    .maybeSingle();
}

export async function OPTIONS(request: Request) {
  return corsOptionsResponse(request);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('id');

  if (!sessionId) {
    const authResult = await requireSession(request);

    if (!authResult.ok) {
      if (authResult.response.status === 401 || authResult.response.status === 403) {
        return jsonWithCors({ ok: true, exists: false }, undefined, request);
      }

      return authResult.response;
    }

    const { data, error } = await readSessionSnapshot(authResult.supabase, authResult.auth.sessionId);

    if (error) {
      return jsonWithCors({ ok: false, error: 'session_inspect_failed' }, { status: 500 }, request);
    }

    if (!data) {
      return jsonWithCors({ ok: true, exists: false }, undefined, request);
    }

    return jsonWithCors({
      ok: true,
      exists: true,
      session: data
    }, undefined, request);
  }

  const authResult = validateAdminRequest(request);
  if (!authResult.ok) {
    return jsonWithCors({ ok: false, error: authResult.error }, { status: authResult.status }, request);
  }

  if (!hasSupabaseServerConfig()) {
    return jsonWithCors({ ok: false, error: 'Supabase not configured on this deployment' }, { status: 503 }, request);
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return jsonWithCors({ ok: false, error: 'Supabase client failed' }, { status: 503 }, request);
  }

  const { data, error } = await readSessionSnapshot(supabase, sessionId);

  if (error) {
    return jsonWithCors({ ok: false, error: 'session_inspect_failed' }, { status: 500 }, request);
  }

  if (!data) {
    return jsonWithCors({
      ok: true,
      exists: false,
      sessionId,
      message: 'Session not found in DB. The widget is likely using a mock UUID from before Supabase was configured, or a stale session ID. Hard-refresh the widget to get a fresh session.'
    }, undefined, request);
  }

  return jsonWithCors({
    ok: true,
    exists: true,
    session: data
  }, undefined, request);
}
