import { corsOptionsResponse, jsonWithCors } from '@/lib/api/route-helpers';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { validateAdminRequest } from '@/lib/security/config';

export async function OPTIONS() {
  return corsOptionsResponse();
}

export async function GET(request: Request) {
  const authResult = validateAdminRequest(request);
  if (!authResult.ok) {
    return jsonWithCors({ ok: false, error: authResult.error }, { status: authResult.status });
  }

  if (!hasSupabaseServerConfig()) {
    return jsonWithCors({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return jsonWithCors({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  }

  const { data: sessionRows } = await supabase
    .from('sessions')
    .select('id, telegram_thread_id, status, contact_name, contact_company, created_at')
    .not('telegram_thread_id', 'is', null);

  const { data: messageRows } = await supabase
    .from('human_messages')
    .select('session_id, telegram_thread_id')
    .not('telegram_thread_id', 'is', null);

  const sessions = (sessionRows ?? []) as Array<{
    id: string;
    telegram_thread_id: number | null;
    status: string;
    contact_name: string | null;
    contact_company: string | null;
    created_at: string;
  }>;

  const sessionThreadIds = new Set<number>();
  for (const row of sessions) {
    if (row.telegram_thread_id !== null) sessionThreadIds.add(row.telegram_thread_id);
  }

  const orphanThreadIds = new Set<number>();
  const seen = new Set<number>();
  for (const row of (messageRows ?? []) as Array<{ telegram_thread_id: number | null }>) {
    if (row.telegram_thread_id !== null && !sessionThreadIds.has(row.telegram_thread_id) && !seen.has(row.telegram_thread_id)) {
      seen.add(row.telegram_thread_id);
      orphanThreadIds.add(row.telegram_thread_id);
    }
  }

  return jsonWithCors({
    ok: true,
    sessions: sessions.map((row) => ({
      id: row.id,
      threadId: row.telegram_thread_id,
      status: row.status,
      contactName: row.contact_name,
      contactCompany: row.contact_company,
      createdAt: row.created_at
    })),
    orphanThreadIdsFromMessages: Array.from(orphanThreadIds)
  });
}