// @vitest-environment node
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

const { sendDocumentMock, ensureTelegramTopicMock, createServerSupabaseClientMock } = vi.hoisted(() => ({
  sendDocumentMock: vi.fn(),
  ensureTelegramTopicMock: vi.fn(async (_supabase: unknown, _sessionId: string) => null),
  createServerSupabaseClientMock: vi.fn()
}));

vi.mock('@/lib/telegram', () => ({
  sendDocument: sendDocumentMock,
  ensureTelegramTopic: ensureTelegramTopicMock
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: () => true,
  createServerSupabaseClient: createServerSupabaseClientMock
}));

function buildMockSupabase(options?: { fileRequestOpen?: boolean }) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const fileRequestOpen = options?.fileRequestOpen ?? true;

  const client = {
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async () => ({ error: null }))
      })),
      listBuckets: vi.fn(async () => ({ data: [], error: null })),
      createBucket: vi.fn(async () => ({ error: null }))
    },
    from: vi.fn((table: string) => {
      if (table === 'sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { telegram_thread_id: 42, file_request_open: fileRequestOpen, contact_name: null, contact_company: null },
                error: null
              }))
            }))
          })),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
          insert: vi.fn(async () => ({ error: null }))
        };
      }
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })),
        insert: vi.fn((row: Record<string, unknown>) => {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        }),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
      };
    })
  };

  return { client, inserts };
}

function makeFile(name: string, size: number, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
}

function buildFakeFormData(
  fields: Record<string, string>,
  files: File[],
  opts?: { includeConsent?: boolean }
): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const file of files) form.append('files', file);
  if (opts?.includeConsent !== false) {
    form.set(
      'consent',
      JSON.stringify({ aiAnalysis: true, producerShare: true, consentedAt: new Date().toISOString() })
    );
  }
  return form;
}

async function callUploadRoute(form: FormData) {
  const formDataSpy = vi.spyOn(Request.prototype, 'formData').mockResolvedValue(form);
  try {
    const { POST } = await import('@/app/api/telegram/upload/route');
    const req = new Request('http://localhost/api/telegram/upload', { method: 'POST' });
    return POST(req);
  } finally {
    formDataSpy.mockRestore();
  }
}

