import { NextResponse } from 'next/server';
import { validateAdminRequestAny } from '@/lib/security/config';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { privateUploadBucketFromEnv } from '@/lib/uploads/private-storage';

type DeletionJob = { id: string; session_id: string | null; cleanup_owner_id: string | null; lease_token: string | null };
const CLEANUP_PAGE_SIZE = 100;

export async function POST(request: Request) {
  const auth = validateAdminRequestAny(request, ['CRON_SECRET', 'INTERNAL_DISPATCH_SECRET']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!hasSupabaseServerConfig()) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  const supabase = createServerSupabaseClient();
  const bucket = privateUploadBucketFromEnv();
  if (!supabase || !bucket) return NextResponse.json({ ok: false, error: 'Deletion worker unavailable' }, { status: 503 });
  const db = supabase as any;
  const claimed = await db.rpc('claim_deletion_job', { p_lease_seconds: 300 });
  const job = claimed.data as DeletionJob | null;
  if (claimed.error) return NextResponse.json({ ok: false, error: 'Deletion claim failed' }, { status: 503 });
  if (!job?.id || !job.lease_token) return NextResponse.json({ ok: true, processed: false });
  if (!job.session_id) {
    const completed = await db.rpc('complete_orphaned_deletion_job', { p_job_id: job.id, p_lease_token: job.lease_token });
    return NextResponse.json({ ok: completed.data === true, processed: completed.data === true, status: completed.data === true ? 'completed' : 'deferred' }, { status: completed.data === true ? 200 : 503 });
  }

  const fail = async () => {
    await db.rpc('fail_deletion_job', { p_job_id: job.id, p_lease_token: job.lease_token });
    return NextResponse.json({ ok: false, error: 'Deletion deferred' }, { status: 503 });
  };
  if (!job.cleanup_owner_id) return fail();
  const started = await db.rpc('start_deletion_job', { p_job_id: job.id, p_lease_token: job.lease_token });
  if (started.error || !started.data) return fail();
  try {
    while (true) {
      const files = await db.from('uploaded_files').select('id, object_key').eq('session_id', job.session_id).limit(CLEANUP_PAGE_SIZE);
      if (files.error) return fail();
      if (!(files.data ?? []).length) break;
      for (const file of files.data) {
        if (!file.id || !file.object_key) return fail();
        const removed = await db.storage.from(bucket).remove([file.object_key]);
        if (removed.error) return fail();
        const deleted = await db.from('uploaded_files').delete().eq('id', file.id);
        if (deleted.error) return fail();
      }
    }
    while (true) {
      const recovery = await db.from('private_attachment_cleanup').select('object_key').eq('cleanup_owner_id', job.cleanup_owner_id).eq('bucket', bucket).limit(CLEANUP_PAGE_SIZE);
      if (recovery.error) return fail();
      if (!(recovery.data ?? []).length) break;
      for (const record of recovery.data) {
        if (!record.object_key) return fail();
        const removed = await db.storage.from(bucket).remove([record.object_key]);
        if (removed.error) return fail();
        const deleted = await db.from('private_attachment_cleanup').delete().eq('object_key', record.object_key);
        if (deleted.error) return fail();
      }
    }
    const deletedSession = await db.rpc('delete_session_for_deletion_job', { p_job_id: job.id, p_lease_token: job.lease_token });
    if (deletedSession.error || !deletedSession.data) return fail();
    const completed = await db.rpc('complete_deletion_job', { p_job_id: job.id, p_lease_token: job.lease_token });
    if (completed.error || !completed.data) return NextResponse.json({ ok: false, error: 'Deletion completion deferred' }, { status: 503 });
    return NextResponse.json({ ok: true, processed: true, jobId: job.id, status: 'completed' });
  } catch {
    return fail();
  }
}
