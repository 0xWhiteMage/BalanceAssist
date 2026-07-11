import { NextResponse } from 'next/server';
import { createServerSupabaseClient, hasSupabaseServerConfig } from '@/lib/supabase/server';
import { getPendingHandoffs, markDelivered, markFailed } from '@/lib/handoff/outbox';
import { sendTelegramMessage } from '@/lib/telegram';

export async function POST(request: Request) {
  // Basic auth check — only internal callers should hit this
  const authHeader = request.headers.get('authorization');
  const internalSecret = process.env.INTERNAL_DISPATCH_SECRET;

  if (internalSecret) {
    const provided = authHeader?.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7)
      : authHeader;
    if (provided !== internalSecret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  if (!hasSupabaseServerConfig()) {
    return NextResponse.json({ ok: false, error: 'Supabase not configured' }, { status: 503 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: 'Supabase client failed' }, { status: 503 });
  }

  const pending = await getPendingHandoffs(supabase, 5);
  const results: Array<{ id: string; status: string }> = [];

  for (const handoff of pending) {
    try {
      const { payload } = handoff;

      if (payload.type === 'approval' || payload.type === 'relay') {
        const result = await sendTelegramMessage(payload.summary, {
          threadId: payload.threadId ?? undefined
        });

        if (result) {
          await markDelivered(supabase, handoff.id);
          results.push({ id: handoff.id, status: 'sent' });
        } else {
          await markFailed(supabase, handoff.id, 'Telegram send failed');
          results.push({ id: handoff.id, status: 'failed' });
        }
      } else {
        await markFailed(supabase, handoff.id, `Unknown handoff type: ${payload.type}`);
        results.push({ id: handoff.id, status: 'failed' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await markFailed(supabase, handoff.id, message);
      results.push({ id: handoff.id, status: 'failed' });
    }
  }

  return NextResponse.json({
    ok: true,
    processed: results.length,
    results
  });
}
