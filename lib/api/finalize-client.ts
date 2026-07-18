import { fetchJsonWithTimeout } from '@/lib/api/fetch';
import {
  finalizeLeadResponseSchema,
  type FinalizeLeadResponse
} from '@/lib/api/finalize-contracts';

export type { FinalizeLeadResponse } from '@/lib/api/finalize-contracts';

export async function finalizeLead(payload: { sessionId: string }): Promise<FinalizeLeadResponse | null> {
  const result = await fetchJsonWithTimeout('/api/leads/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true
  });
  if (!result?.response.ok) return null;

  const parsed = finalizeLeadResponseSchema.safeParse(result.body);
  return parsed.success ? parsed.data : null;
}
