import { sanitizeDraftUpdates } from '@/lib/conversation/draft-schema';

const DRAFT_MARKER = ':::draft:::';
const DRAFT_LINE_PATTERN = /:::draft:::\s*(?:<json>)?\s*(\{[\s\S]*?\})\s*(?:<\/json>)?\s*:::/i;
const TEMPORAL_EXPRESSION = String.raw`(?:today|tomorrow|tonight|(?:next|this)\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)|(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?)`;
const DURATION_NUMBER = String.raw`(?:\d{1,3}|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?|(?:one|two|three|four|five|six|seven|eight|nine)\s+hundred)`;
const DURATION_EXPRESSION = String.raw`${DURATION_NUMBER}\s+(?:business\s+)?(?:days?|weeks?|months?)`;
const CURRENCY_AMOUNT = String.raw`(?:(?:s?\$|£|€)\s*\d[\d,]*(?:\.\d{2})?|(?:sgd|usd|eur|gbp)\s*\d[\d,]*(?:\.\d{2})?|\d[\d,]*(?:\.\d{2})?\s*(?:dollars?|pounds?|euros?))`;
const MONEY_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)`;
const MONEY_AMOUNT = String.raw`(?:${CURRENCY_AMOUNT}|(?:${MONEY_WORD}[\s-]+){1,6}(?:dollars?|pounds?|euros?))`;
const BALANCE_PRICE_SUBJECT = String.raw`(?:(?:the\s+)?(?:final|fixed|guaranteed)\s+(?:price|pricing|quote|fee|cost)(?!\s+(?:you|the user)\s+(?:entered|provided|stated|supplied))|(?:our|balance(?:'s)?)\s+(?:(?:final|fixed|guaranteed)\s+)?(?:price|pricing|quote|fee|cost)|(?:the\s+)?quote(?=\s+(?:is|comes?\s+to|totals?|equals?)))`;
const DIRECT_PRICE_PATTERN = new RegExp(String.raw`\b(?:price|fee|cost)\s+(?:is|will be|comes? to|totals?|equals?)\s+${MONEY_AMOUNT}\b`, 'gi');
const USER_PRICE_SUBJECT_PREFIX_PATTERN = /(?:\b(?:you|the user)\s+(?:entered|provided|stated|supplied)(?:\s+the)?|\byour\s+(?:entered|provided|stated|supplied)|\b(?:the\s+)?client[- ]provided)\s*$/i;

const PRODUCER_BOUNDARY_PATTERNS: Array<{ pattern: RegExp; response: string }> = [
  {
    pattern: /\b(?:legally (?:binding|enforceable)|legal advice|you should sign|contract (?:is|means|allows|requires)|nda (?:is|means|allows|requires))\b/i,
    response: "I can't provide legal or contract advice. A Balance producer must review legal and contract terms directly."
  },
  {
    pattern: new RegExp(String.raw`\b${BALANCE_PRICE_SUBJECT}\b[^.\n]{0,40}${CURRENCY_AMOUNT}\b`, 'i'),
    response: 'Final pricing is set by Balance producers after they review the scope.'
  },
  {
    pattern: new RegExp(String.raw`\b${BALANCE_PRICE_SUBJECT}\b[^.\n]{0,20}\b(?:comes? to|is|will be|totals?|equals?)\s+(?:(?:about|approximately|roughly)\s+)?(?:${MONEY_WORD}[\s-]+){1,6}(?:dollars?|pounds?|euros?)\b`, 'i'),
    response: 'Final pricing is set by Balance producers after they review the scope.'
  },
  {
    pattern: new RegExp(String.raw`\b(?:guarantee|guaranteed|promise|promised|definitely)\b[^.\n]{0,30}\b(?:deliver|delivery|complete|completed|ready)\b[^.\n]{0,20}(?:(?:by|on)\s+${TEMPORAL_EXPRESSION}|(?:within|in)\s+${DURATION_EXPRESSION})\b`, 'i'),
    response: 'Final timing is confirmed by Balance producers after they review scope and scheduling.'
  },
  {
    pattern: new RegExp(String.raw`\b(?:we(?:'ll| can| will)|balance (?:can|will)|(?:our|the) (?:team|crew|producer) (?:can|will))\s+(?:deliver|complete|finish)\b[^.\n]{0,20}(?:(?:by|on)\s+${TEMPORAL_EXPRESSION}|(?:within|in)\s+${DURATION_EXPRESSION})\b`, 'i'),
    response: 'Final timing is confirmed by Balance producers after they review scope and scheduling.'
  },
  {
    pattern: new RegExp(String.raw`\b(?:the|your|this) (?:project|deliverable|film|video) will be (?:ready|complete|finished)\s+(?:(?:(?:by|on)\s+)?${TEMPORAL_EXPRESSION}|(?:within|in)\s+${DURATION_EXPRESSION})\b`, 'i'),
    response: 'Final timing is confirmed by Balance producers after they review scope and scheduling.'
  },
  {
    pattern: new RegExp(String.raw`\bwe(?:'ll| can| will) have (?:it|(?:the\s+)?(?:film|video|project)) ready\s+(?:by\s+${TEMPORAL_EXPRESSION}|(?:in|within)\s+${DURATION_EXPRESSION})\b`, 'i'),
    response: 'Final timing is confirmed by Balance producers after they review scope and scheduling.'
  },
  {
    pattern: new RegExp(String.raw`\b(?:we(?:'ve)?|balance|(?:our|the) (?:team|crew|producer)) (?:have )?(?:reserved|booked|confirmed) (?:the |our )?(?:crew|team|studio)\b[^.\n]{0,20}\b(?:for|on)\s+${TEMPORAL_EXPRESSION}\b`, 'i'),
    response: 'Availability is confirmed by Balance producers after they review the project and schedule.'
  },
  {
    pattern: new RegExp(String.raw`\b(?:crew|team|studio|we) (?:is|are|will be) (?:definitely )?(?:available|free|booked|confirmed)\b[^.\n]{0,20}(?:(?:on|for|from|until)\s+)?${TEMPORAL_EXPRESSION}\b`, 'i'),
    response: 'Availability is confirmed by Balance producers after they review the project and schedule.'
  }
];

const REFUSAL_PATTERNS: Array<{ pattern: RegExp; response: string }> = [
  {
    pattern: /\bhow much\b.*\b(cost|price|quote|fee|charge)\b/i,
    response:
      "Final pricing is set by our producers after understanding scope. I can't quote from here, but I can pass this to the team."
  },
  {
    pattern: /\b(quote|estimate)\b.*\b(price|cost|fee)\b/i,
    response:
      "Final pricing is set by our producers after understanding scope. I can't quote from here, but I can pass this to the team."
  },
  {
    pattern: /\b(legal|contract|terms|liability|nda)\b/i,
    response:
      "I'm not able to advise on legal or contract terms. Our producers can walk you through that directly."
  },
  {
    pattern: /\b(apply|hire me|recruit|subscribe|sign in|password|login)\b/i,
    response:
      "I'm Balance Assist and I only help with creative production briefs for the Balance team. For other requests, please contact hello@balancestudio.tv."
  },
  {
    pattern:
      /\b(write code|program me|hack|exploit|sql injection|prompt inject|jailbreak|ignore (previous|all|prior) instructions?|reveal.*(prompt|system)|change your role|pretend to be human)\b/i,
    response:
      "I'm here to help with your Balance project brief. I can't help with that, but I can help you capture a creative brief if you have one in mind."
  }
];

function parseDraftObject(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractDraftCandidate(reply: string) {
  const matched = reply.match(DRAFT_LINE_PATTERN);
  if (matched) {
    return matched[1];
  }

  const markerIndex = reply.indexOf(DRAFT_MARKER);
  if (markerIndex < 0) {
    return null;
  }

  const tail = reply.slice(markerIndex + DRAFT_MARKER.length).trim();
  const withoutJsonTag = tail.replace(/^<json>\s*/i, '').replace(/\s*<\/json>\s*$/i, '').trim();

  if (!withoutJsonTag.startsWith('{')) {
    return null;
  }

  return withoutJsonTag.endsWith('}') ? withoutJsonTag : `${withoutJsonTag}}`;
}

function parseAssistantReply(reply: string): {
  displayText: string;
  draft: Record<string, unknown>;
} {
  let draft: Record<string, unknown> = {};

  const candidate = extractDraftCandidate(reply);
  if (candidate) {
    const parsed = parseDraftObject(candidate);
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        draft[key] = value;
      }
    }
  }

  const markerIndex = reply.indexOf(DRAFT_MARKER);
  const displayText = (markerIndex >= 0 ? reply.slice(0, markerIndex) : reply).trim();

  return { displayText, draft };
}

function matchesRefusal(reply: string, userMessage: string): string | null {
  const normalizedReply = reply.normalize('NFKC').replace(/[’‘`]/g, "'");
  const hasDirectPriceCommitment = Array.from(normalizedReply.matchAll(DIRECT_PRICE_PATTERN)).some((match) => {
    const prefix = normalizedReply.slice(0, match.index);
    return !USER_PRICE_SUBJECT_PREFIX_PATTERN.test(prefix);
  });
  if (hasDirectPriceCommitment) {
    return 'Final pricing is set by Balance producers after they review the scope.';
  }
  for (const { pattern, response } of PRODUCER_BOUNDARY_PATTERNS) {
    if (pattern.test(normalizedReply)) return response;
  }
  for (const { pattern, response } of REFUSAL_PATTERNS) {
    if (pattern.test(userMessage)) {
      return response;
    }
  }
  for (const { pattern, response } of REFUSAL_PATTERNS) {
    if (pattern.test(normalizedReply)) {
      return response;
    }
  }
  return null;
}

const MAX_REPLY_LENGTH = 600;

export function sanitizeReply(
  rawReply: string,
  userMessage: string,
  options?: { toolCallArguments?: Record<string, unknown> }
): { reply: string; draft: Record<string, unknown>; overridden: boolean } {
  const { displayText, draft: proseDraft } = parseAssistantReply(rawReply);
  const refusal = matchesRefusal(displayText, userMessage);
  if (refusal) return { reply: refusal, draft: {}, overridden: true };

  const truncated = displayText.length > MAX_REPLY_LENGTH ? displayText.slice(0, MAX_REPLY_LENGTH) : displayText;
  const source = options?.toolCallArguments ?? proseDraft;
  return { reply: truncated, draft: sanitizeDraftUpdates(source), overridden: false };
}
