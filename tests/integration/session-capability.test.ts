// @vitest-environment node

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { extractSessionIdFromCapability } from '@/lib/security/session-capability';

const { hasSupabaseServerConfigMock, createServerSupabaseClientMock } = vi.hoisted(() => ({
  hasSupabaseServerConfigMock: vi.fn(),
  createServerSupabaseClientMock: vi.fn()
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: hasSupabaseServerConfigMock,
  createServerSupabaseClient: createServerSupabaseClientMock
}));

import { POST } from '@/app/api/sessions/route';
import { requireSession } from '@/lib/api/require-session';

const connectionString = process.env.TEST_DATABASE_URL;
let client: import('pg').Client | undefined;
const originalTrustedClientIpHeader = process.env.TRUSTED_CLIENT_IP_HEADER;

describe.skipIf(!connectionString)('persisted session capabilities', () => {
  beforeAll(async () => {
    const { Client } = await import('pg');
    client = new Client({ connectionString });
    await client.connect();
    hasSupabaseServerConfigMock.mockReturnValue(true);
    createServerSupabaseClientMock.mockImplementation(() => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        const result = await client!.query(
          `select * from public.${name}($1, $2, $3)`,
          [args.p_key_hash, args.p_limit, args.p_window_seconds]
        );
        return { data: result.rows, error: null };
      },
      from: () => ({
        insert: (session: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const result = await client!.query(
                `insert into sessions (id, source_url, referrer, utm, consent_version, consented_at, status, capability_hash, capability_expires_at)
                 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 returning id, status, source_url, created_at`,
                [
                  session.id,
                  session.source_url,
                  session.referrer,
                  session.utm,
                  session.consent_version,
                  session.consented_at,
                  session.status,
                  session.capability_hash,
                  session.capability_expires_at
                ]
              );
              return { data: result.rows[0], error: null };
            }
          })
        }),
        select: () => ({
          eq: (_column: string, sessionId: string) => ({
            maybeSingle: async () => {
              const result = await client!.query(
                'select capability_hash, capability_expires_at from sessions where id = $1',
                [sessionId]
              );
              return { data: result.rows[0] ?? null, error: null };
            }
          })
        })
      })
    }));
  });

  afterAll(async () => {
    await client?.end();
  });

  afterEach(() => {
    if (originalTrustedClientIpHeader === undefined) delete process.env.TRUSTED_CLIENT_IP_HEADER;
    else process.env.TRUSTED_CLIENT_IP_HEADER = originalTrustedClientIpHeader;
  });

  it('authenticates the returned capability only for its persisted session ID', async () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'x-vercel-forwarded-for';
    const createRequest = new NextRequest('https://www.balancestudio.tv/api/sessions', {
      method: 'POST',
      headers: { origin: 'https://www.balancestudio.tv', 'x-vercel-forwarded-for': '198.18.0.1' },
      body: JSON.stringify({
        sourceUrl: 'https://www.balancestudio.tv',
        consentVersion: '1.2',
        consentedAt: '2026-07-13T10:00:00.000Z'
      })
    });
    const createResponse = await POST(createRequest);
    const created = await createResponse.json() as { sessionId: string };
    const capability = createResponse.headers.get('set-cookie')?.match(/session_capability=([^;]+)/)?.[1];
    const sessionId = created.sessionId;

    try {
      expect(createResponse.status).toBe(200);
      expect(extractSessionIdFromCapability(capability ?? '')).toBe(sessionId);

      const authorized = await requireSession(new NextRequest('https://www.balancestudio.tv/api/sessions/inspect', {
        headers: { 'x-session-capability': capability ?? '' }
      }));
      expect(authorized.ok).toBe(true);

      const mismatchedCapability = `${crypto.randomUUID()}.${capability?.split('.').slice(1).join('.')}`;
      const rejected = await requireSession(new NextRequest('https://www.balancestudio.tv/api/sessions/inspect', {
        headers: { 'x-session-capability': mismatchedCapability }
      }));
      expect(rejected.ok).toBe(false);
    } finally {
      await client!.query('delete from sessions where id = $1', [sessionId]);
    }
  });
});
