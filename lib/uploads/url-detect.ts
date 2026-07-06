const PATTERNS: Array<[RegExp, 'youtube' | 'vimeo' | 'figma' | 'loom' | 'gdrive']> = [
  [/(?:youtu\.be|youtube\.com)/, 'youtube'],
  [/vimeo\.com/, 'vimeo'],
  [/figma\.com/, 'figma'],
  [/loom\.com/, 'loom'],
  [/(?:drive|docs)\.google\.com/, 'gdrive']
];

export type LinkKind = 'youtube' | 'vimeo' | 'figma' | 'loom' | 'gdrive' | 'other';

export function classifyUrl(input: string): LinkKind | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  for (const [pattern, kind] of PATTERNS) {
    if (pattern.test(url.hostname)) return kind;
  }
  return 'other';
}