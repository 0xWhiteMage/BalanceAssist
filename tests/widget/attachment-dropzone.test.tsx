import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AttachmentDropzone } from '@/components/widget/attachment-dropzone';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

const analysisConsent = { aiAnalysis: true, producerShare: false, consentedAt: '2026-07-18T00:00:00.000Z' };

function mockPrivateStorageAvailable() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/api/telegram/upload') && !init?.method) {
      return new Response(JSON.stringify({ available: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw new Error(`Unexpected processing request: ${String(input)}`);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

test('discloses the exact AI formats, proxy-safe limits, extraction behavior, and AI flow before selection', async () => {
  mockPrivateStorageAvailable();
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} sessionId="sess-disclosure" />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());

  const disclosure = screen.getByTestId('private-analysis-upload-disclosure');
  expect(disclosure).toHaveTextContent(/PNG, JPEG, GIF, WebP, PDF, TXT, and CSV/i);
  expect(disclosure).toHaveTextContent(/up to 5 files/i);
  expect(disclosure).toHaveTextContent(/4 MB each/i);
  expect(disclosure).toHaveTextContent(/4 MB total/i);
  expect(disclosure).toHaveTextContent(/TXT, CSV, and text-based PDF files.*up to 4,000 characters/i);
  expect(disclosure).toHaveTextContent(/Image text analysis is not supported.*scanned PDFs need a text layer/i);
  expect(disclosure).toHaveTextContent(/extracted text.*AI processing service/i);
  expect(disclosure).toHaveTextContent(/no readable text.*cannot inform the AI draft/i);
  expect(disclosure).not.toHaveTextContent(/DeepSeek/i);
  expect(disclosure).toHaveTextContent(/do not prove.*non-confidential/i);
  expect(container.querySelector('input[type="file"]')).toHaveAttribute(
    'accept',
    'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,.txt,.csv'
  );
});

test('does not open the selector when current message context is confidential', async () => {
  mockPrivateStorageAvailable();
  const { container } = render(
    <AttachmentDropzone
      onAddLink={vi.fn()}
      sessionId="sess-context"
      messageContext="The attached brief contains confidential information"
    />
  );
  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
  await waitFor(() => expect(fileInput).not.toBeDisabled());
  const clickSpy = vi.spyOn(fileInput, 'click');

  fireEvent.click(screen.getByRole('button', { name: /store file privately/i }));

  expect(clickSpy).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(/cannot process confidential or sensitive material/i);
  expect(screen.getByRole('alert').textContent).not.toContain('attached brief');
});

test('blocks a confidential filename before consent persistence, byte reads, upload, or callbacks', async () => {
  const fetchMock = mockPrivateStorageAvailable();
  const onFileAnalyzed = vi.fn();
  const { container } = render(
    <AttachmentDropzone
      onAddLink={vi.fn()}
      onFileAnalyzed={onFileAnalyzed}
      sessionId="sess-guard"
      consent={analysisConsent}
    />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  const file = new File(['do not read'], 'confidential-client-brief.txt', { type: 'text/plain' });
  const arrayBufferSpy = vi.fn(async () => new ArrayBuffer(0));
  Object.defineProperty(file, 'arrayBuffer', { value: arrayBufferSpy });
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/cannot process confidential/i));
  expect(input.value).toBe('');
  expect(arrayBufferSpy).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toEqual([]);
  expect(onFileAnalyzed).not.toHaveBeenCalled();
});

test('allows a benign filename containing a near-match', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.method) return new Response(JSON.stringify({ available: true }), { status: 200 });
    if (String(input).includes('/consent')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, analyses: [{ extractedText: 'ordinary text', extractionStatus: 'extracted' }] }), { status: 200 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} sessionId="sess-safe" consent={analysisConsent} />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['hello'], 'personal-project.txt', { type: 'text/plain' })] }
  });

  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
});

test('shows the stable diversion only in the latest upload log when the server rejects a filename', async () => {
  const filename = 'ordinary-client-brief.txt';
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.method) return new Response(JSON.stringify({ available: true }), { status: 200 });
    if (String(input).includes('/consent')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ ok: false, code: 'confidential_file_not_allowed' }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as unknown as typeof fetch;
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} sessionId="sess-server-guard" consent={analysisConsent} />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['ordinary'], filename, { type: 'text/plain' })] }
  });

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/cannot process confidential/i));
  expect(screen.getByRole('status')).not.toHaveTextContent(/code|internal detail/i);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('classifies a pasted YouTube URL and adds a chip', async () => {
  const onAdd = vi.fn().mockResolvedValue({ status: 'saved' });

  render(<AttachmentDropzone onAddLink={onAdd} />);
  const input = screen.getByRole('textbox', { name: 'Reference link' });
  expect(input).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add link' })).toHaveClass('balance-widget-reference-button');
  fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith('https://youtu.be/abc'));
});

