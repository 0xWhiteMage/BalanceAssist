import {
  chatResponsePayloadSchema,
  type ChatSharedWorkEntry
} from '@/lib/api/contracts';
import { fetchJsonWithTimeout } from '@/lib/api/fetch';
import { CHAT_CLIENT_TIMEOUT_MS } from '@/lib/conversation/chat-timeouts';

export type { ChatSharedWorkEntry } from '@/lib/api/contracts';

export type ChatSharedWork = {
  entries: ChatSharedWorkEntry[];
};

export type ChatReplyItem = {
  text: string;
};

export type ChatRequestPayload = {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  context?: {
    step?: string;
    isTeamConnected?: boolean;
    draft?: string;
    sessionId?: string;
    capturedFields?: string[];
    workSearchPending?: boolean;
    sharedWorkSlugs?: string[];
  };
};

type ChatResponseBase = {
  replies: ChatReplyItem[];
  draftUpdates: Record<string, string>;
  briefReady: boolean;
  sharedWork: ChatSharedWork | null;
};

type CanonicalChatResponse = ChatResponseBase & {
  outcome: 'draft_persisted' | 'draft_conflict';
  canonicalDraft: Record<string, string>;
  canonicalProvenance?: Record<string, 'user-stated' | 'inferred' | 'confirmed' | 'cleared'>;
  draftVersion: number;
  currentStage: 'project' | 'audience' | 'planning' | 'references-contact';
  stageRecaps: string[];
};

export type ChatResponse =
  | CanonicalChatResponse
  | (ChatResponseBase & { outcome: 'non_persistence' })
  | (ChatResponseBase & { outcome: 'confidential_diversion' })
  | (ChatResponseBase & { outcome: 'draft_save_failed' })
  | (ChatResponseBase & {
      outcome: 'provider_unavailable';
      error: 'Chat service unavailable';
      detail: 'chat_provider_unavailable';
    });

export function parseChatResponse(status: number, responseBody: unknown): ChatResponse | null {
  const parsed = chatResponsePayloadSchema.safeParse(responseBody);
  if (!parsed.success) return null;
  const data = parsed.data;
  const validStatus =
    (status === 200 && ['draft_persisted', 'non_persistence', 'confidential_diversion'].includes(data.outcome)) ||
    (status === 409 && data.outcome === 'draft_conflict') ||
    (status === 500 && data.outcome === 'draft_save_failed') ||
    (status === 503 && data.outcome === 'provider_unavailable');
  if (!validStatus) return null;

  if (data.outcome === 'provider_unavailable') {
    return {
      outcome: 'provider_unavailable',
      error: data.error,
      detail: data.detail,
      replies: [],
      draftUpdates: {},
      briefReady: false,
      sharedWork: null
    };
  }

  const textChunks = data.messages?.length ? data.messages : data.message ? [data.message] : [];
  const base = {
    replies: textChunks.map((text) => ({ text })),
    outcome: data.outcome,
    draftUpdates: 'draftUpdates' in data ? data.draftUpdates ?? {} : {},
    briefReady: data.outcome === 'draft_persisted' || data.outcome === 'draft_conflict' ? data.briefReady : false,
    sharedWork: 'sharedWork' in data ? data.sharedWork ?? null : null
  };
  if (data.outcome === 'draft_persisted' || data.outcome === 'draft_conflict') {
    return {
      ...base,
      outcome: data.outcome,
      canonicalDraft: data.canonicalDraft,
      canonicalProvenance: data.canonicalProvenance,
      draftVersion: data.draftVersion,
      currentStage: data.currentStage,
      stageRecaps: data.stageRecaps
    };
  }
  return { ...base, outcome: data.outcome };
}

export async function chatRequest(payload: ChatRequestPayload): Promise<ChatResponse | null> {
  const sanitizedPayload = {
    ...payload,
    messages: payload.messages.filter(
      (message): message is { role: 'user'; content: string } => message.role === 'user'
    )
  };
  const result = await fetchJsonWithTimeout('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sanitizedPayload),
    keepalive: true
  }, CHAT_CLIENT_TIMEOUT_MS);

  return result ? parseChatResponse(result.response.status, result.body) : null;
}
