// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock, storePrivateUploadMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  storePrivateUploadMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));
vi.mock('@/lib/uploads/private-storage', () => ({
  storePrivateUpload: storePrivateUploadMock,
  deletePrivateUpload: vi.fn(),
  privateStorageAvailable: vi.fn(),
  privateUploadBucketFromEnv: () => process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET ?? null,
  PrivateStorageError: class PrivateStorageError extends Error {}
}));

describe('POST /api/telegram/upload analysis-only contract', () => {
  beforeEach(() => {
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: '11111111-2222-3333-4444-555555555555', capability: 'capability' },
      supabase: { from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(async () => ({ data: [{ scope: 'analysis', granted: true }], error: null })) })) })) })) }
    });
    storePrivateUploadMock.mockResolvedValue({ status: 'stored', objectKey: 'opaque', mimeType: 'text/plain', extractedText: 'Draft-only analysis' });
  });

  afterEach(() => {
    delete process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET;
    vi.restoreAllMocks();
  });

  test('never calls Telegram while accepting an analysis-consented upload', async () => {
    const form = new FormData();
    form.append('files', new File(['Draft-only analysis'], 'brief.txt', { type: 'text/plain' }));
    const formDataSpy = vi.spyOn(Request.prototype, 'formData').mockResolvedValue(form);

    const { POST } = await import('@/app/api/telegram/upload/route');
    const response = await POST(new Request('http://localhost/api/telegram/upload', {
      method: 'POST',
      headers: { 'x-session-id': '11111111-2222-3333-4444-555555555555' }
    }));
    formDataSpy.mockRestore();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, analyses: [{ extractedText: 'Draft-only analysis' }] });
  });
});
