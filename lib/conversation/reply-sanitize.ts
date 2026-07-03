import { sanitizeDraftUpdates } from '@/lib/conversation/draft-schema';

const DRAFT_LINE_PATTERN = /:::draft:::\s*(\{[\s\S]*?\})\s*:::/i;

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

function parseAssistantReply(reply: string): {
  displayText: string;
  draft: Record<string, unknown>;
} {
  const match = reply.match(DRAFT_LINE_PATTERN);
  let draft: Record<string, unknown> = {};

  if (match) {
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          draft[key] = value;
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  const displayText = reply.replace(DRAFT_LINE_PATTERN, '').trim();

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
  userMessage: string
): { reply: string; draft: Record<string, unknown>; overridden: boolean } {
  const { displayText, draft } = parseAssistantReply(rawReply);
  const refusal = matchesRefusal(displayText, userMessage);
  if (refusal) {
    return { reply: refusal, draft: {}, overridden: true };
  }

  const truncated = displayText.length > MAX_REPLY_LENGTH
    ? displayText.slice(0, MAX_REPLY_LENGTH)
    : displayText;

  return { reply: truncated, draft: sanitizeDraftUpdates(draft), overridden: false };
}
