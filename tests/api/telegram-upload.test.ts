// @vitest-environment node
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

const { sendDocumentMock, ensureTelegramTopicMock, createServerSupabaseClientMock, requireSessionMock } = vi.hoisted(() => ({
  sendDocumentMock: vi.fn(),
  ensureTelegramTopicMock: vi.fn(async (_supabase: unknown, _sessionId: string) => null),
  createServerSupabaseClientMock: vi.fn(),
  requireSessionMock: vi.fn()
}));

vi.mock('@/lib/telegram', () => ({
  sendDocument: sendDocumentMock,
  ensureTelegramTopic: ensureTelegramTopicMock
}));

vi.mock('@/lib/supabase/server', () => ({
  hasSupabaseServerConfig: () => true,
  createServerSupabaseClient: createServerSupabaseClientMock
}));

vi.mock('@/lib/api/require-session', () => ({
  requireSession: requireSessionMock
}));

function buildMockSupabase(options?: { fileRequestOpen?: boolean; telegramThreadId?: number | null; status?: string; draft?: Record<string, unknown>; draftVersion?: number; consentTransitions?: Array<{ scope: string; granted: boolean }> }) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const fileRequestOpen = options?.fileRequestOpen ?? true;
  const telegramThreadId = options?.telegramThreadId ?? 42;
  const sessionStatus = options?.status ?? 'open';
  const draft = options?.draft ?? {};
  const draftVersion = options?.draftVersion ?? 0;
  const consentTransitions = options?.consentTransitions ?? [
    { scope: 'analysis', granted: true },
    { scope: 'producer_transfer', granted: true }
  ];

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
                data: {
                  telegram_thread_id: telegramThreadId,
                  file_request_open: fileRequestOpen,
                  contact_name: null,
                  contact_company: null,
                  status: sessionStatus,
                  draft,
                  draft_version: draftVersion
                },
                error: null
              }))
            }))
          })),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
          insert: vi.fn(async () => ({ error: null }))
        };
      }
      if (table === 'session_consents') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(async () => ({ data: consentTransitions, error: null }))
            }))
          }))
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
  const content = new Uint8Array(Math.max(size, 4));
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    content[0] = 0x25; content[1] = 0x50; content[2] = 0x44; content[3] = 0x46;
  } else if (type === 'image/png' || name.endsWith('.png')) {
    content[0] = 0x89; content[1] = 0x50; content[2] = 0x4e; content[3] = 0x47;
  } else if (type === 'image/jpeg' || name.endsWith('.jpg')) {
    content[0] = 0xff; content[1] = 0xd8; content[2] = 0xff;
  } else if (type === 'text/plain' || name.endsWith('.txt')) {
    content[0] = 0x48; content[1] = 0x65; content[2] = 0x6c; content[3] = 0x6c;
  }
  return new File([content], name, { type });
}

