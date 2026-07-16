import { NextResponse } from 'next/server';
import { validateAdminRequestAny } from '@/lib/security/config';
import { getMondayConfig } from '@/lib/monday/config';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

type SchedulerHealth = {
  healthy: boolean;
  stale_workers: string[];
  oldest_pending_outbox_seconds: number | null;
  expired_session_backlog: number;
  oldest_pending_deletion_seconds: number | null;
  pending_deletion_count: number;
  oldest_pending_monday_seconds: number | null;
  monday_delivery_unknown_count: number;
  monday_conflict_count: number;
  monday_failed_count: number;
  monday_expired_lease_count: number;
  monday_schema_incident_count: number;
  monday_permission_incident_count: number;
  monday_rate_limited_count: number;
  oldest_pending_monday_deletion_seconds: number | null;
  overdue_crm_review_count: number;
  oldest_overdue_crm_review_seconds: number | null;
};

export async function GET(request: Request) {
  const auth = validateAdminRequestAny(request, ['CRON_SECRET', 'INTERNAL_DISPATCH_SECRET']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!hasSupabaseServerConfig()) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  const supabase = createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  let monday;
  try {
    monday = getMondayConfig();
  } catch {
    return NextResponse.json({ ok: false, error: 'Monday configuration invalid' }, { status: 503 });
  }
  const mondayEnabled = monday.upsertEnabled || monday.cleanupEnabled;
  const { data, error } = await supabase.rpc('scheduler_health', {
    p_monday_dispatch_enabled: mondayEnabled,
    p_monday_lifecycle_enabled: mondayEnabled,
    p_monday_reconcile_enabled: mondayEnabled,
  });
  if (error || !data || typeof data !== 'object') return NextResponse.json({ ok: false, error: 'Scheduler health check failed' }, { status: 503 });
  const health = data as SchedulerHealth;
  const body = {
    ok: health.healthy === true,
    staleWorkers: Array.isArray(health.stale_workers) ? health.stale_workers : [],
    oldestPendingOutboxSeconds: typeof health.oldest_pending_outbox_seconds === 'number' ? health.oldest_pending_outbox_seconds : null,
    expiredSessionBacklog: typeof health.expired_session_backlog === 'number' ? health.expired_session_backlog : 0,
    oldestPendingDeletionSeconds: typeof health.oldest_pending_deletion_seconds === 'number' ? health.oldest_pending_deletion_seconds : null,
    pendingDeletionCount: typeof health.pending_deletion_count === 'number' ? health.pending_deletion_count : 0,
    oldestPendingMondaySeconds: typeof health.oldest_pending_monday_seconds === 'number' ? health.oldest_pending_monday_seconds : null,
    mondayDeliveryUnknownCount: typeof health.monday_delivery_unknown_count === 'number' ? health.monday_delivery_unknown_count : 0,
    mondayConflictCount: typeof health.monday_conflict_count === 'number' ? health.monday_conflict_count : 0,
    mondayFailedCount: typeof health.monday_failed_count === 'number' ? health.monday_failed_count : 0,
    mondayExpiredLeaseCount: typeof health.monday_expired_lease_count === 'number' ? health.monday_expired_lease_count : 0,
    mondaySchemaIncidentCount: typeof health.monday_schema_incident_count === 'number' ? health.monday_schema_incident_count : 0,
    mondayPermissionIncidentCount: typeof health.monday_permission_incident_count === 'number' ? health.monday_permission_incident_count : 0,
    mondayRateLimitedCount: typeof health.monday_rate_limited_count === 'number' ? health.monday_rate_limited_count : 0,
    oldestPendingMondayDeletionSeconds: typeof health.oldest_pending_monday_deletion_seconds === 'number' ? health.oldest_pending_monday_deletion_seconds : null,
    overdueCrmReviewCount: typeof health.overdue_crm_review_count === 'number' ? health.overdue_crm_review_count : 0,
    oldestOverdueCrmReviewSeconds: typeof health.oldest_overdue_crm_review_seconds === 'number' ? health.oldest_overdue_crm_review_seconds : null,
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}
