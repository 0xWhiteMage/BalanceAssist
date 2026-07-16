import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { getSessionConsent } from '@/lib/privacy/session-consent';

const lifecycleMigrationPath = resolve(process.cwd(), 'supabase/migrations/049_monday_crm_lifecycle.sql');
const deletionRunbookPath = resolve(process.cwd(), 'docs/deletion-processing-runbook.md');

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
                { scope: 'human_contact', granted: true, created_at: '2026-07-13T10:01:30.000Z' },
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
      producerTransfer: true,
      humanContact: true
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
      producerTransfer: false,
      humanContact: false
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

describe('Monday consent revocation migration', () => {
  test('suppresses unsent projections and queues cleanup for transferred records', () => {
    const migration = readFileSync(lifecycleMigrationPath, 'utf8');

    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.record_session_consent/i);
    expect(migration).toMatch(/p_scope = 'producer_transfer' AND NOT p_granted/i);
    expect(migration).toMatch(/state = 'suppressed'.*state IN \('pending', 'claiming'\)/is);
    expect(migration).toMatch(/lifecycle_state = 'deletion_requested'/i);
    expect(migration).toMatch(/crm_lead_id, revision, operation\).*'delete'/is);
  });

  test('documents a concrete, PII-safe identity-verification procedure for post-session DSRs', () => {
    const runbook = readFileSync(deletionRunbookPath, 'utf8');

    expect(runbook).toMatch(/verify.*previously approved contact method/i);
    expect(runbook).toMatch(/independent.*privacy.*reviewer/i);
    expect(runbook).toMatch(/opaque CRM ID.*restricted/i);
    expect(runbook).toMatch(/do not.*record.*PII/i);
  });
});