function buildFakeFormData(
  fields: Record<string, string>,
  files: File[],
  opts?: {
    includeConsent?: boolean;
    consent?: { aiAnalysis: boolean; producerShare: boolean; consentedAt?: string };
  }
): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const file of files) form.append('files', file);
  if (opts?.includeConsent !== false) {
    const consent = opts?.consent ?? { aiAnalysis: true, producerShare: true, consentedAt: new Date().toISOString() };
    form.set(
      'consent',
      JSON.stringify({
        aiAnalysis: consent.aiAnalysis,
        producerShare: consent.producerShare,
        consentedAt: consent.consentedAt ?? new Date().toISOString()
      })
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
    requireSessionMock.mockReset();
    requireSessionMock.mockImplementation(async (_request: Request, expectedSessionId?: string) => ({
      ok: true,
      auth: {
        sessionId: expectedSessionId && expectedSessionId.length > 0
          ? expectedSessionId
          : '11111111-2222-3333-4444-555555555555',
        capability: 'session-capability'
      },
      supabase: createServerSupabaseClientMock()
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('proxies file to sendDocument and persists metadata only', async () => {
    const { client, inserts } = buildMockSupabase({ status: 'completed' });
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
      original_name: 'deck.pdf',
      size_bytes: 12_345,
      mime: 'application/pdf',
      mime_type: 'application/pdf',
      status: 'sent',
      storage_path: null,
      kind: 'reference'
    });
  });

  test('accepts a prior ledger grant and ignores a missing request consent payload', async () => {
    const { client } = buildMockSupabase({
      status: 'completed',
      consentTransitions: [{ scope: 'producer_transfer', granted: true }]
    });
    createServerSupabaseClientMock.mockReturnValue(client);
    sendDocumentMock.mockResolvedValue({ ok: true, fileId: 'file-id', raw: {} });

    const response = await callUploadRoute(buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [makeFile('deck.pdf', 100, 'application/pdf')],
      { includeConsent: false }
    ));

    expect(response.status).toBe(200);
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
    const { client, inserts } = buildMockSupabase({ status: 'completed' });
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

  test('rejects an unverifiable reference upload even in AI mode', async () => {
    const { client, inserts } = buildMockSupabase({ fileRequestOpen: false, telegramThreadId: null });
    createServerSupabaseClientMock.mockReturnValue(client);

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [makeFile('deck.pptx', 12_345, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')],
      { consent: { aiAnalysis: true, producerShare: false } }
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(415);
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/verify file type/i);
    expect(sendDocumentMock).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  test('persists the detected MIME instead of the browser-provided MIME', async () => {
    const { client, inserts } = buildMockSupabase({ status: 'completed' });
    createServerSupabaseClientMock.mockReturnValue(client);

    sendDocumentMock.mockResolvedValue({
      ok: true,
      fileId: 'mock-telegram-file-id',
      raw: { ok: true, result: { message_id: 1, document: { file_id: 'mock-telegram-file-id' } } }
    });

    const pdfBytes = new Uint8Array(12_345);
    pdfBytes[0] = 0x25;
    pdfBytes[1] = 0x50;
    pdfBytes[2] = 0x44;
    pdfBytes[3] = 0x46;
    const spoofedFile = new File([pdfBytes], 'deck.pdf', { type: 'text/plain' });

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [spoofedFile]
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);

    const fileInserts = inserts.filter((i) => i.table === 'uploaded_files');
    expect(fileInserts).toHaveLength(1);
    expect(fileInserts[0].row.mime).toBe('application/pdf');
  });

  test('returns 403 for a team-requested deliverable upload when producer-share consent is false', async () => {
    const { client } = buildMockSupabase({ fileRequestOpen: true, telegramThreadId: 42, consentTransitions: [] });
    createServerSupabaseClientMock.mockReturnValue(client);

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'deliverable' },
      [makeFile('deliverable.pdf', 12_345, 'application/pdf')],
      { consent: { aiAnalysis: true, producerShare: false } }
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/share|team/i);
    expect(sendDocumentMock).not.toHaveBeenCalled();
  });

  test('forwards a team-requested deliverable with producer-share consent even when aiAnalysis is false', async () => {
    const { client, inserts } = buildMockSupabase({
      fileRequestOpen: true,
      telegramThreadId: 42,
      status: 'completed',
      consentTransitions: [{ scope: 'producer_transfer', granted: true }]
    });
    createServerSupabaseClientMock.mockReturnValue(client);

    sendDocumentMock.mockResolvedValue({
      ok: true,
      fileId: 'mock-telegram-file-id',
      raw: { ok: true, result: { message_id: 1, document: { file_id: 'mock-telegram-file-id' } } }
    });

    const file = new File([Buffer.from('Producer-only handoff file', 'utf8')], 'deliverable.txt', {
      type: 'text/plain'
    });
    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'deliverable' },
      [file],
      { consent: { aiAnalysis: false, producerShare: true } }
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.forwarded).toBe(true);
    expect(data.extractedText).toBeUndefined();
    expect(sendDocumentMock).toHaveBeenCalledTimes(1);
    expect(inserts).toContainEqual({
      table: 'uploaded_files',
      row: expect.objectContaining({
        telegram_file_id: 'mock-telegram-file-id',
        name: 'deliverable.txt',
        kind: 'deliverable'
      })
    });
  });

  test('coerces unexpected kind values to "reference"', async () => {
    const { client, inserts } = buildMockSupabase({ status: 'completed' });
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
    const { client } = buildMockSupabase({ status: 'completed' });
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
    const { client } = buildMockSupabase({ consentTransitions: [] });
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

  test('allows an analysis-only upload when consent was already recorded server-side', async () => {
    const { client, inserts } = buildMockSupabase({
      status: 'open',
      telegramThreadId: null,
      consentTransitions: [{ scope: 'analysis', granted: true }]
    });
    createServerSupabaseClientMock.mockReturnValue(client);

    const file = new File([Buffer.from('Project scope from server-side consent.', 'utf8')], 'brief.txt', { type: 'text/plain' });
    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [file],
      { includeConsent: false }
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.forwarded).toBe(false);
    expect(inserts).toContainEqual({
      table: 'uploaded_files',
      row: expect.objectContaining({
        name: 'brief.txt',
        kind: 'reference',
        mime: 'text/plain'
      })
    });
  });

  test('quarantines file during intake without forwarding to Telegram', async () => {
    const { client, inserts } = buildMockSupabase({ status: 'open', telegramThreadId: 42 });
    createServerSupabaseClientMock.mockReturnValue(client);

    const form = buildFakeFormData(
      { sessionId: '11111111-2222-3333-4444-555555555555', kind: 'reference' },
      [makeFile('deck.pdf', 12_345, 'application/pdf')],
      { consent: { aiAnalysis: true, producerShare: true } }
    );

    const res = await callUploadRoute(form);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data.forwarded).toBe(false);
    expect(sendDocumentMock).not.toHaveBeenCalled();

    const fileInserts = inserts.filter((i) => i.table === 'uploaded_files');
    expect(fileInserts).toHaveLength(1);
    expect(fileInserts[0].row.telegram_file_id).toMatch(/^quarantined-/);
  });
});
