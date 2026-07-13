// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { requireSessionMock, storePrivateUploadMock, deletePrivateUploadMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  storePrivateUploadMock: vi.fn(),
  deletePrivateUploadMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));
vi.mock('@/lib/uploads/private-storage', () => ({
  storePrivateUpload: storePrivateUploadMock,
  deletePrivateUpload: deletePrivateUploadMock,
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
    storePrivateUploadMock.mockResolvedValue({ status: 'stored', objectKey: 'opaque', mimeType: 'application/pdf', extractedText: 'Launch film scope', retentionExpiresAt: '2026-07-15T00:00:00.000Z' });
    deletePrivateUploadMock.mockResolvedValue(true);
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
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'stored', analyses: [{ mimeType: 'application/pdf', extractedText: 'Launch film scope' }] });
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

  test('rejects invalid files before private persistence', async () => {
    storePrivateUploadMock.mockRejectedValueOnce(new Error('validation failed'));
    const file = new File([new Uint8Array([0x4d, 0x5a])], 'payload.pdf', { type: 'application/pdf' });
    const response = await post(formWith(file));

    expect(response.status).toBe(503);
    expect(storePrivateUploadMock).toHaveBeenCalledWith(expect.objectContaining({ file }));
  });

  test('compensates earlier stored files when a later file fails', async () => {
    storePrivateUploadMock
      .mockResolvedValueOnce({ status: 'stored', objectKey: 'opaque-one', mimeType: 'text/plain', extractedText: 'first', retentionExpiresAt: '2026-07-15T00:00:00.000Z' })
      .mockRejectedValueOnce(new Error('storage failed'));
    const form = new FormData();
    form.append('files', new File(['first'], 'first.txt', { type: 'text/plain' }));
    form.append('files', new File(['second'], 'second.txt', { type: 'text/plain' }));

    const response = await post(form);

    expect(response.status).toBe(503);
    expect(deletePrivateUploadMock).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'temporary-attachments', objectKey: 'opaque-one' }));
  });
});
