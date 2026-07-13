// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock, storePrivateUploadMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  storePrivateUploadMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));
vi.mock('@/lib/uploads/private-storage', () => ({
  storePrivateUpload: storePrivateUploadMock,
  privateUploadBucketFromEnv: () => process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET ?? null,
  PrivateStorageError: class PrivateStorageError extends Error {}
}));

function formWith(file: File) {
  const form = new FormData();
  form.append('files', file);
  return form;
}

async function post(form: FormData) {
  const formDataSpy = vi.spyOn(Request.prototype, 'formData').mockResolvedValue(form);
  try {
    const { POST } = await import('@/app/api/telegram/upload/route');
    return await POST(new Request('http://localhost/api/telegram/upload', { method: 'POST' }));
  } finally {
    formDataSpy.mockRestore();
  }
}

describe('POST /api/telegram/upload private storage', () => {
  beforeEach(() => {
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: '11111111-2222-3333-4444-555555555555', capability: 'capability' },
      supabase: {
        from: vi.fn(() => ({
          select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(async () => ({ data: [{ scope: 'analysis', granted: true }], error: null })) })) }))
        }))
      }
    });
    storePrivateUploadMock.mockResolvedValue({ status: 'stored', objectKey: 'opaque', mimeType: 'application/pdf', retentionExpiresAt: '2026-07-15T00:00:00.000Z' });
  });

  afterEach(() => {
    delete process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET;
    vi.restoreAllMocks();
  });

  test('stores an analysis-consented file without producer delivery', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const file = new File([bytes], 'sensitive-brief.pdf', { type: 'application/pdf' });
    const response = await post(formWith(file));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'stored' });
    expect(storePrivateUploadMock).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'temporary-attachments', file }));
  });

  test('rejects producer-only consent and never invokes delivery', async () => {
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: '11111111-2222-3333-4444-555555555555', capability: 'capability' },
      supabase: {
        from: vi.fn(() => ({
          select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(async () => ({ data: [{ scope: 'producer_transfer', granted: true }], error: null })) })) }))
        }))
      }
    });
    const response = await post(formWith(new File(['text'], 'private.txt', { type: 'text/plain' })));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'analysis_consent_required' });
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });
});
