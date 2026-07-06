import { classifyUrl } from '@/lib/uploads/url-detect';

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