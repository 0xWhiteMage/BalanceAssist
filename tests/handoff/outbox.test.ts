import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimNextHandoff, generateIdempotencyKey, getPendingHandoffs, markFailed } from '@/lib/handoff/outbox';

type OutboxRow = {
  id: string;
  session_id: string;
  payload: {
    sessionId: string;
    type: 'approval' | 'relay';
    summary: string;
    threadId?: number | null;
  };
  state: 'pending' | 'claiming' | 'sent' | 'failed' | 'escalated';
  attempts: number;
  created_at: string;
  updated_at: string;
  next_attempt_at: string;
  claim_expires_at?: string | null;
  last_error?: string | null;
};

function createOutboxSupabase(rows: OutboxRow[]) {
  const byId = new Map(rows.map((row) => [row.id, { ...row }]));

  const supabase = {
    from(table: string) {
      if (table !== 'handoff_outbox') {
        throw new Error(`Unexpected table ${table}`);
      }

      return {
        select(columns: string) {
          const filters: Array<{ type: 'eq' | 'lte'; column: string; value: string }> = [];

          const builder = {
            eq(column: string, value: string) {
              filters.push({ type: 'eq', column, value });
              return builder;
            },
            lte(column: string, value: string) {
              filters.push({ type: 'lte', column, value });
              return builder;
            },
            order() {
              return builder;
            },
            limit(limit: number) {
              const data = applyFilters(columns, filters).slice(0, limit);
              return Promise.resolve({ data, error: null });
            },
            maybeSingle() {
              const data = applyFilters(columns, filters)[0] ?? null;
              return Promise.resolve({ data, error: null });
            }
          };

          return builder;
        },
        update(payload: Record<string, unknown>) {
          const filters: Array<{ type: 'eq' | 'lte'; column: string; value: string }> = [];

          const builder = {
            eq(column: string, value: string) {
              filters.push({ type: 'eq', column, value });
              return builder;
            },
            lte(column: string, value: string) {
              filters.push({ type: 'lte', column, value });
              return builder;
            },
            select(columns: string) {
              return {
                maybeSingle: async () => {
                  const rows = getMatchingRows(filters);
                  const row = rows[0] ?? null;
                  if (!row) {
                    return { data: null, error: null };
                  }

                  Object.assign(row, payload);
                  const result: Record<string, unknown> = {};
                  for (const column of columns.split(',').map((entry) => entry.trim())) {
                    result[column] = row[column as keyof OutboxRow];
                  }
                  return { data: result, error: null };
                }
              };
            },
            then(resolve: (value: { error: null }) => unknown) {
              const rows = getMatchingRows(filters);
              for (const row of rows) {
                Object.assign(row, payload);
              }
              return Promise.resolve({ error: null }).then(resolve);
            }
          };

          return builder;
        }
      };
    }
  };

  function getMatchingRows(filters: Array<{ type: 'eq' | 'lte'; column: string; value: string }>) {
    return [...byId.values()].filter((row) => {
      return filters.every((filter) => {
        const rowValue = row[filter.column as keyof OutboxRow];
        if (filter.type === 'eq') {
          return rowValue === filter.value;
        }
        if (typeof rowValue !== 'string') {
          return false;
        }
        return new Date(rowValue).getTime() <= new Date(filter.value).getTime();
      });
    });
  }

  function applyFilters(columns: string, filters: Array<{ type: 'eq' | 'lte'; column: string; value: string }>) {
    const selectedColumns = columns.split(',').map((column) => column.trim());
    const filtered = [...byId.values()].filter((row) => {
      return filters.every((filter) => {
        const rowValue = row[filter.column as keyof OutboxRow];
        if (filter.type === 'eq') {
          return rowValue === filter.value;
        }
        if (typeof rowValue !== 'string') {
          return false;
        }
        return new Date(rowValue).getTime() <= new Date(filter.value).getTime();
      });
    });

    return filtered.map((row) => {
      const result: Record<string, unknown> = {};
      for (const column of selectedColumns) {
        result[column] = row[column as keyof OutboxRow];
      }
      return result;
    });
  }

  return { supabase, byId };
}

