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

export const PUBLIC_REFERENCE_RESERVED_IP_RANGES = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16',
  '172.16.0.0/12', '192.0.0.0/24', '192.168.0.0/16', '192.88.99.0/24', '198.18.0.0/15',
  '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/3', '::/128', '::1/128', '100::/64',
  'fc00::/7', 'fe80::/10', 'ff00::/8', '2001:2::/48', '2001:db8::/32'
] as const;

function parseIpv4(value: string): bigint | null {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  if (octets.some((part) => part > 255)) return null;
  return octets.reduce((address, part) => address << 8n | BigInt(part), 0n);
}

function parseIpv6(value: string): bigint | null {
  const compressedParts = value.split('::');
  if (compressedParts.length > 2) return null;

  const parseSegments = (part: string, canContainIpv4: boolean): number[] | null => {
    if (!part) return [];
    const segments = part.split(':');
    if (segments.some((segment) => !segment)) return null;
    const last = segments.at(-1)!;
    if (last.includes('.')) {
      if (!canContainIpv4) return null;
      const ipv4 = parseIpv4(last);
      if (ipv4 === null) return null;
      segments.splice(-1, 1, (ipv4 >> 16n).toString(16), (ipv4 & 0xffffn).toString(16));
    }
    if (segments.some((segment) => !/^[0-9a-f]{1,4}$/.test(segment))) return null;
    return segments.map((segment) => Number.parseInt(segment, 16));
  };

  const leading = parseSegments(compressedParts[0], compressedParts.length === 1);
  const trailing = compressedParts.length === 2 ? parseSegments(compressedParts[1], true) : [];
  if (!leading || !trailing) return null;
  const suppliedCount = leading.length + trailing.length;
  if (compressedParts.length === 1 ? suppliedCount !== 8 : suppliedCount >= 8) return null;

  const segments = compressedParts.length === 1
    ? leading
    : [...leading, ...Array<number>(8 - suppliedCount).fill(0), ...trailing];
  return segments.reduce((address, segment) => address << 16n | BigInt(segment), 0n);
}

const RESERVED_IP_RANGES = PUBLIC_REFERENCE_RESERVED_IP_RANGES.map((range) => {
  const separator = range.lastIndexOf('/');
  const network = range.slice(0, separator);
  const prefixLength = Number(range.slice(separator + 1));
  const version = network.includes(':') ? 6 : 4;
  return { network: version === 6 ? parseIpv6(network)! : parseIpv4(network)!, prefixLength, version };
});

function isReservedIp(address: bigint, version: 4 | 6) {
  const bits = version === 4 ? 32 : 128;
  return RESERVED_IP_RANGES.some((range) => {
    if (range.version !== version) return false;
    const shift = BigInt(bits - range.prefixLength);
    return address >> shift === range.network >> shift;
  });
}

export function normalizePublicReferenceUrl(input: string): string | null {
  const match = input.trim().match(/^https:\/\/([^/?#@]+)(\/[^?#]*)?(\?[^#]*)?$/i);
  if (!match) return null;
  const host = match[1].toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    host.endsWith('.internal') || host.endsWith('.test')) return null;

  if (/^\[[0-9a-f:.]+\]$/.test(host)) {
    const address = parseIpv6(host.slice(1, -1));
    if (address === null || isReservedIp(address, 6)) return null;
  } else if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const address = parseIpv4(host);
    if (address === null || isReservedIp(address, 4)) return null;
  } else if (host.includes(':') || !/^[a-z0-9.-]+$/.test(host) || !host.includes('.')) {
    return null;
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
