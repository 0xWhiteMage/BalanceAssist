import { NextResponse } from 'next/server';
import { validateAdminRequestAny } from '@/lib/security/config';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

const workers = new Set(['handoff-dispatch', 'session-expiry']);

export async function POST(request: Request) {
  const auth = validateAdminRequestAny(request, ['CRON_SECRET', 'INTERNAL_DISPATCH_SECRET']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!hasSupabaseServerConfig()) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { worker?: unknown } | null;
  if (!body || typeof body.worker !== 'string' || !workers.has(body.worker)) {
    return NextResponse.json({ ok: false, error: 'Unknown scheduler worker' }, { status: 400 });
  }
  const supabase = createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  const { error } = await supabase.rpc('record_scheduler_heartbeat', { p_worker: body.worker });
  if (error) return NextResponse.json({ ok: false, error: 'Heartbeat recording failed' }, { status: 500 });
  return NextResponse.json({ ok: true, worker: body.worker });
}
