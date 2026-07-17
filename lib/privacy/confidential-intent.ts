export type ConfidentialIntentResult =
  | 'allow'
  | 'nda'
  | 'confidential'
  | 'unreleased'
  | 'personal-data'
  | 'sensitive';

export const CONFIDENTIAL_INTAKE_RESPONSE =
  'This channel cannot process confidential or sensitive material. Please use the human-only path to talk to the Balance team.';

const NEGATED_PHRASES = [
  /\b(?:is|are|was|were) not (?:strictly |highly )?confidential\b/g,
  /\bno longer (?:strictly |highly )?confidential\b/g,
  /\b(?:contains?|includes?|has|have) no personal data\b/g,
  /\b(?:does not|doesn't|do not|don't) contain personal data\b/g,
  /\b(?:is|are|was|were) not (?:highly )?sensitive\b/g,
  /\b(?:is|are|was|were) (?:highly )?sensitive to (?:light|heat|temperature|moisture|pressure|touch|sound)\b/g,
  /\b(?:is|are|was|were) (?:not|no longer) (?:under|covered by|subject to|bound by|protected by) (?:an? |the |our )?(?:nda|non disclosure agreement)\b/g,
  /\b(?:this|that|it) (?:is|was) (?:not|no longer) (?:an? )?(?:unreleased|pre release|unannounced) (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/g,
  /\b(?:am|is|are|was|were) (?:not|no longer) (?:sharing|sending|uploading|providing|processing) (?:an? |the |our |my |client )?(?:unreleased|pre release|unannounced) (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/g,
  /\b(?:do not|don't|does not|doesn't) (?:have|possess) (?:any )?(?:unreleased|pre release|unannounced) (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/g,
  /\b(?:has|have) no (?:unreleased|pre release|unannounced) (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/g,
  /\bno longer (?:has|have|possess(?:es)?) (?:an? |the |our |my |client )?(?:unreleased|pre release|unannounced) (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/g,
  /\b(?:project|campaign|product|film|video|footage|media|assets?|creative|launch) (?:is|are|was|were) (?:not|no longer) (?:unreleased|pre release|unannounced)\b/g,
  /\b(?:has|have) already been released\b/g,
  /\b(?:is|are|was|were) already released\b/g
];

const CATEGORY_PATTERNS: ReadonlyArray<{
  category: Exclude<ConfidentialIntentResult, 'allow'>;
  patterns: readonly RegExp[];
}> = [
  {
    category: 'nda',
    patterns: [
      /\b(?:under|covered by|subject to|bound by|protected by) (?:an? |the |our )?(?:nda|non disclosure agreement)\b/,
      /\b(?:nda|non disclosure agreement) protected (?:information|data|documents?|materials?|content|details|files?)\b/,
      /\b(?:share|send|upload|provide|process) (?:an? )?(?:nda|non disclosure agreement) (?:protected |restricted )?(?:information|data|documents?|materials?|content|details|files?)\b/
    ]
  },
  {
    category: 'confidential',
    patterns: [
      /\b(?:contains?|includes?|shar(?:e|ing)|send(?:ing)?|upload(?:ing)?|provid(?:e|ing)|process(?:ing)?) (?:strictly |highly )?confidential (?:client )?(?:information|data|documents?|materials?|content|details|brief|files?)\b/,
      /\b(?:contains?|includes?|shar(?:e|ing)|send(?:ing)?|upload(?:ing)?|provid(?:e|ing)|process(?:ing)?) proprietary (?:client )?(?:information|data|documents?|materials?|content|details|briefs?|files?)\b/,
      /\b(?:this|that|it|these|those) (?:is|are) proprietary (?:client )?(?:information|data|documents?|materials?|content|details|briefs?|files?)\b/,
      /\b(?:please )?keep (?:this|that|it|the attached (?:brief|file|document|material)) (?:a )?secret between us\b/,
      /\b(?:this|that|it|these|those) (?:is|are) (?:strictly |highly )?confidential\b/,
      /\b(?:this|that|the|our|my|client|these|those) (?:attached )?(?:projects?|briefs?|files?|documents?|materials?|information|campaigns?|products?|content)(?: details)? (?:is|are|contains?|includes?) (?:strictly |highly )?confidential(?: (?:information|data|documents?|materials?|content|details|briefs?|files?))?\b/,
      /\b(?:confidential client|client confidential) (?:information|data|documents?|materials?|content|details|briefs?|files?)\b/
    ]
  },
  {
    category: 'unreleased',
    patterns: [
      /\b(?:this|that|it) (?:is|are) (?:an? )?embargoed (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/,
      /\b(?:project|campaign|product|film|video|footage|media|assets?|creative|launch) (?:is|are) embargoed\b/,
      /\b(?:shar(?:e|ing)|send(?:ing)?|upload(?:ing)?|provid(?:e|ing)|process(?:ing)?) (?:an? |the |our |my |client )?embargoed (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/,
      /\b(?:this|that|it) (?:has|have) not been announced yet\b/,
      /\b(?:project|campaign|product|film|video|footage|media|assets?|creative|launch) (?:has|have) not been announced yet\b/,
      /\b(?:project|campaign|product|film|video|footage|media|assets?|creative|launch) (?:is|are|was|were) not announced yet\b/,
      /\b(?:this|that|the|our|my|client|an?) (?:project|campaign|product|film|video|footage|media|asset|assets|creative|launch) (?:is|are) (?:unreleased|pre release|unannounced)\b/,
      /\b(?:this|that|it) (?:is|are) (?:an? )?(?:unreleased|pre release|unannounced) (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/,
      /\b(?:share|send|upload|provide|process|contains?|includes?) (?:an? |the |our |my |client )?(?:unreleased|pre release|unannounced) (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/,
      /\b(?:unreleased|pre release|unannounced) (?:client )?(?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/
    ]
  },
  {
    category: 'personal-data',
    patterns: [
      /\b(?:contains?|includes?|shar(?:e|ing)|send(?:ing)?|upload(?:ing)?|provid(?:e|ing)|process(?:ing)?) (?:pii|passport (?:numbers?|details)|identity documents?)\b/,
      /\b(?:contains?|includes?|shar(?:e|ing)|send(?:ing)?|upload(?:ing)?|provid(?:e|ing)|process(?:ing)?) (?:private )?(?:personal data|personally identifiable information|personally identifying information|identifying details|contact details|contact information)\b/,
      /\b(?:this|that|the|our|my|client) (?:attached )?(?:brief|file|document|material)? ?(?:contains?|includes?|has) (?:private )?(?:pii|personal data|personally identifiable information|personally identifying information|identifying details|contact details|contact information)\b/
    ]
  },
  {
    category: 'sensitive',
    patterns: [
      /\b(?:contains?|includes?|shar(?:e|ing)|send(?:ing)?|upload(?:ing)?|provid(?:e|ing)|process(?:ing)?) (?:highly )?sensitive (?:client )?(?:information|data|documents?|materials?|content|details|files?)\b/,
      /\b(?:this|that|it|these|those) (?:is|are) (?:highly )?sensitive\b/,
      /\b(?:the|our|my|client) (?:attached )?(?:brief|file|document|material|information|data)(?: details)? (?:is|are|contains?|includes?) (?:highly )?sensitive(?: (?:information|data|documents?|materials?|content|details|files?))?\b/
    ]
  }
];

const FILENAME_CATEGORY_PRIORITY: Record<Exclude<ConfidentialIntentResult, 'allow'>, number> = {
  nda: 0,
  confidential: 1,
  unreleased: 2,
  'personal-data': 3,
  sensitive: 4
};

type FilenamePhraseMatch = {
  category: Exclude<ConfidentialIntentResult, 'allow'>;
  length: number;
};

function matchFilenamePhrase(tokens: readonly string[], index: number): FilenamePhraseMatch | null {
  const token = tokens[index];
  const next = tokens[index + 1];
  const afterNext = tokens[index + 2];

  if (token === 'nda') return { category: 'nda', length: 1 };
  if (token === 'non' && next === 'disclosure' && afterNext === 'agreement') {
    return { category: 'nda', length: 3 };
  }
  if (token === 'confidential') return { category: 'confidential', length: 1 };
  if (
    token === 'proprietary' &&
    ((next === 'client' && ['material', 'materials', 'document', 'documents', 'data', 'information'].includes(afterNext)) ||
      ['material', 'materials', 'document', 'documents', 'data', 'information'].includes(next))
  ) {
    return { category: 'confidential', length: next === 'client' ? 3 : 2 };
  }
  if (token === 'secret' && next === 'between' && afterNext === 'us') {
    return { category: 'confidential', length: 3 };
  }
  if (
    token === 'embargoed' &&
    ['project', 'campaign', 'product', 'film', 'video', 'footage', 'media', 'asset', 'assets', 'creative', 'launch'].includes(
      next
    )
  ) {
    return { category: 'unreleased', length: 2 };
  }
  if (token === 'not' && next === 'announced' && afterNext === 'yet') {
    return { category: 'unreleased', length: 3 };
  }
  if (token === 'unreleased' || token === 'unannounced' || (token === 'pre' && next === 'release')) {
    return { category: 'unreleased', length: token === 'pre' ? 2 : 1 };
  }
  if (
    token === 'pii' ||
    (token === 'passport' && (next === 'number' || next === 'numbers' || next === 'details')) ||
    (token === 'identity' && (next === 'document' || next === 'documents')) ||
    (token === 'personal' && next === 'data') ||
    (token === 'personally' && (next === 'identifiable' || next === 'identifying') && afterNext === 'information') ||
    (token === 'identifying' && next === 'details') ||
    (token === 'contact' && (next === 'details' || next === 'information'))
  ) {
    return { category: 'personal-data', length: token === 'pii' ? 1 : token === 'personally' ? 3 : 2 };
  }
  if (token === 'sensitive') return { category: 'sensitive', length: 1 };
  return null;
}

function filenameMaskLength(tokens: readonly string[], index: number): number {
  const token = tokens[index];
  const next = tokens[index + 1];
  const afterNext = tokens[index + 2];
  const fourth = tokens[index + 3];

  if (token === 'not' && (next === 'confidential' || next === 'sensitive')) return 2;
  if (token === 'no' && next === 'personal' && afterNext === 'data') return 3;
  if (token === 'not' && next === 'under' && afterNext === 'nda') return 3;
  if (token === 'already' && next === 'released') return 2;
  if (token === 'guide' && next === 'to' && afterNext === 'confidential' && fourth === 'information') return 4;
  if (token === 'sensitive' && next === 'topic') return 2;

  const protectedPhrase = matchFilenamePhrase(tokens, index);
  if (!protectedPhrase) return 0;
  let markerIndex = index + protectedPhrase.length;
  if (['content', 'data', 'information'].includes(tokens[markerIndex])) markerIndex += 1;
  return tokens[markerIndex] === 'policy' || tokens[markerIndex] === 'template' ? markerIndex - index + 1 : 0;
}

function removeDefaultIgnorables(value: string): string {
  return value.replace(/\p{Default_Ignorable_Code_Point}/gu, '');
}

function normalizeProtectedTermLookalikes(value: string): string {
  return value.replace(/\p{L}+/gu, (token) => {
    const skeleton = token.replace(/\u043e/g, 'o').replace(/\u0441/g, 'c').replace(/\u0456/g, 'i');
    return skeleton === 'confidential' || skeleton === 'pii' ? skeleton : token;
  });
}

function normalizeForClassification(value: string): string {
  return normalizeProtectedTermLookalikes(removeDefaultIgnorables(value.normalize('NFKC')).toLowerCase())
    .replace(/[’‘`]/g, "'")
    .replace(/\bn\s*[.\-]?\s*d\s*[.\-]?\s*a\b/g, 'nda')
    .replace(/[‐‑‒–—−-]+/g, ' ')
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyConfidentialIntent(value: string): ConfidentialIntentResult {
  let normalized = normalizeForClassification(value);
  for (const pattern of NEGATED_PHRASES) {
    normalized = normalized.replace(pattern, ' ordinary ');
  }
  normalized = normalized.replace(/\s+/g, ' ').trim();

  for (const rule of CATEGORY_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.category;
    }
  }
  return 'allow';
}

export function classifyConfidentialFilename(filename: string): ConfidentialIntentResult {
  const canonical = removeDefaultIgnorables(filename.normalize('NFKC')).toLowerCase().trim();
  if (canonical.length > 512) return 'sensitive';

  const tokens = normalizeForClassification(canonical).split(' ').filter(Boolean);
  const masked = new Array<boolean>(tokens.length).fill(false);
  for (let index = 0; index < tokens.length; index += 1) {
    const maskLength = filenameMaskLength(tokens, index);
    for (let offset = 0; offset < maskLength; offset += 1) {
      masked[index + offset] = true;
    }
  }

  let result: ConfidentialIntentResult = 'allow';

  for (let index = 0; index < tokens.length; index += 1) {
    if (masked[index]) continue;
    const match = matchFilenamePhrase(tokens, index);
    if (!match) continue;
    let phraseIsMasked = false;
    for (let offset = 1; offset < match.length; offset += 1) {
      if (masked[index + offset]) phraseIsMasked = true;
    }
    if (phraseIsMasked) continue;

    const category = match.category;
    if (
      (result === 'allow' || FILENAME_CATEGORY_PRIORITY[category] < FILENAME_CATEGORY_PRIORITY[result])
    ) {
      result = category;
      if (result === 'nda') return result;
    }
  }
  return result;
}
