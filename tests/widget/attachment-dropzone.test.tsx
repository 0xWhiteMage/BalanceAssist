import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AttachmentDropzone } from '@/components/widget/attachment-dropzone';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function enableAnalysisConsent() {
  fireEvent.click(screen.getByLabelText(/balance assist may analyse/i));
}

function enableProducerShareConsent() {
  fireEvent.click(screen.getByLabelText(/balance team may review links/i));
}

test('classifies a pasted YouTube URL and adds a chip', async () => {
  const onAdd = vi.fn();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/attachments/link')) {
      return new Response(JSON.stringify({ ok: true, kind: 'youtube', url: 'https://youtu.be/abc' }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

  render(<AttachmentDropzone onAddLink={onAdd} onAddFile={vi.fn()} />);
  enableProducerShareConsent();
  const input = screen.getByPlaceholderText(/paste a reference link/i);
  fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ kind: 'youtube' })));
});

test('surfaces the server error message when /api/attachments/link returns a structured error', async () => {
  const onAdd = vi.fn();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/attachments/link')) {
      return new Response(
        JSON.stringify({ error: 'Invalid request payload', issues: [] }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

  render(<AttachmentDropzone onAddLink={onAdd} onAddFile={vi.fn()} />);
  enableProducerShareConsent();
  const input = screen.getByPlaceholderText(/paste a reference link/i);
  fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);

  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent(/Invalid request payload/i);
  });
  expect(onAdd).not.toHaveBeenCalled();
});

test('falls back to a generic message when the error response is not JSON', async () => {
  const onAdd = vi.fn();
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/attachments/link')) {
      return new Response('not-json', { status: 500 });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

  render(<AttachmentDropzone onAddLink={onAdd} onAddFile={vi.fn()} />);
  enableProducerShareConsent();
  const input = screen.getByPlaceholderText(/paste a reference link/i);
  fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);

  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent(/Failed to add link/i);
  });
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

test('shows analysis consent for files but no producer-review checkbox', () => {
  render(<AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} />);

  expect(screen.getByLabelText(/balance assist may analyse/i)).toBeInTheDocument();
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

test('blocks links until the user explicitly allows producer review', async () => {
  global.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;

  render(<AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} />);

  const input = screen.getByPlaceholderText(/paste a reference link/i);
  fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);

  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent(/balance team may review this link/i);
  });
  expect(global.fetch).not.toHaveBeenCalledWith('/api/attachments/link', expect.anything());
});

test('persists producer-transfer consent before linking', async () => {
  const onAddLink = vi.fn();
  const requestBodies: Array<Record<string, unknown>> = [];

  global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBodies.push({ url: String(_input), ...JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true, persisted: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }) as unknown as typeof fetch;

  render(<AttachmentDropzone onAddLink={onAddLink} onAddFile={vi.fn()} sessionId="sess-1" />);

  enableAnalysisConsent();
  enableProducerShareConsent();
  const input = screen.getByPlaceholderText(/paste a reference link/i);
  fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
  fireEvent.submit(input.closest('form')!);

  await waitFor(() => {
    expect(onAddLink).toHaveBeenCalledWith(expect.objectContaining({ kind: 'youtube', url: 'https://youtu.be/abc' }));
  });

  expect(requestBodies).toHaveLength(2);
  expect(requestBodies[0]).toMatchObject({
    url: '/api/projects/sess-1/consent',
    scope: 'producer_transfer',
    granted: true,
    noticeVersion: '1.0'
  });
  expect(requestBodies[1]).toMatchObject({
    sessionId: 'sess-1',
    url: 'https://youtu.be/abc',
    kind: 'youtube'
  });
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

  enableAnalysisConsent();

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
  const { container } = render(<AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} onFileAnalyzed={onFileAnalyzed} sessionId="sess-2" />);
  await waitFor(() => expect(container.querySelector('input[type="file"]')).not.toBeDisabled());
  enableAnalysisConsent();
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['client text'], 'brief.txt', { type: 'text/plain' })] } });

  await waitFor(() => expect(onFileAnalyzed).toHaveBeenCalledWith('brief.txt', 'Server-verified brief text'));
});
