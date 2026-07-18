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

test('discloses the exact AI formats, limits, extraction behavior, and DeepSeek flow before selection', async () => {
  mockPrivateStorageAvailable();
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());

  const disclosure = screen.getByTestId('private-analysis-upload-disclosure');
  expect(disclosure).toHaveTextContent(/PNG, JPEG, GIF, WebP, PDF, TXT, and CSV/i);
  expect(disclosure).toHaveTextContent(/up to 5 files/i);
  expect(disclosure).toHaveTextContent(/10 MB each/i);
  expect(disclosure).toHaveTextContent(/25 MB total/i);
  expect(disclosure).toHaveTextContent(/TXT and PDF.*up to 4,000 characters/i);
  expect(disclosure).toHaveTextContent(/images and CSV may yield no extracted text/i);
  expect(disclosure).toHaveTextContent(/extracted text.*DeepSeek/i);
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
      onAddFile={vi.fn()}
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
  const onAddFile = vi.fn();
  const onFileAnalyzed = vi.fn();
  const { container } = render(
    <AttachmentDropzone
      onAddLink={vi.fn()}
      onAddFile={onAddFile}
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
  expect(onAddFile).not.toHaveBeenCalled();
  expect(onFileAnalyzed).not.toHaveBeenCalled();
});

test('allows a benign filename containing a near-match', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.method) return new Response(JSON.stringify({ available: true }), { status: 200 });
    if (String(input).includes('/consent')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, analyses: [{ extractedText: 'ordinary text' }] }), { status: 200 });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  const { container } = render(
    <AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} sessionId="sess-safe" consent={analysisConsent} />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(['hello'], 'personal-project.txt', { type: 'text/plain' })] }
  });

  await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
});

test('shows the stable non-echoing diversion when the server rejects a filename', async () => {
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
    <AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} sessionId="sess-server-guard" consent={analysisConsent} />
  );
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
    target: { files: [new File(['ordinary'], filename, { type: 'text/plain' })] }
  });

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/cannot process confidential/i));
  expect(screen.getByRole('alert').textContent).not.toContain(filename);
});

test('classifies a pasted YouTube URL and adds a chip', async () => {
  const onAdd = vi.fn().mockResolvedValue({ status: 'saved' });

  render(<AttachmentDropzone onAddLink={onAdd} onAddFile={vi.fn()} />);
  const input = screen.getByRole('textbox', { name: 'Reference link' });
  expect(input).toBeVisible();
  expect(screen.getByRole('button', { name: 'Add link' })).toHaveClass('balance-widget-action');
  fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith('https://youtu.be/abc'));
});

test('surfaces the canonical mutation error and keeps the URL for retry', async () => {
  const onAdd = vi.fn().mockResolvedValue({ status: 'failed', message: 'Reference status was not saved. Retry.' });

  render(<AttachmentDropzone onAddLink={onAdd} onAddFile={vi.fn()} />);
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

  render(<AttachmentDropzone onAddLink={onAdd} onAddFile={vi.fn()} />);
  const input = screen.getByPlaceholderText(/paste a reference link/i);
  fireEvent.change(input, { target: { value: 'http://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);

  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent(/HTTPS/i);
  });
  expect(onAdd).not.toHaveBeenCalled();
});

test('renders the uppercase section header and short subhead describing the upload affordance', () => {
  render(<AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} />);
  expect(
    screen.getByText(/share files to help us understand your project/i)
  ).toBeInTheDocument();
  expect(
    screen.getByText(/file sharing is temporarily unavailable.*reference link/i)
  ).toBeInTheDocument();
});

test('dropzone states that file sharing is unavailable and disables selection', () => {
  render(<AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} />);
  expect(screen.getByText(/file sharing unavailable/i)).toBeInTheDocument();
  expect(screen.getByText(/add a reference link above instead/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /file sharing unavailable/i })).toBeDisabled();
  expect(document.querySelector('input[type="file"]')).toBeDisabled();
});

test('does not repeat AI or producer consent at the file boundary', () => {
  render(<AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} />);

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
  const { container } = render(<AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} />);

  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  expect(screen.getByText(/never sent to the team/i)).toBeInTheDocument();
});

test('URL submit button uses the uppercase ADD LINK pill copy', () => {
  render(<AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} />);
  // The button uses the widget's uppercase pill pattern; the visible text is
  // normalised to uppercase via CSS text-transform on a mixed-case source.
  const addLinkButton = screen.getByRole('button', { name: /add link/i });
  expect(addLinkButton).toBeInTheDocument();
  expect(addLinkButton.tagName).toBe('BUTTON');
});

test('captures a private reference link without producer-transfer consent', async () => {
  const onAddLink = vi.fn().mockResolvedValue({ status: 'saved' });

  render(<AttachmentDropzone onAddLink={onAddLink} onAddFile={vi.fn()} sessionId="sess-1" />);

  const input = screen.getByPlaceholderText(/paste a reference link/i);
  fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);

  await waitFor(() => {
    expect(onAddLink).toHaveBeenCalledWith('https://youtu.be/abc');
  });
  expect(screen.queryByLabelText(/balance team may review links/i)).not.toBeInTheDocument();
});

test('does not attempt analysis-only uploads while file sharing is unavailable', async () => {
  const onAddFile = vi.fn();
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
    <AttachmentDropzone onAddLink={vi.fn()} onAddFile={onAddFile} onFileAnalyzed={onFileAnalyzed} sessionId="sess-2" />
  );

  const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!fileInput) {
    throw new Error('File input missing');
  }

  expect(fileInput).toBeDisabled();

  expect(onAddFile).not.toHaveBeenCalled();
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
      return new Response(JSON.stringify({ ok: true, status: 'stored', analyses: [{ mimeType: 'text/plain', extractedText: 'Server-verified brief text' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  const { container } = render(<AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} onFileAnalyzed={onFileAnalyzed} sessionId="sess-2" consent={analysisConsent} />);
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['client text'], 'brief.txt', { type: 'text/plain' })] } });

  await waitFor(() => expect(onFileAnalyzed).toHaveBeenCalledWith('brief.txt', 'Server-verified brief text'));
  const uploadCall = vi.mocked(global.fetch).mock.calls.find(([, init]) => init?.method === 'POST' && init.body instanceof FormData);
  expect((uploadCall?.[1]?.body as FormData).get('mode')).toBe('analysis');
  expect(new Headers(uploadCall?.[1]?.headers).get('x-upload-mode')).toBe('analysis');
});
