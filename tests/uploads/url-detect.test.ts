import { classifyUrl, getReferencePresenceStatus, normalizePublicReferenceUrl } from '@/lib/uploads/url-detect';

test.each([
  ['https://youtu.be/abc123', 'youtube'],
  ['https://www.youtube.com/watch?v=abc', 'youtube'],
  ['https://vimeo.com/12345', 'vimeo'],
  ['https://www.figma.com/file/abc', 'figma'],
  ['https://www.loom.com/share/abc', 'loom'],
  ['https://drive.google.com/file/d/abc', 'gdrive'],
  ['https://docs.google.com/document/d/abc', 'gdrive'],
  ['https://example.com/asset.pdf', 'other']
])('classifies %s as %s', (url, kind) => {
  expect(classifyUrl(url)).toBe(kind);
});

test('returns null for non-URL', () => {
  expect(classifyUrl('not a url')).toBeNull();
});

test('normalizes public HTTPS references like finalization', () => {
  expect(normalizePublicReferenceUrl('  https://EXAMPLE.com./board?z=2&a=1  ')).toBe('https://example.com/board?a=1&z=2');
});

test.each([
  'http://example.com/board',
  'ftp://example.com/board',
  'https://user:pass@example.com/board',
  'https://localhost/board',
  'https://assets.internal/board',
  'https://example.com/board?token=secret',
  'https://example.com/board#fragment'
])('rejects a non-transferable public reference %s', (url) => {
  expect(normalizePublicReferenceUrl(url)).toBeNull();
  expect(classifyUrl(url)).toBeNull();
});

test('derives added only while a transferable HTTPS reference remains', () => {
  expect(getReferencePresenceStatus([
    { url: 'http://legacy.example.com/board' },
    { url: 'https://example.com/current' }
  ])).toBe('added');
  expect(getReferencePresenceStatus([{ url: 'http://legacy.example.com/board' }])).toBe('skipped');
  expect(getReferencePresenceStatus([])).toBe('skipped');
});
