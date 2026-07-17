import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { jsonWithCors } from '@/lib/api/route-helpers';

const requestSchema = z.object({
  receipt: z.string().min(3).max(256)
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonWithCors({ ok: false, code: 'INVALID_DELETION_RECEIPT' }, { status: 400 }, request);
  }

  const separator = parsed.data.receipt.indexOf('.');
  if (separator <= 0 || separator === parsed.data.receipt.length - 1) {
    return jsonWithCors({ ok: false, code: 'INVALID_DELETION_RECEIPT' }, { status: 400 }, request);
  }

  const receiptId = parsed.data.receipt.slice(0, separator);
  const secret = parsed.data.receipt.slice(separator + 1);
  const receiptHash = createHash('sha256').update(secret).digest('hex');
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return jsonWithCors({ ok: false, code: 'DELETION_STATUS_UNAVAILABLE' }, { status: 503 }, request);
  }

  const { data, error } = await supabase.rpc('get_session_deletion_status', {
    p_receipt_id: receiptId,
    p_receipt_hash: receiptHash
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error) {
    return jsonWithCors({ ok: false, code: 'DELETION_STATUS_UNAVAILABLE' }, { status: 503 }, request);
  }
  if (!row) {
    return jsonWithCors({ ok: false, code: 'DELETION_RECEIPT_NOT_FOUND' }, { status: 404 }, request);
  }

  const status = row as Record<string, unknown>;
  return jsonWithCors({
    ok: true,
    receiptId: status.receipt_id,
    status: status.status,
    requestedAt: status.requested_at,
    updatedAt: status.updated_at,
    completedAt: status.completed_at ?? null,
    failedAt: status.failed_at ?? null
  }, { headers: { 'Cache-Control': 'no-store, private' } }, request);
}
