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
      /\b(?:under|covered by|subject to|bound by|protected by) (?:an? )?(?:nda|non disclosure agreement)\b/,
      /\b(?:nda|non disclosure agreement) protected (?:information|data|documents?|materials?|content|details|files?)\b/,
      /\b(?:share|send|upload|provide|process) (?:an? )?(?:nda|non disclosure agreement) (?:protected |restricted )?(?:information|data|documents?|materials?|content|details|files?)\b/
    ]
  },
  {
    category: 'confidential',
    patterns: [
      /\b(?:contains?|includes?|uploading|sharing|sending|providing|process(?:ing)?) (?:strictly |highly )?confidential (?:client )?(?:information|data|documents?|materials?|content|details|brief|files?)\b/,
      /\b(?:this|that|it|these|those) (?:is|are) (?:strictly |highly )?confidential\b/,
      /\b(?:the|our|my|client) (?:attached )?(?:project|brief|file|document|material|information|campaign|product)(?: details)? (?:is|are|contains?|includes?) (?:strictly |highly )?confidential(?: (?:information|data|documents?|materials?|content|details|brief|files?))?\b/,
      /\b(?:confidential client|client confidential) (?:information|data|documents?|materials?|content|details|brief|files?)\b/
    ]
  },
  {
    category: 'unreleased',
    patterns: [
      /\b(?:this|that|the|our|my|client|an?) (?:project|campaign|product|film|video|footage|media|asset|assets|creative|launch) (?:is|are) (?:unreleased|pre release|unannounced)\b/,
      /\b(?:this|that|it) (?:is|are) (?:an? )?(?:unreleased|pre release|unannounced) (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/,
      /\b(?:share|send|upload|provide|process|contains?|includes?) (?:an? |the |our |my |client )?(?:unreleased|pre release|unannounced) (?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/,
      /\b(?:unreleased|pre release|unannounced) (?:client )?(?:project|campaign|product|film|video|footage|media|assets?|creative|launch)\b/
    ]
  },
  {
    category: 'personal-data',
    patterns: [
      /\b(?:contains?|includes?|share|send|upload|provide|process(?:ing)?) (?:private )?(?:personal data|personally identifying information|identifying details|contact details|contact information)\b/,
      /\b(?:this|that|the|our|my|client) (?:attached )?(?:brief|file|document|material)? ?(?:contains?|includes?|has) (?:private )?(?:personal data|personally identifying information|identifying details|contact details|contact information)\b/
    ]
  },
  {
    category: 'sensitive',
    patterns: [
      /\b(?:contains?|includes?|share|send|upload(?:ing)?|provide|process(?:ing)?) (?:highly )?sensitive (?:client )?(?:information|data|documents?|materials?|content|details|files?)\b/,
      /\b(?:this|that|it|these|those) (?:is|are) (?:highly )?sensitive\b/,
      /\b(?:the|our|my|client) (?:attached )?(?:brief|file|document|material|information|data)(?: details)? (?:is|are|contains?|includes?) (?:highly )?sensitive(?: (?:information|data|documents?|materials?|content|details|files?))?\b/
    ]
  }
];

function normalizeForClassification(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
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
