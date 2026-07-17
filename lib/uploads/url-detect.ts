const PATTERNS: Array<[RegExp, 'youtube' | 'vimeo' | 'figma' | 'loom' | 'gdrive']> = [
  [/(?:youtu\.be|youtube\.com)/, 'youtube'],
  [/vimeo\.com/, 'vimeo'],
  [/figma\.com/, 'figma'],
  [/loom\.com/, 'loom'],
  [/(?:drive|docs)\.google\.com/, 'gdrive']
];

export type LinkKind = 'youtube' | 'vimeo' | 'figma' | 'loom' | 'gdrive' | 'other';

const SENSITIVE_QUERY_KEYS = new Set([
  'signature', 'token', 'secret', 'credential', 'password', 'authorization', 'auth', 'api_key', 'apikey',
  'access_key', 'accesskey', 'sig', 'se', 'x_amz_signature', 'x_amz_credential', 'x_amz_security_token',
  'x_goog_signature', 'x_goog_credential', 'x_ms_signature'
]);

export function normalizePublicReferenceUrl(input: string): string | null {
  const match = input.trim().match(/^https:\/\/([^/?#@]+)(\/[^?#]*)?(\?[^#]*)?$/i);
  if (!match) return null;
  const host = match[1].toLowerCase().replace(/\.$/, '');
  if (
    !host || host.includes(':') || !/^[a-z0-9.-]+$/.test(host) || !host.includes('.') ||
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host.endsWith('.internal') || host.endsWith('.test')
  ) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const octets = host.split('.').map(Number);
    if (
      octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255) ||
      octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] >= 224 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168)
    ) return null;
  }
  const queryEntries = match[3]?.slice(1).split('&') ?? [];
  for (const entry of queryEntries) {
    const key = entry.split('=', 1)[0].toLowerCase().replaceAll('-', '_');
    if (SENSITIVE_QUERY_KEYS.has(key)) return null;
  }
  const query = queryEntries.length > 0 ? `?${queryEntries.sort().join('&')}` : '';
  return `https://${host}${match[2] ?? ''}${query}`;
}

export function getReferencePresenceStatus(links: ReadonlyArray<{ url: string }>): 'added' | 'skipped' {
  return links.some((link) => normalizePublicReferenceUrl(link.url) !== null) ? 'added' : 'skipped';
}

export function classifyUrl(input: string): LinkKind | null {
  const normalized = normalizePublicReferenceUrl(input);
  if (!normalized) return null;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return null;
  }
  for (const [pattern, kind] of PATTERNS) {
    if (pattern.test(url.hostname)) return kind;
  }
  return 'other';
}
