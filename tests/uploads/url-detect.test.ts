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
  ['https://8.8.8.8/reference', 'https://8.8.8.8/reference'],
  ['https://[2606:4700:4700::1111]/reference?z=2&a=1', 'https://[2606:4700:4700::1111]/reference?a=1&z=2'],
  ['https://[2001:4860:4860:0:0:0:0:8888]/reference', 'https://[2001:4860:4860:0:0:0:0:8888]/reference'],
  ['https://[2001:4860::192.0.2.1]/reference', 'https://[2001:4860::192.0.2.1]/reference']
])('accepts and canonicalizes public IP reference %s', (url, expected) => {
  expect(normalizePublicReferenceUrl(url)).toBe(expected);
});

test.each([
  ['0/8', 'https://0.255.255.255/reference'],
  ['10/8', 'https://10.0.0.1/reference'],
  ['100.64/10', 'https://100.127.255.255/reference'],
  ['127/8', 'https://127.0.0.1/reference'],
  ['169.254/16', 'https://169.254.1.1/reference'],
  ['172.16/12', 'https://172.31.255.255/reference'],
  ['192.0.0/24', 'https://192.0.0.1/reference'],
  ['192.168/16', 'https://192.168.1.1/reference'],
  ['192.88.99/24', 'https://192.88.99.1/reference'],
  ['198.18/15', 'https://198.19.255.255/reference'],
  ['198.51.100/24', 'https://198.51.100.1/reference'],
  ['203.0.113/24', 'https://203.0.113.1/reference'],
  ['224/3', 'https://255.255.255.255/reference']
])('rejects reserved IPv4 range %s', (_range, url) => {
  expect(normalizePublicReferenceUrl(url)).toBeNull();
});

test.each([
  'https://1.0.0.0/reference',
  'https://100.63.255.255/reference',
  'https://100.128.0.0/reference',
  'https://169.253.255.255/reference',
  'https://169.255.0.0/reference',
  'https://172.15.255.255/reference',
  'https://172.32.0.0/reference',
  'https://192.0.1.0/reference',
  'https://192.88.98.255/reference',
  'https://192.88.100.0/reference',
  'https://198.17.255.255/reference',
  'https://198.20.0.0/reference',
  'https://198.51.99.255/reference',
  'https://198.51.101.0/reference',
  'https://203.0.112.255/reference',
  'https://203.0.114.0/reference',
  'https://223.255.255.255/reference'
])('accepts IPv4 address immediately outside the SQL reserved ranges: %s', (url) => {
  expect(normalizePublicReferenceUrl(url)).toBe(url);
});

test.each([
  ['::/128', 'https://[::]/reference'],
  ['::1/128', 'https://[0:0:0:0:0:0:0:1]/reference'],
  ['100::/64', 'https://[100::ffff]/reference'],
  ['fc00::/7', 'https://[fdff:ffff::1]/reference'],
  ['fe80::/10', 'https://[febf:ffff::1]/reference'],
  ['ff00::/8', 'https://[ffff::1]/reference'],
  ['2001:2::/48', 'https://[2001:2:0:ffff::1]/reference'],
  ['2001:db8::/32', 'https://[2001:db8:ffff::1]/reference']
])('rejects reserved IPv6 range %s', (_range, url) => {
  expect(normalizePublicReferenceUrl(url)).toBeNull();
});

test.each([
  'https://[::2]/reference',
  'https://[100:0:0:1::]/reference',
  'https://[fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff]/reference',
  'https://[fec0::]/reference',
  'https://[feff:ffff::]/reference',
  'https://[2001:1:ffff:ffff::]/reference',
  'https://[2001:2:1::]/reference',
  'https://[2001:db7:ffff::]/reference',
  'https://[2001:db9::]/reference'
])('accepts IPv6 address immediately outside the SQL reserved ranges: %s', (url) => {
  expect(normalizePublicReferenceUrl(url)).toBe(url);
});

test.each([
  'https://999.1.1.1/reference',
  'https://[2001::db8::1]/reference',
  'https://[2001:db8:0:0:0:0:0:0:1]/reference',
  'https://[2001:db8:xyz::1]/reference',
  'https://[1:2:3:4:5:6:7]/reference'
])('rejects malformed IP literal %s', (url) => {
  expect(normalizePublicReferenceUrl(url)).toBeNull();
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
