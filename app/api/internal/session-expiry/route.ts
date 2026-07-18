import { NextResponse } from 'next/server';
import { validateAdminRequestAny } from '@/lib/security/config';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { emitEvent } from '@/lib/observability/events';
import { cleanupExpiredStoredUploads, privateUploadBucketFromEnv, type PrivateStorageClient } from '@/lib/uploads/private-storage';

export async function POST(request: Request) {
  const auth = validateAdminRequestAny(request, ['CRON_SECRET', 'INTERNAL_DISPATCH_SECRET']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!hasSupabaseServerConfig()) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  const supabase = createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  const bucket = privateUploadBucketFromEnv();
  let cleanup = { deleted: 0, failed: 0, deferredSessionIds: [] as string[], complete: true };
  if (bucket) {
    try {
      cleanup = await cleanupExpiredStoredUploads(supabase as unknown as PrivateStorageClient, bucket);
    } catch {
      return NextResponse.json({ ok: false, error: 'Private attachment cleanup failed' }, { status: 503 });
    }
    if (!cleanup.complete) return NextResponse.json({ ok: false, error: 'Private attachment cleanup incomplete' }, { status: 503 });
  }
  const { data, error } = bucket
    ? await supabase.rpc('purge_expired_temporary_sessions', { p_deferred_session_ids: cleanup.deferredSessionIds })
    : await supabase.rpc('purge_expired_temporary_sessions');
  if (error) return NextResponse.json({ ok: false, error: 'Expiry cleanup failed' }, { status: 500 });
  const replayPrune = await supabase.rpc('prune_processed_telegram_updates', {
    p_retention: '30 days',
    p_batch_size: 1000
  });
  if (replayPrune.error || typeof replayPrune.data !== 'number') {
    return NextResponse.json({ ok: false, error: 'Telegram replay cleanup failed' }, { status: 503 });
  }
  const counts = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const deletedSessions = typeof counts.deleted_sessions === 'number' ? counts.deleted_sessions : 0;
  const deferredSessions = typeof counts.deferred_sessions === 'number' ? counts.deferred_sessions : 0;
  const releasedClaims = typeof counts.released_claims === 'number' ? counts.released_claims : 0;
  emitEvent('temporary_sessions_expired', { deletedSessions, deferredSessions, releasedClaims });
  const prunedTelegramUpdates = replayPrune.data;
  if (!bucket) return NextResponse.json({ ok: true, deletedSessions, deferredSessions, releasedClaims, prunedTelegramUpdates });
  return NextResponse.json({ ok: true, deletedSessions, deferredSessions, releasedClaims, prunedTelegramUpdates, deletedStoredObjects: cleanup.deleted, failedStoredObjectDeletes: cleanup.failed });
}
