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
  /\b(?:is|are|was|were) (?:not|no longer) (?:under|covered by|subject to|bound by|protected by) (?:an? )?(?:nda|non disclosure agreement)\b/g,
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
      /\b(?:under|covered by|subject to|bound by|protected by) (?:an? )?(?:nda|non disclosure agreement)\b/,
      /\b(?:nda|non disclosure agreement) protected (?:information|data|documents?|materials?|content|details|files?)\b/,
      /\b(?:share|send|upload|provide|process) (?:an? )?(?:nda|non disclosure agreement) (?:protected |restricted )?(?:information|data|documents?|materials?|content|details|files?)\b/
    ]
  },
  {
    category: 'confidential',
    patterns: [
      /\b(?:contains?|includes?|shar(?:e|ing)|send(?:ing)?|upload(?:ing)?|provid(?:e|ing)|process(?:ing)?) (?:strictly |highly )?confidential (?:client )?(?:information|data|documents?|materials?|content|details|brief|files?)\b/,
      /\b(?:this|that|it|these|those) (?:is|are) (?:strictly |highly )?confidential\b/,
      /\b(?:this|that|the|our|my|client|these|those) (?:attached )?(?:projects?|briefs?|files?|documents?|materials?|information|campaigns?|products?|content)(?: details)? (?:is|are|contains?|includes?) (?:strictly |highly )?confidential(?: (?:information|data|documents?|materials?|content|details|briefs?|files?))?\b/,
      /\b(?:confidential client|client confidential) (?:information|data|documents?|materials?|content|details|briefs?|files?)\b/
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
      /\b(?:contains?|includes?|shar(?:e|ing)|send(?:ing)?|upload(?:ing)?|provid(?:e|ing)|process(?:ing)?) (?:private )?(?:personal data|personally identifiable information|personally identifying information|identifying details|contact details|contact information)\b/,
      /\b(?:this|that|the|our|my|client) (?:attached )?(?:brief|file|document|material)? ?(?:contains?|includes?|has) (?:private )?(?:personal data|personally identifiable information|personally identifying information|identifying details|contact details|contact information)\b/
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

const FILENAME_CATEGORY_PATTERNS: ReadonlyArray<{
  category: Exclude<ConfidentialIntentResult, 'allow'>;
  pattern: RegExp;
}> = [
  {
    category: 'nda',
    pattern: /^(?:nda|non disclosure agreement)(?: (?:protected|restricted))?(?: (?:information|data|documents?|materials?|content|details|briefs?|files?))?$/
  },
  {
    category: 'confidential',
    pattern: /^confidential(?: (?:client )?(?:information|data|documents?|materials?|content|details|briefs?|files?))?$/
  },
  {
    category: 'unreleased',
    pattern: /^(?:unreleased|pre release|unannounced)(?: (?:client )?(?:project|campaign|product|film|video|footage|media|assets?|creative|launch))?$/
  },
  {
    category: 'personal-data',
    pattern: /^(?:personal data|personally identifiable information|personally identifying information|identifying details|contact details|contact information)$/
  },
  {
    category: 'sensitive',
    pattern: /^(?:highly )?sensitive(?: (?:client )?(?:information|data|documents?|materials?|content|details|briefs?|files?))?$/
  }
];

function removeDefaultIgnorables(value: string): string {
  return value.replace(/\p{Default_Ignorable_Code_Point}/gu, '');
}

function normalizeForClassification(value: string): string {
  return removeDefaultIgnorables(value.normalize('NFKC'))
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

export function classifyConfidentialFilename(filename: string): ConfidentialIntentResult {
  const canonical = removeDefaultIgnorables(filename.normalize('NFKC')).toLowerCase().trim();
  const extensionIndex = canonical.lastIndexOf('.');
  if (extensionIndex <= 0 || !/^[a-z0-9]{1,16}$/.test(canonical.slice(extensionIndex + 1))) {
    return 'allow';
  }

  const basename = canonical.slice(0, extensionIndex);
  if (/[\\/]/.test(basename)) return 'allow';
  const normalizedBasename = normalizeForClassification(basename);

  for (const rule of FILENAME_CATEGORY_PATTERNS) {
    if (rule.pattern.test(normalizedBasename)) return rule.category;
  }
  return 'allow';
}