test('surfaces the canonical mutation error and keeps the URL for retry', async () => {
  const onAdd = vi.fn().mockResolvedValue({ status: 'failed', message: 'Reference status was not saved. Retry.' });

  render(<AttachmentDropzone onAddLink={onAdd} />);
  const input = screen.getByPlaceholderText(/paste a reference link/i);
  fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);

  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent(/Reference status was not saved/i);
  });
  expect(input).toHaveValue('https://youtu.be/abc');
});

test('requires an HTTPS URL before invoking the canonical mutation', async () => {
  const onAdd = vi.fn();

  render(<AttachmentDropzone onAddLink={onAdd} />);
  const input = screen.getByPlaceholderText(/paste a reference link/i);
  fireEvent.change(input, { target: { value: 'http://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);

  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent(/HTTPS/i);
  });
  expect(onAdd).not.toHaveBeenCalled();
});

test('renders a clear title-case header and short upload status', () => {
  render(<AttachmentDropzone onAddLink={vi.fn()} sessionId="sess-unavailable-copy" />);
  expect(
    screen.getByRole('heading', { name: /add references & files/i })
  ).toBeInTheDocument();
  expect(
    screen.getByText(/file sharing is temporarily unavailable.*reference link/i)
  ).toBeInTheDocument();
});

test('dropzone states that file sharing is unavailable and disables selection', () => {
  render(<AttachmentDropzone onAddLink={vi.fn()} sessionId="sess-unavailable" />);
  expect(screen.getByText(/file sharing unavailable/i)).toBeInTheDocument();
  expect(screen.getByText(/add a reference link above instead/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /file sharing unavailable/i })).toBeDisabled();
  expect(document.querySelector('input[type="file"]')).toBeDisabled();
});

test('does not repeat AI or producer consent at the file boundary', () => {
  render(<AttachmentDropzone onAddLink={vi.fn()} />);

  expect(screen.queryByLabelText(/balance assist may analyse/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/balance team may review anything/i)).not.toBeInTheDocument();
});

