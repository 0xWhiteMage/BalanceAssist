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

function formWith(file: File, mode: 'analysis' | 'human' = 'analysis') {
  const form = new FormData();
  form.set('mode', mode);
  form.append('files', file);
  return form;
}

const sessionId = '11111111-2222-3333-4444-555555555555';

async function post(form: FormData, headers: HeadersInit = {}) {
  const formDataSpy = vi.spyOn(Request.prototype, 'formData').mockResolvedValue(form);
  try {
    const { POST } = await import('@/app/api/telegram/upload/route');
    return await POST(new Request('http://localhost/api/telegram/upload', {
      method: 'POST',
      headers: {
        origin: 'https://www.balancestudio.tv',
        'x-session-capability': 'capability',
        'x-session-id': sessionId,
        'x-upload-mode': String(form.get('mode') ?? 'analysis'),
        ...headers
      }
    }));
  } finally {
    formDataSpy.mockRestore();
  }
}

describe('POST /api/telegram/upload private storage', () => {
  function useConsents(consents: Array<{ scope: string; granted: boolean }>) {
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId, capability: 'capability' },
      supabase: {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ order: vi.fn(async () => ({ data: consents.map((consent) => ({ ...consent, notice_version: '1.2' })), error: null })) }))
          }))
        }))
      }
    });
  }

  beforeEach(() => {
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';
    requireSessionMock.mockImplementation(async (request: Request, expectedSessionId?: string) => {
      if (
        request.headers.get('origin') !== 'https://www.balancestudio.tv'
      ) {
        return { ok: false, response: new Response(JSON.stringify({ error: 'Untrusted origin' }), { status: 403 }) };
      }
      if (request.headers.get('x-session-capability') !== 'capability' || expectedSessionId !== sessionId) {
        return { ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) };
      }
      return {
        ok: true,
        auth: { sessionId, capability: 'capability' },
        supabase: {
          from: vi.fn(() => ({
            select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(async () => ({ data: [{ scope: 'analysis', granted: true, notice_version: '1.2' }], error: null })) })) }))
          }))
        }
      };
    });
    storePrivateUploadMock.mockImplementation(async (input: { verifiedMime: string; extractedText: string }) => ({
      status: 'stored',
      objectKey: 'opaque',
      mimeType: input.verifiedMime,
      extractedText: input.extractedText,
      retentionExpiresAt: '2026-07-15T00:00:00.000Z'
    }));
    deletePrivateUploadMock.mockResolvedValue(true);
  });

  afterEach(() => {
    delete process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET;
    vi.restoreAllMocks();
  });

  test('rejects a missing capability before parsing multipart data', async () => {
    const formDataSpy = vi.spyOn(Request.prototype, 'formData');
    const { POST } = await import('@/app/api/telegram/upload/route');

    const response = await POST(new Request('http://localhost/api/telegram/upload', {
      method: 'POST',
      headers: { origin: 'https://www.balancestudio.tv', 'x-session-id': sessionId }
    }));

    expect(response.status).toBe(401);
    expect(formDataSpy).not.toHaveBeenCalled();
  });

  test('rejects an invalid capability before parsing multipart data', async () => {
    const formDataSpy = vi.spyOn(Request.prototype, 'formData');
    const { POST } = await import('@/app/api/telegram/upload/route');
    const response = await POST(new Request('http://localhost/api/telegram/upload', {
      method: 'POST',
      headers: {
        origin: 'https://www.balancestudio.tv',
        'x-session-capability': 'invalid-capability',
        'x-session-id': sessionId
      }
    }));

    expect(response.status).toBe(401);
    expect(formDataSpy).not.toHaveBeenCalled();
  });

  test('rejects an untrusted origin before parsing multipart data', async () => {
    const formDataSpy = vi.spyOn(Request.prototype, 'formData');
    const { POST } = await import('@/app/api/telegram/upload/route');
    const response = await POST(new Request('http://localhost/api/telegram/upload', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.example',
        'x-session-capability': 'capability',
        'x-session-id': sessionId
      }
    }));

    expect(response.status).toBe(403);
    expect(formDataSpy).not.toHaveBeenCalled();
  });

  test('rejects an oversized declared multipart body before parsing', async () => {
    const response = await post(formWith(new File(['brief'], 'brief.txt', { type: 'text/plain' })), {
      'content-length': String(27 * 1024 * 1024)
    });

    expect(response.status).toBe(413);
  });

  test('rejects an oversized chunked multipart body', async () => {
    const { POST } = await import('@/app/api/telegram/upload/route');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(27 * 1024 * 1024));
        controller.close();
      }
    });

    const response = await POST(new Request('http://localhost/api/telegram/upload', {
      method: 'POST',
      headers: {
        origin: 'https://www.balancestudio.tv',
        'x-session-capability': 'capability',
        'x-session-id': sessionId,
        'x-upload-mode': 'analysis',
        'content-type': 'multipart/form-data; boundary=bound'
      },
      body,
      duplex: 'half'
    } as RequestInit));

    expect(response.status).toBe(413);
  });

  test('requires a valid mode header before parsing multipart data', async () => {
    const formDataSpy = vi.spyOn(Request.prototype, 'formData');
    const { POST } = await import('@/app/api/telegram/upload/route');
    const response = await POST(new Request('http://localhost/api/telegram/upload', {
      method: 'POST',
      headers: {
        origin: 'https://www.balancestudio.tv',
        'x-session-capability': 'capability',
        'x-session-id': sessionId
      }
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'upload_mode_required' });
    expect(formDataSpy).not.toHaveBeenCalled();
  });

  test('rejects a mode header and form mismatch', async () => {
    const response = await post(formWith(new File(['brief'], 'brief.txt', { type: 'text/plain' }), 'analysis'), {
      'x-upload-mode': 'human'
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'upload_mode_mismatch' });
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test.each([
    [null, 'upload_mode_mismatch'],
    ['preview', 'invalid_upload_mode']
  ])('rejects multipart mode %j', async (mode, code) => {
    const form = new FormData();
    if (mode) form.set('mode', mode);
    form.append('files', new File(['brief'], 'brief.txt', { type: 'text/plain' }));

    const response = await post(form);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, code });
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test('stores an analysis-consented file without producer delivery', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4\nstream\nBT (Launch film scope) Tj ET\nendstream\n%%EOF');
    const file = new File([bytes], 'launch-brief.pdf', { type: 'application/pdf' });
    const response = await post(formWith(file));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'stored', analyses: [{ mimeType: 'application/pdf', extractedText: 'Launch film scope' }] });
    expect(storePrivateUploadMock).toHaveBeenCalledWith(expect.objectContaining({
      bucket: 'temporary-attachments',
      verifiedMime: 'application/pdf',
      extractedText: 'Launch film scope'
    }));
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

  test('human mode requires producer-transfer consent rather than analysis consent', async () => {
    useConsents([{ scope: 'analysis', granted: true }]);

    const response = await post(formWith(new File(['human'], 'ordinary.txt', { type: 'text/plain' }), 'human'));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'producer_transfer_consent_required' });
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test('human mode permits a protected filename and stores without extraction', async () => {
    useConsents([{ scope: 'producer_transfer', granted: true }]);
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const response = await post(formWith(
      new File([bytes], 'confidential-client-brief.pdf', { type: 'application/pdf' }),
      'human'
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, status: 'stored' });
    expect(storePrivateUploadMock).toHaveBeenCalledWith(expect.objectContaining({
      verifiedMime: 'application/pdf',
      extractedText: ''
    }));
  });

  test.each([
    ['brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['edit.mov', 'video/quicktime'],
    ['assets.zip', 'application/zip']
  ])('human mode accepts validated %s without AI magic or extraction', async (name, type) => {
    useConsents([{ scope: 'producer_transfer', granted: true }]);
    const response = await post(formWith(new File(['human-only bytes'], name, { type }), 'human'));

    expect(response.status).toBe(200);
    expect(storePrivateUploadMock).toHaveBeenCalledWith(expect.objectContaining({
      verifiedMime: type,
      extractedText: ''
    }));
  });

  test('human mode rejects executable extensions before storage', async () => {
    useConsents([{ scope: 'producer_transfer', granted: true }]);
    const response = await post(formWith(new File(['MZ'], 'malware.exe', { type: 'application/octet-stream' }), 'human'));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'file_validation_failed' });
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test.each([
    ['renamed-pe.pdf', 'application/pdf', new Uint8Array([0x4d, 0x5a, 0x90])],
    ['renamed-elf.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Uint8Array([0x7f, 0x45, 0x4c, 0x46])],
    ['renamed-mach-o.pdf', 'application/pdf', new Uint8Array([0xcf, 0xfa, 0xed, 0xfe])],
    ['renamed-class.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Uint8Array([0xca, 0xfe, 0xba, 0xbe])],
    ['renamed-script.pdf', 'application/pdf', new TextEncoder().encode('#!/bin/sh\necho unsafe')]
  ])('human mode rejects disguised executable or script content in %s', async (name, type, bytes) => {
    useConsents([{ scope: 'producer_transfer', granted: true }]);

    const response = await post(formWith(new File([bytes], name, { type }), 'human'));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'file_validation_failed' });
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test('human mode rejects a known executable MIME under an allowed extension', async () => {
    useConsents([{ scope: 'producer_transfer', granted: true }]);

    const response = await post(formWith(
      new File(['ordinary'], 'renamed.pdf', { type: 'application/x-msdownload' }),
      'human'
    ));

    expect(response.status).toBe(422);
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test.each([
    ['benign.pdf', 'application/pdf', new TextEncoder().encode('%PDF-1.7\nbenign')],
    ['benign.zip', 'application/zip', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])]
  ])('human mode permits benign signature control %s', async (name, type, bytes) => {
    useConsents([{ scope: 'producer_transfer', granted: true }]);

    const response = await post(formWith(new File([bytes], name, { type }), 'human'));

    expect(response.status).toBe(200);
    expect(storePrivateUploadMock).toHaveBeenCalledOnce();
  });

  test('human mode permits a near-50 MB contract under its multipart ceiling without allocating it', async () => {
    useConsents([{ scope: 'producer_transfer', granted: true }]);
    const file = new File(['bounded fixture'], 'large.mov', { type: 'video/quicktime' });
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });

    const response = await post(formWith(file, 'human'), {
      'content-length': String(50 * 1024 * 1024 + 256 * 1024)
    });

    expect(response.status).toBe(200);
    expect(storePrivateUploadMock).toHaveBeenCalledOnce();
  });

  test('preflights every file before the first storage side effect', async () => {
    const form = new FormData();
    form.set('mode', 'analysis');
    form.append('files', new File(['valid text'], 'first.txt', { type: 'text/plain' }));
    form.append('files', new File([new Uint8Array([0x00, 0x4d, 0x5a])], 'second.txt', { type: 'text/plain' }));

    const response = await post(form);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'file_validation_failed' });
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test.each([
    ['brief.txt', 'text/plain', new TextEncoder().encode('This work is covered by the NDA.')],
    ['brief.pdf', 'application/pdf', new TextEncoder().encode('%PDF-1.4\nstream\nBT (This work is under our NDA.) Tj ET\nendstream\n%%EOF')]
  ])('rejects confidential extracted content from benign %s before storage', async (name, type, bytes) => {
    const response = await post(formWith(new File([bytes], name, { type })));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'confidential_file_not_allowed' });
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test('rejects the entire batch when the second extracted file is confidential', async () => {
    const form = new FormData();
    form.set('mode', 'analysis');
    form.append('files', new File(['ordinary project scope'], 'first.txt', { type: 'text/plain' }));
    form.append('files', new File(['This work is covered by the NDA.'], 'second.txt', { type: 'text/plain' }));

    const response = await post(form);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'confidential_file_not_allowed' });
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test('stores benign extracted text and reuses it as the analysis response', async () => {
    const response = await post(formWith(new File(['ordinary project scope'], 'brief.txt', { type: 'text/plain' })));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: 'stored',
      analyses: [{ mimeType: 'text/plain', extractedText: 'ordinary project scope' }]
    });
    expect(storePrivateUploadMock).toHaveBeenCalledWith(expect.objectContaining({ extractedText: 'ordinary project scope' }));
  });

  test('reads each file once during preflight and passes verified bytes to storage', async () => {
    const bytes = new TextEncoder().encode('valid text');
    const file = new File([bytes], 'brief.txt', { type: 'text/plain' });
    const arrayBufferSpy = vi.fn(async () => bytes.buffer);
    Object.defineProperty(file, 'arrayBuffer', { value: arrayBufferSpy });

    const response = await post(formWith(file));

    expect(response.status).toBe(200);
    expect(arrayBufferSpy).toHaveBeenCalledOnce();
    expect(storePrivateUploadMock).toHaveBeenCalledWith(expect.objectContaining({
      buffer: bytes.buffer,
      verifiedMime: 'text/plain',
      extractedText: 'valid text'
    }));
    expect(storePrivateUploadMock.mock.calls[0]?.[0]).not.toHaveProperty('file');
  });

  test('rejects invalid files before private persistence', async () => {
    const file = new File([new Uint8Array([0x4d, 0x5a])], 'payload.pdf', { type: 'application/pdf' });
    const response = await post(formWith(file));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'file_validation_failed' });
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test('compensates earlier stored files when a later file fails', async () => {
    storePrivateUploadMock
      .mockResolvedValueOnce({ status: 'stored', objectKey: 'opaque-one', mimeType: 'text/plain', extractedText: 'first', retentionExpiresAt: '2026-07-15T00:00:00.000Z' })
      .mockRejectedValueOnce(new Error('storage failed'));
    const form = new FormData();
    form.set('mode', 'analysis');
    form.append('files', new File(['first'], 'first.txt', { type: 'text/plain' }));
    form.append('files', new File(['second'], 'second.txt', { type: 'text/plain' }));

    const response = await post(form);

    expect(response.status).toBe(503);
    expect(deletePrivateUploadMock).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'temporary-attachments', objectKey: 'opaque-one' }));
  });

  test('returns recovery-unavailable when batch compensation fails', async () => {
    storePrivateUploadMock.mockResolvedValueOnce({ status: 'stored', objectKey: 'opaque-one', mimeType: 'text/plain', extractedText: 'first', retentionExpiresAt: '2026-07-15T00:00:00.000Z' }).mockRejectedValueOnce(new Error('storage failed'));
    deletePrivateUploadMock.mockResolvedValueOnce(false);
    const form = new FormData();
    form.set('mode', 'analysis');
    form.append('files', new File(['first'], 'first.txt', { type: 'text/plain' }));
    form.append('files', new File(['second'], 'second.txt', { type: 'text/plain' }));

    const response = await post(form);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'private_storage_recovery_unavailable' });
  });

  test('returns unavailable when current storage readiness rejects persistence', async () => {
    storePrivateUploadMock.mockRejectedValueOnce(new Error('private_storage_unavailable'));

    const response = await post(formWith(new File(['brief'], 'brief.txt', { type: 'text/plain' })));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'private_storage_unavailable' });
  });
});
