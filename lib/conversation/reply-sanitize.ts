import { sanitizeDraftUpdates } from '@/lib/conversation/draft-schema';

const DRAFT_MARKER = ':::draft:::';
const DRAFT_LINE_PATTERN = /:::draft:::\s*(?:<json>)?\s*(\{[\s\S]*?\})\s*(?:<\/json>)?\s*:::/i;

const PRODUCER_BOUNDARY_PATTERNS: Array<{ pattern: RegExp; response: string }> = [
  {
    pattern: /\b(?:legally (?:binding|enforceable)|legal advice|you should sign|contract (?:is|means|allows|requires)|nda (?:is|means|allows|requires))\b/i,
    response: "I can't provide legal or contract advice. A Balance producer must review legal and contract terms directly."
  },
  {
    pattern: /\b(?:final |fixed |guaranteed )?(?:price|pricing|quote|fee|cost)\b[^.\n]*(?:\$|sgd|usd|eur|gbp|\d[\d,]*(?:\.\d{2})?)/i,
    response: 'Final pricing is set by Balance producers after they review the scope.'
  },
  {
    pattern: /\b(?:price|pricing|quote|fee|cost)\b[^.\n]{0,40}\b(?:comes? to|is|will be|totals?|equals?)\b[^.\n]{0,40}\b(?:dollars?|pounds?|euros?|sgd|usd|eur|gbp)\b/i,
    response: 'Final pricing is set by Balance producers after they review the scope.'
  },
  {
    pattern: /\b(?:guarantee|guaranteed|promise|promised|definitely)\b[^.\n]*(?:deliver|delivery|complete|completed|ready|timeline|date|by\b)/i,
    response: 'Final timing is confirmed by Balance producers after they review scope and scheduling.'
  },
  {
    pattern: /\b(?:we|balance|our (?:team|crew|studio)) (?:can|will) (?:deliver|complete|finish|have [^.\n]{0,20} ready)\b[^.\n]{0,20}\bby\b[^.\n]{1,30}/i,
    response: 'Final timing is confirmed by Balance producers after they review scope and scheduling.'
  },
  {
    pattern: /\b(?:reserved|booked|confirmed) (?:the )?(?:crew|team|studio)\b[^.\n]{0,30}\b(?:for|on)\b/i,
    response: 'Availability is confirmed by Balance producers after they review the project and schedule.'
  },
  {
    pattern: /\b(?:crew|team|studio|we) (?:is|are|will be) (?:definitely )?(?:available|free|booked|confirmed)\b[^.\n]{0,30}\b(?:next|this|on|for|from|until|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d)/i,
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
  for (const { pattern, response } of PRODUCER_BOUNDARY_PATTERNS) {
    if (pattern.test(reply)) return response;
  }
  for (const { pattern, response } of REFUSAL_PATTERNS) {
    if (pattern.test(userMessage)) {
      return response;
    }
  }
  for (const { pattern, response } of REFUSAL_PATTERNS) {
    if (pattern.test(reply)) {
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
