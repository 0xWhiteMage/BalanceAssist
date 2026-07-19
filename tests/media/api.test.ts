// @vitest-environment node
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn() }));
vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));

const sessionId = '11111111-2222-4333-8444-555555555555';

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { origin: 'https://www.balancestudio.tv', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
}

describe('media direct-upload API', () => {
  beforeEach(() => {
    process.env.SUPABASE_PRIVATE_MEDIA_BUCKET = 'private-media';
    requireSessionMock.mockReset();
  });

  test('returns an opaque signed-upload token without receiving media bytes', async () => {
    const rpc = vi.fn(async (name: string) => name === 'private_media_storage_is_ready'
      ? ({ data: true, error: null })
      : ({ data: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', upload_expires_at: '2026-07-20T14:05:00Z' }], error: null }));
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId },
      supabase: {
        rpc,
        storage: {
          getBucket: vi.fn(async () => ({ data: { id: 'private-media', public: false }, error: null })),
          from: vi.fn(() => ({ createSignedUploadUrl: vi.fn(async () => ({ data: { token: 'signed-token' }, error: null })) }))
        }
      }
    });
    const { POST } = await import('@/app/api/media/uploads/intent/route');
    const response = await POST(request('/api/media/uploads/intent', { operation: 'video_visual', mimeType: 'video/mp4', sizeBytes: 1024 }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      jobId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      upload: { bucket: 'private-media', token: 'signed-token', objectKey: expect.stringMatching(/^media\//) }
    });
    expect(rpc).toHaveBeenCalledWith('create_media_processing_job', expect.objectContaining({ p_session_id: sessionId }));
  });

  test('rejects oversized video intent before creating a job', async () => {
    const rpc = vi.fn();
    requireSessionMock.mockResolvedValue({ ok: true, auth: { sessionId }, supabase: { rpc } });
    const { POST } = await import('@/app/api/media/uploads/intent/route');
    const response = await POST(request('/api/media/uploads/intent', { operation: 'video_visual', mimeType: 'video/mp4', sizeBytes: 50 * 1024 * 1024 + 1 }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('fails closed when the configured bucket is public', async () => {
    const rpc = vi.fn();
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId },
      supabase: { rpc, storage: { getBucket: vi.fn(async () => ({ data: { id: 'private-media', public: true }, error: null })) } }
    });
    const { POST } = await import('@/app/api/media/uploads/intent/route');
    const response = await POST(request('/api/media/uploads/intent', { operation: 'image_visual', mimeType: 'image/png', sizeBytes: 1024 }));
    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  test('fails closed when browser-role storage policy attestation fails', async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId },
      supabase: {
        rpc,
        storage: { getBucket: vi.fn(async () => ({ data: { id: 'private-media', public: false }, error: null })) }
      }
    });
    const { POST } = await import('@/app/api/media/uploads/intent/route');
    const response = await POST(request('/api/media/uploads/intent', { operation: 'image_visual', mimeType: 'image/png', sizeBytes: 1024 }));
    expect(response.status).toBe(503);
    expect(rpc).toHaveBeenCalledWith('private_media_storage_is_ready', { p_bucket: 'private-media' });
  });

  test('bounds JSON request bodies', async () => {
    requireSessionMock.mockResolvedValue({ ok: true, auth: { sessionId }, supabase: {} });
    const { POST } = await import('@/app/api/media/uploads/intent/route');
    const response = await POST(new Request('http://localhost/api/media/uploads/intent', {
      method: 'POST',
      headers: { origin: 'https://www.balancestudio.tv', 'content-length': '9000' },
      body: '{}'
    }));
    expect(response.status).toBe(413);
  });
});
