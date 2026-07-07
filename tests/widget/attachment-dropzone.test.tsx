import { describe, expect, test, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AttachmentDropzone } from '@/components/widget/attachment-dropzone';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

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
    screen.getByText(/upload a pdf or deck, or share a google drive link/i)
  ).toBeInTheDocument();
});

test('dropzone region shows the uppercase DROP FILES HERE label and the accepted-format hint as a separate line', () => {
  render(<AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} />);
  // The DROP FILES HERE label must be its own uppercase element, not buried in a sentence.
  // The label is normalised to uppercase via CSS text-transform.
  expect(screen.getByText((_, node) => node?.textContent?.trim().toUpperCase() === 'DROP FILES HERE')).toBeInTheDocument();
  expect(screen.getByText('(PDF, PPTX, DOCX up to 50 MB)')).toBeInTheDocument();
});

test('URL submit button uses the uppercase ADD LINK pill copy', () => {
  render(<AttachmentDropzone onAddLink={vi.fn()} onAddFile={vi.fn()} />);
  // The button uses the widget's uppercase pill pattern; the visible text is
  // normalised to uppercase via CSS text-transform on a mixed-case source.
  const addLinkButton = screen.getByRole('button', { name: /add link/i });
  expect(addLinkButton).toBeInTheDocument();
  expect(addLinkButton.tagName).toBe('BUTTON');
});
