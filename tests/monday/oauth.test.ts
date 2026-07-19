import { randomBytes } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';

import type { SupabaseServerClient } from '../../lib/supabase/server';
import { decryptMondaySecret, encryptMondaySecret } from '../../lib/monday/oauth-crypto';
import { completeMondayOAuthCallback, createMondayOAuthAttempt, disconnectMondayOAuthConnection, resolveMondayAccessToken } from '../../lib/monday/oauth';

const environment = {
  MONDAY_OAUTH_CLIENT_ID: 'oauth-client-id',
  MONDAY_OAUTH_CLIENT_SECRET: 'oauth-client-secret',
  MONDAY_OAUTH_REDIRECT_URI: 'https://example.com/api/internal/monday-oauth/callback',
  MONDAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};
const now = new Date('2026-07-20T12:00:00.000Z');

function accessToken(expiresAt = new Date(now.getTime() + 60 * 60_000)) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(expiresAt.getTime() / 1000) })).toString('base64url');
  return `${header}.${payload}.signature-value`;
}

function asClient(value: unknown) {
  return value as SupabaseServerClient;
}

describe('Monday OAuth 2.1 core', () => {
  test('creates state and S256 PKCE while storing only hashed state and an encrypted verifier', async () => {
    const insert = vi.fn(async (_value: Record<string, string>) => ({ error: null }));
    const supabase = asClient({ from: vi.fn(() => ({ insert })) });

    const result = new URL(await createMondayOAuthAttempt({ environment, supabase, now: () => now }));

    expect(result.origin + result.pathname).toBe('https://auth.monday.com/oauth2/authorize');
    expect(result.searchParams.get('code_challenge_method')).toBe('S256');
    expect(result.searchParams.get('scope')).toBe('me:read account:read boards:read boards:write');
    const state = result.searchParams.get('state');
    const stored = insert.mock.calls[0][0] as Record<string, string>;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.state_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.state_hash).not.toBe(state);
    expect(stored.encrypted_code_verifier).toMatch(/^v1\./);
    expect(stored).not.toHaveProperty('code_verifier');
  });

  test('consumes state once, validates token/scopes and attestation, then installs encrypted tokens', async () => {
    let storedAttempt: Record<string, string> = {};
    const insert = vi.fn(async (value: Record<string, string>) => {
      storedAttempt = value;
      return { error: null };
    });
    const rpc = vi.fn(async (name: string, _args?: Record<string, unknown>) => {
      if (name === 'consume_monday_oauth_attempt') return { data: [{
        encrypted_code_verifier: storedAttempt.encrypted_code_verifier,
        redirect_uri: environment.MONDAY_OAUTH_REDIRECT_URI,
      }], error: null };
      if (name === 'install_monday_oauth_connection') return { data: null, error: null };
      return { data: null, error: new Error('unexpected RPC') };
    });
    const supabase = asClient({ from: vi.fn(() => ({ insert })), rpc });
    const authorizeUrl = new URL(await createMondayOAuthAttempt({ environment, supabase, now: () => now }));
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        token_type: 'Bearer', access_token: accessToken(), refresh_token: 'refresh-token-value',
        scope: 'boards:write account:read me:read boards:read',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { me: { kind: 'admin', account: { id: '3603500' } }, boards: [{ id: '18421762586', access_level: 'edit' }] },
      }), { status: 200 }));

    await completeMondayOAuthCallback('authorization-code-value', authorizeUrl.searchParams.get('state')!, 'success', {
      environment, supabase, fetchImpl, now: () => now,
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['consume_monday_oauth_attempt', 'install_monday_oauth_connection']);
    const install = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(install).toMatchObject({ p_account_id: '3603500', p_board_id: '18421762586' });
    expect(String(install.p_encrypted_access_token)).not.toContain(accessToken());
    expect(String(install.p_encrypted_refresh_token)).not.toContain('refresh-token-value');
    const tokenRequest = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(tokenRequest.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(tokenRequest.body))).toMatchObject({ code_verifier: expect.any(String) });
    expect(String(tokenRequest.body)).not.toContain(storedAttempt.encrypted_code_verifier);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://auth.monday.com/oauth_ms/oauth/token');
  });

  test('returns a decrypted unexpired access token without taking a refresh lease', async () => {
    const accessEnvelope = encryptMondaySecret('current-access-token', 'monday:oauth:connection:access', environment);
    const maybeSingle = vi.fn(async () => ({ data: {
      encrypted_access_token: accessEnvelope,
      encrypted_refresh_token: 'unused',
      access_expires_at: '2026-07-20T13:00:00.000Z',
      scopes: ['me:read', 'account:read', 'boards:read', 'boards:write'],
      token_version: 1,
    }, error: null }));
    const rpc = vi.fn();
    const supabase = asClient({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
      rpc,
    });

    await expect(resolveMondayAccessToken({ environment, supabase, now: () => now })).resolves.toBe('current-access-token');
    expect(rpc).not.toHaveBeenCalled();
  });

  test('refreshes an expired token under a lease and rotates both tokens', async () => {
    const refreshEnvelope = encryptMondaySecret('old-refresh-token', 'monday:oauth:connection:refresh', environment);
    const maybeSingle = vi.fn(async () => ({ data: {
      encrypted_access_token: encryptMondaySecret('old-access-token', 'monday:oauth:connection:access', environment),
      encrypted_refresh_token: refreshEnvelope,
      access_expires_at: '2026-07-20T11:00:00.000Z',
      scopes: ['me:read', 'account:read', 'boards:read', 'boards:write'],
      token_version: 7,
    }, error: null }));
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ acquired: true, encrypted_refresh_token: refreshEnvelope, token_version: 7 }], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const supabase = asClient({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
      rpc,
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      token_type: 'bearer', access_token: accessToken(), refresh_token: 'rotated-refresh-token',
    }), { status: 200 }));

    await expect(resolveMondayAccessToken({ environment, supabase, fetchImpl, now: () => now })).resolves.toBe(accessToken());
    expect(rpc.mock.calls[0][0]).toBe('acquire_monday_oauth_refresh_lease');
    expect(rpc.mock.calls[1][0]).toBe('rotate_monday_oauth_tokens');
    const rotation = rpc.mock.calls[1][1] as Record<string, unknown>;
    expect(rotation).toMatchObject({ p_expected_version: 7 });
    expect(decryptMondaySecret(String(rotation.p_encrypted_refresh_token), 'monday:oauth:connection:refresh', environment)).toBe('rotated-refresh-token');
  });

  test('revokes both provider tokens before deleting the leased connection', async () => {
    const accessEnvelope = encryptMondaySecret(accessToken(), 'monday:oauth:connection:access', environment);
    const refreshEnvelope = encryptMondaySecret('current-refresh-token', 'monday:oauth:connection:refresh', environment);
    const maybeSingle = vi.fn(async () => ({ data: {
      encrypted_access_token: accessEnvelope,
      encrypted_refresh_token: refreshEnvelope,
      access_expires_at: '2026-07-20T13:00:00.000Z',
      scopes: ['me:read', 'account:read', 'boards:read', 'boards:write'],
      token_version: 9,
    }, error: null }));
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{ acquired: true, encrypted_refresh_token: refreshEnvelope, token_version: 9 }], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const supabase = asClient({
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) })),
      rpc,
    });
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ success: true }), { status: 200 }));

    await disconnectMondayOAuthConnection({ environment, supabase, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).token_type_hint))
      .toEqual(['access_token', 'refresh_token']);
    expect(rpc.mock.calls[1]).toEqual(['disconnect_monday_oauth_connection', expect.objectContaining({ p_expected_version: 9 })]);
  });
});