describe('handoff/outbox', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-11T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateIdempotencyKey', () => {
    it('generates a deterministic key for same inputs', () => {
      const a = generateIdempotencyKey('session-1', 'approval', 'summary text');
      const b = generateIdempotencyKey('session-1', 'approval', 'summary text');
      expect(a).toBe(b);
    });

    it('generates different keys for different sessions', () => {
      const a = generateIdempotencyKey('session-1', 'approval', 'same');
      const b = generateIdempotencyKey('session-2', 'approval', 'same');
      expect(a).not.toBe(b);
    });

    it('generates different keys for different types', () => {
      const a = generateIdempotencyKey('session-1', 'approval', 'same');
      const b = generateIdempotencyKey('session-1', 'relay', 'same');
      expect(a).not.toBe(b);
    });

    it('starts with ho_ prefix', () => {
      const key = generateIdempotencyKey('s', 't', 'd');
      expect(key).toMatch(/^ho_/);
    });
  });

  describe('markFailed', () => {
    it('keeps retryable handoffs pending and schedules the first retry window', async () => {
      const harness = createOutboxSupabase([
        {
          id: 'ho-1',
          session_id: 'session-1',
          payload: { sessionId: 'session-1', type: 'approval', summary: 'Hello' },
          state: 'pending',
          attempts: 0,
          created_at: '2026-07-11T11:59:00.000Z',
          updated_at: '2026-07-11T11:59:00.000Z',
          next_attempt_at: '2026-07-11T11:59:00.000Z',
          last_error: null
        }
      ]);

      const outcome = await markFailed(harness.supabase as never, 'ho-1', 'Telegram send failed');
      const row = harness.byId.get('ho-1');

      expect(outcome).toEqual({ shouldRetry: true, escalated: false, retryDelayMs: 300_000 });
      expect(row).toMatchObject({
        state: 'pending',
        attempts: 1,
        last_error: 'Telegram send failed'
      });
      expect(row?.next_attempt_at).toBe('2026-07-11T12:05:00.000Z');
    });

    it('marks the row failed when all four delivery attempts are exhausted', async () => {
      const harness = createOutboxSupabase([
        {
          id: 'ho-2',
          session_id: 'session-2',
          payload: { sessionId: 'session-2', type: 'approval', summary: 'Hello' },
          state: 'pending',
          attempts: 3,
          created_at: '2026-07-11T11:59:00.000Z',
          updated_at: '2026-07-11T11:59:00.000Z',
          next_attempt_at: '2026-07-11T11:59:00.000Z',
          last_error: null
        }
      ]);

      const outcome = await markFailed(harness.supabase as never, 'ho-2', 'still failing');
      const row = harness.byId.get('ho-2');

      expect(outcome).toEqual({ shouldRetry: false, escalated: false, retryDelayMs: 0 });
      expect(row).toMatchObject({
        state: 'failed',
        attempts: 4,
        last_error: 'still failing'
      });
    });

    it('escalates on the fourth normal five-minute dispatch evaluation', async () => {
      const harness = createOutboxSupabase([
        {
          id: 'ho-timeline-normal',
          session_id: 'session-timeline-normal',
          payload: { sessionId: 'session-timeline-normal', type: 'approval', summary: 'Hello' },
          state: 'pending',
          attempts: 0,
          created_at: '2026-07-11T12:00:00.000Z',
          updated_at: '2026-07-11T12:00:00.000Z',
          next_attempt_at: '2026-07-11T12:00:00.000Z',
          last_error: null
        }
      ]);

      expect(await markFailed(harness.supabase as never, 'ho-timeline-normal', 'failed')).toMatchObject({
        shouldRetry: true,
        retryDelayMs: 300_000
      });

      vi.setSystemTime(new Date('2026-07-11T12:05:00.000Z'));
      expect(await markFailed(harness.supabase as never, 'ho-timeline-normal', 'failed')).toMatchObject({
        shouldRetry: true,
        retryDelayMs: 300_000
      });

      vi.setSystemTime(new Date('2026-07-11T12:10:00.000Z'));
      expect(await markFailed(harness.supabase as never, 'ho-timeline-normal', 'failed')).toMatchObject({
        shouldRetry: true,
        retryDelayMs: 300_000
      });

      vi.setSystemTime(new Date('2026-07-11T12:15:00.000Z'));
      expect(await markFailed(harness.supabase as never, 'ho-timeline-normal', 'failed')).toEqual({
        shouldRetry: false,
        escalated: true,
        retryDelayMs: 0
      });
    });

    it('escalates when dispatch evaluations run slightly after cron boundaries', async () => {
      const harness = createOutboxSupabase([
        {
          id: 'ho-timeline-delayed',
          session_id: 'session-timeline-delayed',
          payload: { sessionId: 'session-timeline-delayed', type: 'approval', summary: 'Hello' },
          state: 'pending',
          attempts: 0,
          created_at: '2026-07-11T12:00:00.000Z',
          updated_at: '2026-07-11T12:00:00.000Z',
          next_attempt_at: '2026-07-11T12:00:00.000Z',
          last_error: null
        }
      ]);

      for (const time of ['2026-07-11T12:00:20.000Z', '2026-07-11T12:05:20.000Z', '2026-07-11T12:10:20.000Z']) {
        vi.setSystemTime(new Date(time));
        expect(await markFailed(harness.supabase as never, 'ho-timeline-delayed', 'failed')).toMatchObject({
          shouldRetry: true,
          escalated: false,
          retryDelayMs: 300_000
        });
      }

      vi.setSystemTime(new Date('2026-07-11T12:15:20.000Z'));
      expect(await markFailed(harness.supabase as never, 'ho-timeline-delayed', 'failed')).toEqual({
        shouldRetry: false,
        escalated: true,
        retryDelayMs: 0
      });
    });

    it('marks stale rows escalated instead of retrying again', async () => {
      const harness = createOutboxSupabase([
        {
          id: 'ho-3',
          session_id: 'session-3',
          payload: { sessionId: 'session-3', type: 'approval', summary: 'Hello' },
          state: 'pending',
          attempts: 0,
          created_at: '2026-07-11T11:40:00.000Z',
          updated_at: '2026-07-11T11:40:00.000Z',
          next_attempt_at: '2026-07-11T11:40:00.000Z',
          last_error: null
        }
      ]);

      const outcome = await markFailed(harness.supabase as never, 'ho-3', 'timed out');
      const row = harness.byId.get('ho-3');

      expect(outcome).toEqual({ shouldRetry: false, escalated: true, retryDelayMs: 0 });
      expect(row).toMatchObject({
        state: 'escalated',
        attempts: 1,
        last_error: 'timed out'
      });
    });
  });

  describe('getPendingHandoffs', () => {
    it('returns only pending rows whose retry window is due', async () => {
      const harness = createOutboxSupabase([
        {
          id: 'due-now',
          session_id: 'session-1',
          payload: { sessionId: 'session-1', type: 'approval', summary: 'Due now' },
          state: 'pending',
          attempts: 1,
          created_at: '2026-07-11T11:59:00.000Z',
          updated_at: '2026-07-11T11:59:00.000Z',
          next_attempt_at: '2026-07-11T12:00:00.000Z',
          last_error: 'boom'
        },
        {
          id: 'not-due-yet',
          session_id: 'session-2',
          payload: { sessionId: 'session-2', type: 'approval', summary: 'Later' },
          state: 'pending',
          attempts: 1,
          created_at: '2026-07-11T11:59:00.000Z',
          updated_at: '2026-07-11T11:59:00.000Z',
          next_attempt_at: '2026-07-11T12:05:00.000Z',
          last_error: 'boom'
        },
        {
          id: 'already-sent',
          session_id: 'session-3',
          payload: { sessionId: 'session-3', type: 'approval', summary: 'Done' },
          state: 'sent',
          attempts: 0,
          created_at: '2026-07-11T11:59:00.000Z',
          updated_at: '2026-07-11T11:59:00.000Z',
          next_attempt_at: '2026-07-11T11:59:00.000Z',
          last_error: null
        }
      ]);

      const result = await getPendingHandoffs(harness.supabase as never, 10);

      expect(result).toEqual([
        {
          id: 'due-now',
          session_id: 'session-1',
          payload: { sessionId: 'session-1', type: 'approval', summary: 'Due now' }
        }
      ]);
    });
  });

  describe('claimNextHandoff', () => {
    it('reclaims an expired claiming row and extends its lease', async () => {
      const harness = createOutboxSupabase([
        {
          id: 'expired-claim',
          session_id: 'session-lease',
          payload: { sessionId: 'session-lease', type: 'approval', summary: 'Lease expired' },
          state: 'claiming',
          attempts: 1,
          created_at: '2026-07-11T11:58:00.000Z',
          updated_at: '2026-07-11T11:59:00.000Z',
          next_attempt_at: '2026-07-11T11:59:00.000Z',
          claim_expires_at: '2026-07-11T11:59:30.000Z',
          last_error: null
        }
      ]);

      const claimed = await claimNextHandoff(harness.supabase as never);
      const row = harness.byId.get('expired-claim');

      expect(claimed).toMatchObject({
        id: 'expired-claim',
        session_id: 'session-lease',
        payload: { sessionId: 'session-lease', type: 'approval', summary: 'Lease expired' }
      });
      expect(row?.state).toBe('claiming');
      expect(row?.claim_expires_at).toBe('2026-07-11T12:01:00.000Z');
    });

    it('does not steal an active claiming row whose lease is still valid', async () => {
      const harness = createOutboxSupabase([
        {
          id: 'active-claim',
          session_id: 'session-active',
          payload: { sessionId: 'session-active', type: 'approval', summary: 'Still leased' },
          state: 'claiming',
          attempts: 1,
          created_at: '2026-07-11T11:58:00.000Z',
          updated_at: '2026-07-11T11:59:30.000Z',
          next_attempt_at: '2026-07-11T11:59:00.000Z',
          claim_expires_at: '2026-07-11T12:05:00.000Z',
          last_error: null
        }
      ]);

      const claimed = await claimNextHandoff(harness.supabase as never);
      expect(claimed).toBeNull();
    });
  });
});
