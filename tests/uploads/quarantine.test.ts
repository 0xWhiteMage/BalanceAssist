// @vitest-environment node
import { describe, expect, test } from 'vitest';
import {
  PRIVATE_ANALYSIS_UPLOAD_POLICY,
  validateFile,
  validateFileBatch
} from '@/lib/uploads/quarantine';
import { createAttachmentConsent, hasRequiredConsent } from '@/lib/uploads/consent';

function makeFileWithBytes(name: string, bytes: number[], type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function makePngBuffer(): ArrayBuffer {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const buf = new ArrayBuffer(header.length + 100);
  const view = new Uint8Array(buf);
  header.forEach((b, i) => (view[i] = b));
  return buf;
}

function makeJpegBuffer(): ArrayBuffer {
  const buf = new ArrayBuffer(108);
  const view = new Uint8Array(buf);
  view[0] = 0xff;
  view[1] = 0xd8;
  view[2] = 0xff;
  return buf;
}

function makePdfBuffer(): ArrayBuffer {
  const buf = new ArrayBuffer(100);
  const view = new Uint8Array(buf);
  view[0] = 0x25;
  view[1] = 0x50;
  view[2] = 0x44;
  view[3] = 0x46;
  return buf;
}

function makeGifBuffer(): ArrayBuffer {
  const buf = new ArrayBuffer(100);
  const view = new Uint8Array(buf);
  view[0] = 0x47;
  view[1] = 0x49;
  view[2] = 0x46;
  view[3] = 0x38;
  return buf;
}

function makeWebpBuffer(): ArrayBuffer {
  const buf = new ArrayBuffer(100);
  const view = new Uint8Array(buf);
  view[0] = 0x52;
  view[1] = 0x49;
  view[2] = 0x46;
  view[3] = 0x46;
  view[8] = 0x57;
  view[9] = 0x45;
  view[10] = 0x42;
  view[11] = 0x50;
  return buf;
}

function makeTextBuffer(content: string): ArrayBuffer {
  return new TextEncoder().encode(content).buffer;
}

test('exports the exact private AI analysis formats and limits', () => {
  expect(PRIVATE_ANALYSIS_UPLOAD_POLICY).toEqual({
    acceptedFormats: ['PNG', 'JPEG', 'GIF', 'WebP', 'PDF', 'TXT', 'CSV'],
    accept: 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,.txt,.csv',
    maxFiles: 5,
    maxFileSizeBytes: 4 * 1024 * 1024,
    maxTotalSizeBytes: 4 * 1024 * 1024,
    maxExtractedCharacters: 4000
  });
});

describe('validateFile', () => {
  test('rejects empty files', () => {
    const file = new File([], 'empty.png', { type: 'image/png' });
    const buf = new ArrayBuffer(0);
    expect(validateFile(file, buf)).toEqual({ ok: false, reason: 'File is empty.' });
  });

  test('rejects files exceeding 4 MB', () => {
    const buf = new ArrayBuffer(5 * 1024 * 1024);
    const file = makeFileWithBytes('big.png', [], 'image/png');
    Object.defineProperty(file, 'size', { value: 5 * 1024 * 1024 });
    expect(validateFile(file, buf)).toEqual({
      ok: false,
      reason: 'File is too large. Maximum size is 4 MB.'
    });
  });

  test('accepts a valid PNG with correct magic bytes', () => {
    const buf = makePngBuffer();
    const file = makeFileWithBytes('photo.png', [], 'image/png');
    Object.defineProperty(file, 'size', { value: buf.byteLength });
    expect(validateFile(file, buf)).toEqual({ ok: true, mime: 'image/png' });
  });

  test('accepts JPEG with correct magic bytes', () => {
    const buf = makeJpegBuffer();
    const file = makeFileWithBytes('photo.jpg', [], 'image/jpeg');
    Object.defineProperty(file, 'size', { value: buf.byteLength });
    expect(validateFile(file, buf)).toEqual({ ok: true, mime: 'image/jpeg' });
  });

  test('accepts PDF with correct magic bytes', () => {
    const buf = makePdfBuffer();
    const file = makeFileWithBytes('doc.pdf', [], 'application/pdf');
    Object.defineProperty(file, 'size', { value: buf.byteLength });
    expect(validateFile(file, buf)).toEqual({ ok: true, mime: 'application/pdf' });
  });

  test('accepts GIF', () => {
    const buf = makeGifBuffer();
    const file = makeFileWithBytes('anim.gif', [], 'image/gif');
    Object.defineProperty(file, 'size', { value: buf.byteLength });
    expect(validateFile(file, buf)).toEqual({ ok: true, mime: 'image/gif' });
  });

  test('accepts WebP', () => {
    const buf = makeWebpBuffer();
    const file = makeFileWithBytes('photo.webp', [], 'image/webp');
    Object.defineProperty(file, 'size', { value: buf.byteLength });
    expect(validateFile(file, buf)).toEqual({ ok: true, mime: 'image/webp' });
  });

  test('rejects executable disguised as image', () => {
    const buf = new ArrayBuffer(100);
    const view = new Uint8Array(buf);
    view[0] = 0x4d;
    view[1] = 0x5a;
    const file = makeFileWithBytes('trojan.png', [], 'image/png');
    Object.defineProperty(file, 'size', { value: buf.byteLength });
    const result = validateFile(file, buf);
    expect(result.ok).toBe(false);
  });

  test('accepts plain text file when magic bytes are unknown', () => {
    const text = 'Hello world, this is a plain text file.';
    const buf = makeTextBuffer(text);
    const file = makeFileWithBytes('notes.txt', [], 'text/plain');
    Object.defineProperty(file, 'size', { value: buf.byteLength });
    expect(validateFile(file, buf)).toEqual({ ok: true, mime: 'text/plain' });
  });

  test('accepts CSV file', () => {
    const csv = 'name,budget,timeline\nAcme,50000,3 months';
    const buf = makeTextBuffer(csv);
    const file = makeFileWithBytes('data.csv', [], 'text/csv');
    Object.defineProperty(file, 'size', { value: buf.byteLength });
    expect(validateFile(file, buf)).toEqual({ ok: true, mime: 'text/csv' });
  });

  test.each([
    ['notes.txt', ''],
    ['notes.txt', 'application/octet-stream'],
    ['data.csv', ''],
    ['data.csv', 'application/vnd.ms-excel']
  ])('accepts cross-browser text file %s declared as %j', (name, type) => {
    const buf = makeTextBuffer('project,launch film');
    const file = makeFileWithBytes(name, [], type);
    Object.defineProperty(file, 'size', { value: buf.byteLength });

    expect(validateFile(file, buf)).toEqual({
      ok: true,
      mime: name.endsWith('.csv') ? 'text/csv' : 'text/plain'
    });
  });

  test('rejects binary bytes spoofed as a cross-browser text file', () => {
    const buf = new Uint8Array([0x00, 0x4d, 0x5a]).buffer;
    const file = makeFileWithBytes('brief.txt', [], 'application/octet-stream');
    Object.defineProperty(file, 'size', { value: buf.byteLength });

    expect(validateFile(file, buf).ok).toBe(false);
  });

  test.each(['brief.txt', 'brief.csv'])('accepts strict UTF-8 Unicode and BOM throughout %s', (name) => {
    const buf = new TextEncoder().encode('\uFEFFClient says “launch in 東京”\nBudget,5000').buffer;
    const file = makeFileWithBytes(name, [], '');
    Object.defineProperty(file, 'size', { value: buf.byteLength });

    expect(validateFile(file, buf).ok).toBe(true);
  });

  test('rejects invalid UTF-8 in text files', () => {
    const buf = new Uint8Array([0x66, 0x6f, 0x80]).buffer;
    const file = makeFileWithBytes('brief.txt', [], 'text/plain');
    Object.defineProperty(file, 'size', { value: buf.byteLength });

    expect(validateFile(file, buf).ok).toBe(false);
  });

  test.each([
    new Uint8Array([...new Uint8Array(600).fill(0x61), 0x00]).buffer,
    new Uint8Array([...new Uint8Array(600).fill(0x61), 0xff]).buffer,
    new TextEncoder().encode(`${'a'.repeat(600)}\u0085tail`).buffer
  ])('rejects disallowed binary or control data after the old 512-byte prefix', (buf) => {
    const file = makeFileWithBytes('brief.txt', [], 'application/octet-stream');
    Object.defineProperty(file, 'size', { value: buf.byteLength });

    expect(validateFile(file, buf).ok).toBe(false);
  });

  test('rejects unknown file type', () => {
    const buf = new ArrayBuffer(50);
    const view = new Uint8Array(buf);
    view[0] = 0x00;
    view[1] = 0x01;
    view[2] = 0x02;
    const file = makeFileWithBytes('unknown.bin', [], 'application/octet-stream');
    Object.defineProperty(file, 'size', { value: buf.byteLength });
    const result = validateFile(file, buf);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toContain('Could not verify file type');
  });
});

describe('validateFileBatch', () => {
  test('rejects empty batch', () => {
    expect(validateFileBatch([])).toEqual({ ok: false, reason: 'No files provided.' });
  });

  test('rejects batch exceeding 5 files', () => {
    const files = Array.from({ length: 6 }, (_, i) => {
      const buf = makePngBuffer();
      const file = makeFileWithBytes(`file${i}.png`, [], 'image/png');
      Object.defineProperty(file, 'size', { value: buf.byteLength });
      return { file, buffer: buf };
    });
    expect(validateFileBatch(files)).toEqual({
      ok: false,
      reason: 'Too many files. Maximum is 5.'
    });
  });

  test('rejects batch exceeding 4 MB total', () => {
    const files = Array.from({ length: 3 }, (_, i) => {
      const buf = new ArrayBuffer(2 * 1024 * 1024);
      const view = new Uint8Array(buf);
      view[0] = 0x89;
      view[1] = 0x50;
      view[2] = 0x4e;
      view[3] = 0x47;
      const file = makeFileWithBytes(`big${i}.png`, [], 'image/png');
      Object.defineProperty(file, 'size', { value: buf.byteLength });
      return { file, buffer: buf };
    });
    expect(validateFileBatch(files)).toEqual({
      ok: false,
      reason: 'Total file size exceeds 4 MB limit.'
    });
  });

  test('rejects batch if total size exceeds 4 MB even with few files', () => {
    const files = Array.from({ length: 3 }, (_, i) => {
      const buf = new ArrayBuffer(2 * 1024 * 1024);
      const file = makeFileWithBytes(`big${i}.png`, [], 'image/png');
      Object.defineProperty(file, 'size', { value: buf.byteLength });
      return { file, buffer: buf };
    });
    expect(validateFileBatch(files)).toEqual({
      ok: false,
      reason: 'Total file size exceeds 4 MB limit.'
    });
  });

  test('accepts valid batch within limits', () => {
    const files = [
      { file: makeFileWithBytes('a.pdf', [], 'application/pdf'), buffer: makePdfBuffer() },
      { file: makeFileWithBytes('b.png', [], 'image/png'), buffer: makePngBuffer() }
    ];
    files.forEach(({ file, buffer }) => {
      Object.defineProperty(file, 'size', { value: buffer.byteLength });
    });
    expect(validateFileBatch(files)).toEqual({ ok: true });
  });
});

describe('createAttachmentConsent', () => {
  test('creates consent object with correct fields', () => {
    const consent = createAttachmentConsent(true, true);
    expect(consent.aiAnalysis).toBe(true);
    expect(consent.producerShare).toBe(true);
    expect(typeof consent.consentedAt).toBe('string');
    expect(new Date(consent.consentedAt).toISOString()).toBe(consent.consentedAt);
  });

  test('creates consent with false values', () => {
    const consent = createAttachmentConsent(false, false);
    expect(consent.aiAnalysis).toBe(false);
    expect(consent.producerShare).toBe(false);
  });
});

describe('hasRequiredConsent', () => {
  test('returns false for null', () => {
    expect(hasRequiredConsent(null)).toBe(false);
  });

  test('returns true when producerShare is true even if aiAnalysis is false', () => {
    const consent = createAttachmentConsent(false, true);
    expect(hasRequiredConsent(consent)).toBe(true);
  });

  test('returns true when aiAnalysis is true even if producerShare is false', () => {
    const consent = createAttachmentConsent(true, false);
    expect(hasRequiredConsent(consent)).toBe(true);
  });

  test('returns true when both are true', () => {
    const consent = createAttachmentConsent(true, true);
    expect(hasRequiredConsent(consent)).toBe(true);
  });

  test('returns false when both consents are false', () => {
    const consent = createAttachmentConsent(false, false);
    expect(hasRequiredConsent(consent)).toBe(false);
  });
});
