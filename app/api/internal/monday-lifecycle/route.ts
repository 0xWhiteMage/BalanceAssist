import { NextResponse } from 'next/server';

import { validateAdminRequestAny } from '@/lib/security/config';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

const PAGE_SIZE = 100;
const DEADLINE_MS = 25_000;

export async function POST(request: Request) {
  const auth = validateAdminRequestAny(request, ['CRON_SECRET', 'INTERNAL_DISPATCH_SECRET']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!hasSupabaseServerConfig()) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  const supabase = createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ ok: false, error: 'Lifecycle worker unavailable' }, { status: 503 });

  let processed = 0;
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    const queued = await (supabase as any).rpc('queue_expired_crm_leads', { p_limit: PAGE_SIZE });
    if (queued.error || typeof queued.data !== 'number' || queued.data < 0) {
      return NextResponse.json({ ok: false, error: 'Lifecycle queue failed' }, { status: 503 });
    }
    processed += queued.data;
    if (queued.data < PAGE_SIZE) break;
  }
  return NextResponse.json({ ok: true, processed });
}
