// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest';

const { createAttempt, completeCallback, disconnectConnection } = vi.hoisted(() => ({
  createAttempt: vi.fn(async () => 'https://auth.monday.com/oauth2/authorize?state=opaque'),
  completeCallback: vi.fn(async () => undefined),
  disconnectConnection: vi.fn(async () => undefined),
}));

vi.mock('@/lib/monday/oauth', () => ({
  createMondayOAuthAttempt: createAttempt,
  completeMondayOAuthCallback: completeCallback,
  disconnectMondayOAuthConnection: disconnectConnection,
}));

describe('Monday OAuth routes', () => {
  const originalSetupToken = process.env.SETUP_TOKEN;

  afterEach(() => {
    vi.clearAllMocks();
    if (originalSetupToken === undefined) delete process.env.SETUP_TOKEN;
    else process.env.SETUP_TOKEN = originalSetupToken;
  });

  test('start fails closed without SETUP_TOKEN', async () => {
    delete process.env.SETUP_TOKEN;
    const { POST } = await import('@/app/api/internal/monday-oauth/start/route');
    const response = await POST(new Request('https://example.com/api/internal/monday-oauth/start', { method: 'POST' }));
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(createAttempt).not.toHaveBeenCalled();
  });

  test('start requires the correct bearer SETUP_TOKEN and returns a no-store URL', async () => {
    process.env.SETUP_TOKEN = 'setup-secret';
    const { POST } = await import('@/app/api/internal/monday-oauth/start/route');
    const unauthorized = await POST(new Request('https://example.com/api/internal/monday-oauth/start', { method: 'POST' }));
    expect(unauthorized.status).toBe(401);
    const response = await POST(new Request('https://example.com/api/internal/monday-oauth/start', {
      method: 'POST', headers: { Authorization: 'Bearer setup-secret' },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toMatchObject({ authorizeUrl: expect.stringContaining('auth.monday.com') });
  });

  test('callback returns only a generic no-store response on failure', async () => {
    completeCallback.mockRejectedValueOnce(new Error('provider included a secret'));
    const { GET } = await import('@/app/api/internal/monday-oauth/callback/route');
    const response = await GET(new Request('https://example.com/api/internal/monday-oauth/callback?code=bad&state=bad'));
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toBe('{"ok":false,"error":"Monday OAuth callback failed"}');
  });

  test('callback forwards Monday approval status to the one-use exchange', async () => {
    const { GET } = await import('@/app/api/internal/monday-oauth/callback/route');
    const response = await GET(new Request('https://example.com/api/internal/monday-oauth/callback?code=code-value&state=state-value&status=success'));
    expect(response.status).toBe(200);
    expect(completeCallback).toHaveBeenCalledWith('code-value', 'state-value', 'success');
  });

  test('connection deletion requires SETUP_TOKEN before revoking provider tokens', async () => {
    process.env.SETUP_TOKEN = 'setup-secret';
    const { DELETE } = await import('@/app/api/internal/monday-oauth/connection/route');
    const unauthorized = await DELETE(new Request('https://example.com/api/internal/monday-oauth/connection', { method: 'DELETE' }));
    expect(unauthorized.status).toBe(401);
    expect(disconnectConnection).not.toHaveBeenCalled();

    const response = await DELETE(new Request('https://example.com/api/internal/monday-oauth/connection', {
      method: 'DELETE', headers: { Authorization: 'Bearer setup-secret' },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(disconnectConnection).toHaveBeenCalledOnce();
  });
});