test('enables file selection only after the server verifies private storage', async () => {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/api/telegram/upload')) {
      return new Response(JSON.stringify({ available: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  const { container } = render(<AttachmentDropzone onAddLink={vi.fn()} sessionId="sess-ready" />);

  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  expect(screen.getByText(/upload a non-confidential file.*retained for 24 hours/i)).toBeInTheDocument();
  expect(screen.getByTestId('private-analysis-upload-disclosure')).toHaveTextContent(/never sent to the Balance team/i);
});

test('places the visible header before saved references and the reference form', () => {
  render(
    <AttachmentDropzone
      onAddLink={vi.fn()}
      sessionId={null}
      referenceLinks={[{ id: 'reference-1', kind: 'other', url: 'https://example.com/reference' }]}
    />
  );

  const heading = screen.getByRole('heading', { name: 'Add References & Files' });
  const savedHeading = screen.getByRole('heading', { name: 'Saved references' });
  const savedLink = screen.getByRole('link', { name: 'https://example.com/reference' });
  const input = screen.getByRole('textbox', { name: 'Reference link' });

  expect(heading.compareDocumentPosition(savedHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(savedHeading.compareDocumentPosition(savedLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(savedLink.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('keeps file selection disabled until a secure session ID exists', async () => {
  const fetchMock = mockPrivateStorageAvailable();
  const { container } = render(<AttachmentDropzone onAddLink={vi.fn()} />);

  await waitFor(() => expect(screen.getByText(/secure session starts/i)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /secure session starting/i })).toBeDisabled();
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  expect(input).toBeDisabled();

  fireEvent.change(input, { target: { files: [new File(['blocked'], 'blocked.txt', { type: 'text/plain' })] } });
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/secure session is still starting/i));
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toEqual([]);
  expect(input.value).toBe('');
});

test('URL submit button uses the uppercase ADD LINK pill copy', () => {
  render(<AttachmentDropzone onAddLink={vi.fn()} />);
  // The button uses the widget's uppercase pill pattern; the visible text is
  // normalised to uppercase via CSS text-transform on a mixed-case source.
  const addLinkButton = screen.getByRole('button', { name: /add link/i });
  expect(addLinkButton).toBeInTheDocument();
  expect(addLinkButton.tagName).toBe('BUTTON');
});

test('captures a private reference link without producer-transfer consent', async () => {
  const onAddLink = vi.fn().mockResolvedValue({ status: 'saved' });

  render(<AttachmentDropzone onAddLink={onAddLink} sessionId="sess-1" />);

  const input = screen.getByPlaceholderText(/paste a reference link/i);
  fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);

  await waitFor(() => {
    expect(onAddLink).toHaveBeenCalledWith('https://youtu.be/abc');
  });
  expect(screen.queryByLabelText(/balance team may review links/i)).not.toBeInTheDocument();
});

test('does not attempt analysis-only uploads while file sharing is unavailable', async () => {
  const onFileAnalyzed = vi.fn();
  const uploadedConsents: string[] = [];

  global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (String(_input).includes('/consent')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const form = init?.body as FormData;
    return new Response(JSON.stringify({ ok: true, extractedText: 'Project scope: launch film', forwarded: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as unknown as typeof fetch;

  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} onFileAnalyzed={onFileAnalyzed} sessionId="sess-disabled" />
  );

  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!fileInput) {
    throw new Error('File input missing');
  }

  expect(fileInput).toBeDisabled();

  expect(onFileAnalyzed).not.toHaveBeenCalled();
  expect(uploadedConsents).toHaveLength(0);
});

test('forwards only the server-derived analysis payload to the draft callback', async () => {
  const onFileAnalyzed = vi.fn();
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/consent')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (String(input).includes('/api/telegram/upload')) {
      if (!init?.method) {
        return new Response(JSON.stringify({ available: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true, status: 'stored', analyses: [{ mimeType: 'text/plain', extractedText: 'Server-verified brief text', extractionStatus: 'extracted' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  const { container } = render(<AttachmentDropzone onAddLink={vi.fn()} onFileAnalyzed={onFileAnalyzed} sessionId="sess-forward" consent={analysisConsent} />);
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['client text'], 'brief.txt', { type: 'text/plain' })] } });

  await waitFor(() => expect(onFileAnalyzed).toHaveBeenCalledWith('brief.txt', 'Server-verified brief text'));
  const uploadCall = vi.mocked(global.fetch).mock.calls.find(([, init]) => init?.method === 'POST' && init.body instanceof FormData);
  expect((uploadCall?.[1]?.body as FormData).get('mode')).toBe('analysis');
  expect(new Headers(uploadCall?.[1]?.headers).get('x-upload-mode')).toBe('analysis');
  expect(input.value).toBe('');
});

test('ignores an upload response after the active session changes', async () => {
  let resolveUpload!: (response: Response) => void;
  const pendingUpload = new Promise<Response>((resolve) => { resolveUpload = resolve; });
  const onFileAnalyzed = vi.fn();
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/consent')) return new Response('{}', { status: 200 });
    if (!init?.method) return new Response(JSON.stringify({ available: true }), { status: 200 });
    return pendingUpload;
  }) as unknown as typeof fetch;
  const props = { onAddLink: vi.fn(), onFileAnalyzed, consent: analysisConsent };
  const { container, rerender } = render(<AttachmentDropzone {...props} sessionId="sess-old" />);
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['old'], 'old-session.txt', { type: 'text/plain' })] }
  });
  await waitFor(() => expect(vi.mocked(global.fetch).mock.calls.some(([, init]) => init?.method === 'POST' && init.body instanceof FormData)).toBe(true));

  rerender(<AttachmentDropzone {...props} sessionId="sess-new" />);
  resolveUpload(new Response(JSON.stringify({ analyses: [{ extractedText: 'Stale analysis', extractionStatus: 'extracted' }] }), { status: 200 }));

  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  expect(onFileAnalyzed).not.toHaveBeenCalled();
  expect(screen.queryByText('old-session.txt')).not.toBeInTheDocument();
});

test('does not upload old-session files when the session changes while consent is being saved', async () => {
  let resolveConsent!: (response: Response) => void;
  const pendingConsent = new Promise<Response>((resolve) => { resolveConsent = resolve; });
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/consent')) return pendingConsent;
    if (!init?.method) return new Response(JSON.stringify({ available: true }), { status: 200 });
    return new Response(JSON.stringify({ analyses: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  const props = { onAddLink: vi.fn(), consent: analysisConsent };
  const { container, rerender } = render(<AttachmentDropzone {...props} sessionId="sess-consent-old" />);
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['old'], 'old-consent.txt', { type: 'text/plain' })] }
  });
  await waitFor(() => expect(vi.mocked(global.fetch).mock.calls.some(([input]) => String(input).includes('/consent'))).toBe(true));

  rerender(<AttachmentDropzone {...props} sessionId="sess-consent-new" />);
  resolveConsent(new Response('{}', { status: 200 }));

  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  expect(vi.mocked(global.fetch).mock.calls.some(([, init]) => init?.method === 'POST' && init.body instanceof FormData)).toBe(false);
});

