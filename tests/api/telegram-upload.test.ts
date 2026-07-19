// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
  actualClassifier,
  actualIntentClassifier,
  classifyConfidentialFilenameMock,
  classifyConfidentialIntentMock,
  requireSessionMock,
  storePrivateUploadMock,
  consumeRateLimitMock
} = vi.hoisted(() => ({
  actualClassifier: { current: undefined as undefined | ((filename: string) => string) },
  actualIntentClassifier: { current: undefined as undefined | ((value: string) => string) },
  classifyConfidentialFilenameMock: vi.fn(),
  classifyConfidentialIntentMock: vi.fn(),
  requireSessionMock: vi.fn(),
  storePrivateUploadMock: vi.fn(),
  consumeRateLimitMock: vi.fn()
}));

vi.mock('@/lib/api/require-session', () => ({ requireSession: requireSessionMock }));
vi.mock('@/lib/security/rate-limit', () => ({ consumeRateLimit: consumeRateLimitMock }));
vi.mock('@/lib/uploads/private-storage', () => ({
  storePrivateUpload: storePrivateUploadMock,
  deletePrivateUpload: vi.fn(),
  privateStorageAvailable: vi.fn(),
  privateUploadBucketFromEnv: () => process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET ?? null,
  PrivateStorageError: class PrivateStorageError extends Error {}
}));
vi.mock('@/lib/privacy/confidential-intent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/privacy/confidential-intent')>();
  actualClassifier.current = actual.classifyConfidentialFilename;
  actualIntentClassifier.current = actual.classifyConfidentialIntent;
  return {
    ...actual,
    classifyConfidentialFilename: classifyConfidentialFilenameMock,
    classifyConfidentialIntent: classifyConfidentialIntentMock
  };
});

async function post(form: FormData) {
  const { POST } = await import('@/app/api/telegram/upload/route');
  return POST(new Request('http://localhost/api/telegram/upload', {
    method: 'POST',
    headers: {
      'x-session-id': '11111111-2222-3333-4444-555555555555',
      'x-upload-mode': 'analysis'
    },
    body: form
  }));
}

describe('POST /api/telegram/upload analysis-only contract', () => {
  beforeEach(() => {
    process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET = 'temporary-attachments';
    classifyConfidentialFilenameMock.mockReset();
    classifyConfidentialFilenameMock.mockImplementation((filename: string) => actualClassifier.current!(filename));
    classifyConfidentialIntentMock.mockReset();
    classifyConfidentialIntentMock.mockImplementation((value: string) => actualIntentClassifier.current!(value));
    requireSessionMock.mockClear();
    consumeRateLimitMock.mockReset();
    consumeRateLimitMock.mockResolvedValue({ permitted: true, retryAfterSeconds: 0 });
    storePrivateUploadMock.mockClear();
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: '11111111-2222-3333-4444-555555555555', capability: 'capability' },
      supabase: {
        rpc: vi.fn(async (name: string) => name === 'reserve_session_upload_quota'
          ? { data: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', error: null }
          : { data: true, error: null }),
        from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ order: vi.fn(async () => ({ data: [{ scope: 'analysis', granted: true, notice_version: '1.2' }], error: null })) })) })) }))
      }
    });
    storePrivateUploadMock.mockResolvedValue({ status: 'stored', objectKey: 'opaque', mimeType: 'text/plain', extractedText: 'Draft-only analysis' });
  });

  afterEach(() => {
    delete process.env.SUPABASE_PRIVATE_UPLOAD_BUCKET;
    vi.restoreAllMocks();
  });

  test('never calls Telegram while accepting an analysis-consented upload', async () => {
    const form = new FormData();
    form.set('mode', 'analysis');
    form.append('files', new File(['Draft-only analysis'], 'brief.txt', { type: 'text/plain' }));

    const response = await post(form);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, analyses: [{ extractedText: 'Draft-only analysis' }] });
  });

  test.each([
    'confidential-client-brief.txt',
    '.nda.pdf',
    'client_(confidential)_brief.txt',
    'c\u043Enfidential-brief.txt',
    `${'x'.repeat(513)}.txt`
  ])('rejects protected filename %j before consent or storage without echoing it', async (filename) => {
    const fromMock = vi.fn(() => {
      throw new Error('consent must not be read');
    });
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: '11111111-2222-3333-4444-555555555555', capability: 'capability' },
      supabase: { from: fromMock }
    });
    const form = new FormData();
    form.set('mode', 'analysis');
    form.append('files', new File(['do not process'], filename, { type: 'text/plain' }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await post(form);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toEqual({ ok: false, code: 'confidential_file_not_allowed' });
    expect(JSON.stringify(body)).not.toContain(filename);
    expect(fromMock).not.toHaveBeenCalled();
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
    expect([...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ')).not.toContain(filename);
  });

  test('rejects the entire batch when any filename is protected', async () => {
    const fromMock = vi.fn();
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: '11111111-2222-3333-4444-555555555555', capability: 'capability' },
      supabase: { from: fromMock }
    });
    const form = new FormData();
    form.set('mode', 'analysis');
    form.append('files', new File(['safe'], 'ordinary-brief.txt', { type: 'text/plain' }));
    form.append('files', new File(['protected'], '.nda.txt', { type: 'text/plain' }));

    const response = await post(form);

    expect(response.status).toBe(422);
    expect(fromMock).not.toHaveBeenCalled();
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test('fails closed before consent or storage when filename classification throws', async () => {
    classifyConfidentialFilenameMock.mockImplementationOnce(() => {
      throw new Error('classifier unavailable');
    });
    const fromMock = vi.fn();
    requireSessionMock.mockResolvedValue({
      ok: true,
      auth: { sessionId: '11111111-2222-3333-4444-555555555555', capability: 'capability' },
      supabase: { from: fromMock }
    });
    const form = new FormData();
    form.set('mode', 'analysis');
    form.append('files', new File(['safe'], 'ordinary-brief.txt', { type: 'text/plain' }));

    const response = await post(form);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ ok: false, code: 'confidential_file_not_allowed' });
    expect(fromMock).not.toHaveBeenCalled();
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
  });

  test('allows a benign filename near-match through consent and storage', async () => {
    const form = new FormData();
    form.set('mode', 'analysis');
    form.append('files', new File(['ordinary'], 'personal-project.txt', { type: 'text/plain' }));

    const response = await post(form);

    expect(response.status).toBe(200);
    expect(classifyConfidentialFilenameMock).toHaveBeenCalledWith('personal-project.txt');
    expect(storePrivateUploadMock).toHaveBeenCalledOnce();
  });

  test('fails closed without echoing extracted content, logging it, or calling a provider when content classification throws', async () => {
    const confidentialText = 'Private client phrase that must not escape';
    classifyConfidentialIntentMock.mockImplementationOnce(() => {
      throw new Error('classifier unavailable');
    });
    const form = new FormData();
    form.set('mode', 'analysis');
    form.append('files', new File([confidentialText], 'ordinary-brief.txt', { type: 'text/plain' }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const providerSpy = vi.spyOn(global, 'fetch');

    const response = await post(form);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toEqual({ ok: false, code: 'confidential_file_not_allowed' });
    expect(JSON.stringify(body)).not.toContain(confidentialText);
    expect(storePrivateUploadMock).not.toHaveBeenCalled();
    expect(providerSpy).not.toHaveBeenCalled();
    expect([...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].flat().join(' ')).not.toContain(confidentialText);
  });
});