describe('POST /api/telegram/upload', () => {
  beforeEach(() => {
    sendDocumentMock.mockReset();
    createServerSupabaseClientMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('proxies file to sendDocument and persists metadata only', async () => {
    const { client, inserts } = buildMockSupabase();
    createServerSupabaseClientMock.mockReturnValue(client);

    sendDocumentMock.mockResolvedValue({
      ok: true,
      fileId: 'mock-telegram-file-id',
      raw: { ok: true, result: { message_id: 1, document: { file_id: 'mock-telegram-file-id' } } }
    });

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [makeFile('deck.pdf', 12_345, 'application/pdf')]
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.telegramFileId).toBe('mock-telegram-file-id');

    expect(sendDocumentMock).toHaveBeenCalledTimes(1);
    const [threadId, buffer, caption, filename] = sendDocumentMock.mock.calls[0];
    expect(threadId).toBe(42);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect((buffer as Buffer).length).toBe(12_345);
    expect(caption).toContain('deck.pdf');
    expect(caption).toContain('reference');
    expect(filename).toBe('deck.pdf');

    expect(client.storage.from).not.toHaveBeenCalled();
    expect(client.storage.createBucket).not.toHaveBeenCalled();

    const fileInserts = inserts.filter((i) => i.table === 'uploaded_files');
    expect(fileInserts).toHaveLength(1);
    const row = fileInserts[0].row;
    expect(row).toMatchObject({
      session_id: '11111111-2222-3333-4444-555555555555',
      telegram_file_id: 'mock-telegram-file-id',
      name: 'deck.pdf',
      size_bytes: 12_345,
      mime: 'application/pdf',
      kind: 'reference'
    });
    expect(row).not.toHaveProperty('storage_path');
    expect(row).not.toHaveProperty('original_name');
  });

  test('returns 400 when file exceeds 50 MB cap', async () => {
    const { client } = buildMockSupabase();
    createServerSupabaseClientMock.mockReturnValue(client);

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [makeFile('huge.pdf', 60 * 1024 * 1024, 'application/pdf')]
    );

    const res = await callUploadRoute(form);

    expect(res.status).toBe(400);
    expect(sendDocumentMock).not.toHaveBeenCalled();
  });

  test('returns 415 when mime/extension is not in the allowlist', async () => {
    const { client } = buildMockSupabase();
    createServerSupabaseClientMock.mockReturnValue(client);

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [makeFile('payload.exe', 1024, 'application/octet-stream')]
    );

    const res = await callUploadRoute(form);

    expect(res.status).toBe(415);
    expect(sendDocumentMock).not.toHaveBeenCalled();
  });

  test('returns 502 without inserting when sendDocument returns ok:false (no Supabase write)', async () => {
    const { client, inserts } = buildMockSupabase();
    createServerSupabaseClientMock.mockReturnValue(client);

    sendDocumentMock.mockResolvedValue({
      ok: false,
      status: 502,
      description: 'Telegram sendDocument HTTP 502'
    });

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [makeFile('deck.pdf', 12_345, 'application/pdf')]
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(502);
    expect(data.ok).toBe(false);
    expect(data.telegramStatus).toBe(502);

    expect(sendDocumentMock).toHaveBeenCalledTimes(1);

    const fileInserts = inserts.filter((i) => i.table === 'uploaded_files');
    expect(fileInserts).toHaveLength(0);
  });

  test('returns 403 when a deliverable upload was not requested by the team', async () => {
    const { client } = buildMockSupabase({ fileRequestOpen: false });
    createServerSupabaseClientMock.mockReturnValue(client);

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'deliverable' },
      [makeFile('deck.pdf', 12_345, 'application/pdf')],
      { includeConsent: true }
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/not been requested by the team/i);
    expect(sendDocumentMock).not.toHaveBeenCalled();
  });

  test('allows a reference upload in AI mode even when no team file request is open', async () => {
    const { client, inserts } = buildMockSupabase({ fileRequestOpen: false });
    createServerSupabaseClientMock.mockReturnValue(client);

    sendDocumentMock.mockResolvedValue({
      ok: true,
      fileId: 'mock-telegram-file-id',
      raw: { ok: true, result: { message_id: 1, document: { file_id: 'mock-telegram-file-id' } } }
    });

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [makeFile('deck.pptx', 12_345, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')]
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(sendDocumentMock).toHaveBeenCalledTimes(1);
    expect(sendDocumentMock.mock.calls[0][3]).toBe('deck.pptx');
    expect(inserts).toContainEqual({
      table: 'uploaded_files',
      row: expect.objectContaining({
        name: 'deck.pptx',
        kind: 'reference',
        mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      })
    });
  });

  test('coerces unexpected kind values to "reference"', async () => {
    const { client, inserts } = buildMockSupabase();
    createServerSupabaseClientMock.mockReturnValue(client);

    sendDocumentMock.mockResolvedValue({
      ok: true,
      fileId: 'mock-telegram-file-id',
      raw: { ok: true, result: { message_id: 1, document: { file_id: 'mock-telegram-file-id' } } }
    });

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'something-unexpected' },
      [makeFile('deck.pdf', 12_345, 'application/pdf')]
    );

    const res = await callUploadRoute(form);
    expect(res.status).toBe(200);

    const [, , caption] = sendDocumentMock.mock.calls[0];
    expect(caption).toContain('(reference)');

    const fileInserts = inserts.filter((i) => i.table === 'uploaded_files');
    expect(fileInserts).toHaveLength(1);
    expect(fileInserts[0].row.kind).toBe('reference');
  });

  test('returns extractedText for an uploaded text file (AI auto-fill payload)', async () => {
    const { client } = buildMockSupabase();
    createServerSupabaseClientMock.mockReturnValue(client);

    sendDocumentMock.mockResolvedValue({
      ok: true,
      fileId: 'mock-telegram-file-id',
      raw: { ok: true, result: { message_id: 1, document: { file_id: 'mock-telegram-file-id' } } }
    });

    const textContent = 'Project: 30s animation. Timeline: 3 weeks. Budget: $5,000 SGD.';
    const file = new File([Buffer.from(textContent, 'utf8')], 'brief.txt', { type: 'text/plain' });
    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [file]
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(typeof data.extractedText).toBe('string');
    expect(data.extractedText).toContain('30s animation');
    expect(data.extractedText).toContain('3 weeks');
    expect(data.extractedText).toContain('$5,000 SGD');
  });

  test('returns 403 when consent is missing', async () => {
    const { client } = buildMockSupabase();
    createServerSupabaseClientMock.mockReturnValue(client);

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [makeFile('deck.pdf', 12_345, 'application/pdf')],
      { includeConsent: false }
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/consent/i);
    expect(sendDocumentMock).not.toHaveBeenCalled();
  });
});