test('awaits file analyses sequentially and reports stored files with no readable text', async () => {
  let releaseFirst: (() => void) | undefined;
  const firstAnalysis = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const onFileAnalyzed = vi.fn((fileName: string) => fileName === 'first.txt' ? firstAnalysis : undefined);
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/consent')) return new Response('{}', { status: 200 });
    if (!init?.method) return new Response(JSON.stringify({ available: true }), { status: 200 });
    return new Response(JSON.stringify({
      analyses: [
        { extractedText: 'First analysis', extractionStatus: 'extracted' },
        { extractedText: 'Second analysis', extractionStatus: 'extracted' },
        { extractedText: '', extractionStatus: 'no_text' }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} onFileAnalyzed={onFileAnalyzed} sessionId="sess-sequential" consent={analysisConsent} />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [
    new File(['first'], 'first.txt', { type: 'text/plain' }),
    new File(['second'], 'second.txt', { type: 'text/plain' }),
    new File(['image'], 'image.csv', { type: 'text/csv' })
  ] } });

  await waitFor(() => expect(onFileAnalyzed).toHaveBeenCalledTimes(1));
  expect(onFileAnalyzed).toHaveBeenLastCalledWith('first.txt', 'First analysis');
  releaseFirst?.();
  await waitFor(() => expect(onFileAnalyzed).toHaveBeenCalledTimes(2));
  expect(onFileAnalyzed).toHaveBeenLastCalledWith('second.txt', 'Second analysis');
  expect(await screen.findByText(/no readable text layer was found/i)).toBeInTheDocument();
  expect(input.value).toBe('');
});

test('maps storage errors, retains the file, and retries without another selection', async () => {
  let uploadAttempts = 0;
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/consent')) return new Response('{}', { status: 200 });
    if (!init?.method) return new Response(JSON.stringify({ available: true }), { status: 200 });
    uploadAttempts += 1;
    if (uploadAttempts === 1) {
      return new Response(JSON.stringify({ code: 'private_storage_upload_failed', error: 'internal detail' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({ ok: true, analyses: [{ extractedText: '', extractionStatus: 'no_text' }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} sessionId="sess-retry" consent={analysisConsent} />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['retry me'], 'retry.txt', { type: 'text/plain' });
  fireEvent.change(input, { target: { files: [file] } });

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/private storage could not accept/i));
  expect(screen.getByRole('status')).not.toHaveTextContent(/internal detail/i);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(input.value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
  await waitFor(() => expect(screen.getByText(/stored privately; no readable text layer was found/i)).toBeInTheDocument());
  expect(uploadAttempts).toBe(2);
});

test('explains a 413 response without offering a blind retry', async () => {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/consent')) return new Response('{}', { status: 200 });
    if (!init?.method) return new Response(JSON.stringify({ available: true }), { status: 200 });
    return new Response('', { status: 413 });
  }) as unknown as typeof fetch;
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} sessionId="sess-large" consent={analysisConsent} />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['small fixture'], 'brief.txt', { type: 'text/plain' })] }
  });
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/upload request is too large/i));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument();
});

test('does not offer a blind retry when the upload outcome is network-ambiguous', async () => {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/consent')) return new Response('{}', { status: 200 });
    if (!init?.method) return new Response(JSON.stringify({ available: true }), { status: 200 });
    throw new TypeError('network disconnected after request transmission');
  }) as unknown as typeof fetch;
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} sessionId="sess-ambiguous" consent={analysisConsent} />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['brief'], 'brief.txt', { type: 'text/plain' })] }
  });

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/could not be confirmed/i));
  expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument();
});

test('tracks duplicate filenames independently and reports every queued file', async () => {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/consent')) return new Response('{}', { status: 200 });
    if (!init?.method) return new Response(JSON.stringify({ available: true }), { status: 200 });
    return new Response(JSON.stringify({ analyses: [
      { extractedText: 'Readable first file', extractionStatus: 'extracted' },
      { extractedText: '', extractionStatus: 'no_text' }
    ] }), { status: 200 });
  }) as unknown as typeof fetch;
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} onFileAnalyzed={vi.fn()} sessionId="sess-duplicate" consent={analysisConsent} />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [
    new File(['first'], 'duplicate.txt', { type: 'text/plain' }),
    new File(['second'], 'duplicate.txt', { type: 'text/plain' })
  ] } });

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/no readable text layer was found/i));
  expect(screen.getAllByText('duplicate.txt')).toHaveLength(2);
  expect(screen.getByRole('status')).toHaveTextContent('Stored privately; no readable text layer was found');
});

test('reuses a recent private storage availability probe across popover remounts for the same session', async () => {
  const fetchMock = mockPrivateStorageAvailable();
  const first = render(<AttachmentDropzone onAddLink={vi.fn()} sessionId="sess-cache" />);
  await waitFor(() => expect(first.container.querySelector('input[type="file"]')).not.toBeDisabled());
  first.unmount();

  const second = render(<AttachmentDropzone onAddLink={vi.fn()} sessionId="sess-cache" />);
  await waitFor(() => expect(second.container.querySelector('input[type="file"]')).not.toBeDisabled());
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
