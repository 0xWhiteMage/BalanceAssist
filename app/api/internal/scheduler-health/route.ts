import { NextResponse } from 'next/server';
import { validateAdminRequestAny } from '@/lib/security/config';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

type SchedulerHealth = {
  healthy: boolean;
  stale_workers: string[];
  oldest_pending_outbox_seconds: number | null;
  expired_session_backlog: number;
  oldest_pending_deletion_seconds: number | null;
};

export async function GET(request: Request) {
  const auth = validateAdminRequestAny(request, ['CRON_SECRET', 'INTERNAL_DISPATCH_SECRET']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!hasSupabaseServerConfig()) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  const supabase = createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  const { data, error } = await supabase.rpc('scheduler_health');
  if (error || !data || typeof data !== 'object') return NextResponse.json({ ok: false, error: 'Scheduler health check failed' }, { status: 503 });
  const health = data as SchedulerHealth;
  const body = {
    ok: health.healthy === true,
    staleWorkers: Array.isArray(health.stale_workers) ? health.stale_workers : [],
    oldestPendingOutboxSeconds: typeof health.oldest_pending_outbox_seconds === 'number' ? health.oldest_pending_outbox_seconds : null,
    expiredSessionBacklog: typeof health.expired_session_backlog === 'number' ? health.expired_session_backlog : 0,
    oldestPendingDeletionSeconds: typeof health.oldest_pending_deletion_seconds === 'number' ? health.oldest_pending_deletion_seconds : null
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
