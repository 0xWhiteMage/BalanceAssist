import { NextResponse } from 'next/server';
import { validateAdminRequestAny } from '@/lib/security/config';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const auth = validateAdminRequestAny(request, ['CRON_SECRET', 'INTERNAL_DISPATCH_SECRET']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!hasSupabaseServerConfig()) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  const supabase = createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  const { data, error } = await supabase.rpc('purge_expired_temporary_sessions');
  if (error) return NextResponse.json({ ok: false, error: 'Expiry cleanup failed' }, { status: 500 });
  return NextResponse.json({ ok: true, deletedSessions: typeof data === 'number' ? data : 0 });
}
