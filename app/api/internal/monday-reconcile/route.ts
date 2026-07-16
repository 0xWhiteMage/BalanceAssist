import { NextResponse } from 'next/server';

import schema from '../../../../config/monday-crm-schema.json';
import { getMondayConfig } from '@/lib/monday/config';
import { scanMondayBoardPage, verifyMondaySchema } from '@/lib/monday/client';
import { claimMondayReconciliationPage, finishMondayReconciliation, recordMondayReconciledItem, recordMondayReconciliationCursor } from '@/lib/monday/outbox';
import { validateAdminRequestAny } from '@/lib/security/config';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';

export async function POST(request: Request) {
  const auth = validateAdminRequestAny(request, ['CRON_SECRET', 'INTERNAL_DISPATCH_SECRET']);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!hasSupabaseServerConfig()) return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  const supabase = createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  try {
    getMondayConfig();
    await verifyMondaySchema(schema);
  } catch {
    return NextResponse.json({ ok: false, error: 'Monday schema unavailable' }, { status: 503 });
  }

  const checkpoint = await claimMondayReconciliationPage(supabase);
  if (!checkpoint) return NextResponse.json({ ok: true, processed: 0, status: 'busy' });
  try {
    const page = await scanMondayBoardPage(checkpoint.cursor);
    const duplicateKeys = new Set<string>();
    const seenKeys = new Set<string>();
    for (const item of page.items) {
      if (item.boardId !== schema.boardId || !item.crmRecordId) continue;
      if (seenKeys.has(item.crmRecordId)) duplicateKeys.add(item.crmRecordId);
      seenKeys.add(item.crmRecordId);
    }
    for (const item of page.items) {
      if (item.boardId !== schema.boardId || !item.crmRecordId) continue;
      await recordMondayReconciledItem(supabase, checkpoint.id, {
        itemId: item.id,
        crmRecordId: item.crmRecordId,
        active: item.state === 'active' && !duplicateKeys.has(item.crmRecordId),
        sourceDrift: item.sourceColumnTexts.some(Boolean),
      });
    }
    if (!await recordMondayReconciliationCursor(supabase, checkpoint.id, page.cursor)) throw new Error('checkpoint unavailable');
    const finished = page.cursor === null ? await finishMondayReconciliation(supabase, checkpoint.id) : null;
    return NextResponse.json({ ok: true, processed: page.items.length, status: page.cursor === null ? 'completed' : 'continued', repairs: finished?.repairs ?? 0 });
  } catch {
    return NextResponse.json({ ok: false, error: 'Monday reconciliation failed' }, { status: 503 });
  }
}
