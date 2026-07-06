import { sanitizeDraftUpdates } from '@/lib/conversation/draft-schema';

const DRAFT_MARKER = ':::draft:::';
const DRAFT_LINE_PATTERN = /:::draft:::\s*(?:<json>)?\s*(\{[\s\S]*?\})\s*(?:<\/json>)?\s*:::/i;

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
  const { displayText } = parseAssistantReply(rawReply);
  const refusal = matchesRefusal(displayText, userMessage);
  if (refusal) return { reply: refusal, draft: {}, overridden: true };

  const truncated = displayText.length > MAX_REPLY_LENGTH ? displayText.slice(0, MAX_REPLY_LENGTH) : displayText;
  const source = options?.toolCallArguments ?? parseAssistantReply(rawReply).draft;
  return { reply: truncated, draft: sanitizeDraftUpdates(source), overridden: false };
}
