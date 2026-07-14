import { describe, expect, test, vi } from 'vitest';
import { getSessionConsent } from '@/lib/privacy/session-consent';

describe('getSessionConsent', () => {
  test('uses the most recent ledger transition for each scope', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(async () => ({
              data: [
                { scope: 'analysis', granted: true, created_at: '2026-07-13T10:00:00.000Z' },
                { scope: 'producer_transfer', granted: true, created_at: '2026-07-13T10:01:00.000Z' },
                { scope: 'analysis', granted: false, created_at: '2026-07-13T10:02:00.000Z' }
              ],
              error: null
            }))
          }))
        }))
      }))
    };

    await expect(getSessionConsent(client as never, 'session-1')).resolves.toEqual({
      analysis: false,
      producerTransfer: true
    });
  });

  test('breaks equal transition timestamps by ledger id deterministically', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(async () => ({
              data: [
                { scope: 'analysis', granted: false, created_at: '2026-07-13T10:00:00.000Z', id: '00000000-0000-0000-0000-000000000002' },
                { scope: 'analysis', granted: true, created_at: '2026-07-13T10:00:00.000Z', id: '00000000-0000-0000-0000-000000000001' }
              ],
              error: null
            }))
          }))
        }))
      }))
    };

    await expect(getSessionConsent(client as never, 'session-1')).resolves.toEqual({
      analysis: false,
      producerTransfer: false
    });
  });

  test('fails closed when the ledger cannot be read', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(async () => ({ data: null, error: { message: 'unavailable' } }))
          }))
        }))
      }))
    };

    await expect(getSessionConsent(client as never, 'session-1')).rejects.toThrow('session_consent_query_failed');
  });
});
