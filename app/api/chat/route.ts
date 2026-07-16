import { corsOptionsResponse, jsonWithCors, readJsonBodyLimited } from '@/lib/api/route-helpers';
import { getEnv } from '@/lib/env';
import { buildSystemPrompt } from '@/lib/conversation/system-prompt';
import { sanitizeDraftUpdates } from '@/lib/conversation/draft-schema';
import { getLocalResponse, getFallbackResponse } from '@/lib/conversation/local-responses';
import { getBalanceFaqResponse } from '@/lib/conversation/balance-faq';
import { conversationSteps } from '@/lib/conversation/flow';
import { sanitizeReply } from '@/lib/conversation/reply-sanitize';
import { isBriefReadyForApproval, missingReviewFields, REVIEW_PROMPT } from '@/lib/conversation/review-state';
import {
  guardAgainstFabricatedBriefFields,
  recordBriefUpdatesJsonSchema,
  recordBriefUpdatesSchema,
  sanitizeShareWork,
  shareWorkJsonSchema
} from '@/lib/conversation/tool-schema';
import { listAllWorks, searchWorks, type WorkEntry } from '@/lib/conversation/works-search';
import type { ConversationStepId } from '@/lib/conversation/types';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { LeadDraft } from '@/lib/onboarding/types';
import { clearField, getVisibleDraftValues, normalizeVersionedDraft, updateField, type VersionedDraft } from '@/lib/conversation/draft-versioning';
import { requireSession } from '@/lib/api/require-session';
import { createLogger, extractRequestId } from '@/lib/logger';
import { emitEvent } from '@/lib/observability/events';
import { chatRequestPayloadSchema, MAX_CHAT_BODY_BYTES } from '@/lib/api/contracts';
import { temporaryDraftExpiry } from '@/lib/privacy/session-retention';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { getCareersRedirect, isCareersIntent } from '@/lib/conversation/careers-redirect';
import {
  classifyConfidentialIntent,
  CONFIDENTIAL_INTAKE_RESPONSE
} from '@/lib/privacy/confidential-intent';

export async function OPTIONS() {
  return corsOptionsResponse();
}

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string };
const PROVIDER_TIMEOUT_MS = 15000;
const TOOL_NAME = 'record_brief_updates';
const SHARE_WORK_TOOL_NAME = 'share_work';

function confidentialDiversionResponse(request: Request) {
  return jsonWithCors({
    message: CONFIDENTIAL_INTAKE_RESPONSE,
    draftUpdates: {},
    briefReady: false,
    reviewPrompt: null,
    missingFields: [],
    truncated: false
  }, undefined, request);
}

type SharedWorkEntry = {
  title: string;
  url: string;
  description: string;
  image_url: string;
  category: 'reference' | 'mood' | 'pitch';
  slug: string;
};

type SharedWork = {
  entries: SharedWorkEntry[];
};

function buildSharedWorkFromEntries(
  slugs: string[],
  category: 'reference' | 'mood' | 'pitch'
): SharedWork {
  const all = listAllWorks();
  const bySlug = new Map<string, WorkEntry>();
  for (const w of all) bySlug.set(w.slug, w);
  const entries: SharedWorkEntry[] = [];
  for (const slug of slugs) {
    const w = bySlug.get(slug);
    if (!w) continue;
    entries.push({
      title: w.title,
      url: w.url,
      description: w.description,
      image_url: w.image_url,
      category,
      slug: w.slug
    });
  }
  return { entries };
}

async function fetchProvider(input: string, init: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function readMinimaxContent(data: unknown): string | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const payload = data as {
    reply?: unknown;
    choices?: Array<{
      message?: { content?: unknown };
      messages?: Array<{ content?: unknown }>;
      text?: unknown;
    }>;
  };

  if (typeof payload.reply === 'string' && payload.reply.trim().length > 0) {
    return payload.reply;
  }

  const firstChoice = payload.choices?.[0];

  if (typeof firstChoice?.message?.content === 'string' && firstChoice.message.content.trim().length > 0) {
    return firstChoice.message.content;
  }

  if (typeof firstChoice?.messages?.[0]?.content === 'string' && firstChoice.messages[0].content.trim().length > 0) {
    return firstChoice.messages[0].content;
  }

  if (typeof firstChoice?.text === 'string' && firstChoice.text.trim().length > 0) {
    return firstChoice.text;
  }

  return null;
}

type ProviderResult = {
  content: string;
  toolArguments: Record<string, unknown> | null;
  sharedWork: SharedWork | null;
  truncated: boolean;
};

async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: OpenAIMessage[],
  options?: {
    useTools?: boolean;
    sessionId?: string;
    priorDraft?: Partial<LeadDraft>;
    userMessage?: string;
    requestId?: string;
  }
): Promise<ProviderResult> {
  const logger = createLogger('chat', options?.requestId);
  const useTools = options?.useTools ?? false;
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: useTools ? 3200 : 512,
    temperature: useTools ? 0.4 : 0.6
  };
  if (useTools) {
    body.tools = [
      {
        type: 'function',
        function: {
          name: TOOL_NAME,
          parameters: recordBriefUpdatesJsonSchema
        }
      },
      {
        type: 'function',
        function: {
          name: SHARE_WORK_TOOL_NAME,
          parameters: shareWorkJsonSchema
        }
      }
    ];
    body.tool_choice = 'auto';
  }

  const response = await fetchProvider(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`LLM API returned ${response.status}`);
  }

  const data = await response.json();
  const choice = data?.choices?.[0];
  const message = choice?.message;
  const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
  const rawContent = typeof message?.content === 'string' ? message.content : null;
  const finishReason = choice?.finish_reason;
  const truncated = finishReason === 'length' && !hasToolCalls && (rawContent?.trim().length ?? 0) > 0;

  if (finishReason === 'length' && !hasToolCalls) {
    logger.warn('response truncated: finish_reason=length');
  }

  if (useTools && hasToolCalls) {
    let toolArguments: Record<string, unknown> | null = null;
    let sharedWork: SharedWork | null = null;

    for (const call of message.tool_calls) {
      if (!call || typeof call !== 'object') continue;
      const functionName = call.function?.name;
      if (typeof call.function?.arguments !== 'string') continue;
      if (functionName === TOOL_NAME) {
        try {
          const parsed = JSON.parse(call.function.arguments);
          const result = recordBriefUpdatesSchema.safeParse(parsed);
          if (result.success) {
            const guarded = guardAgainstFabricatedBriefFields(
              result.data as Record<string, unknown>,
              {
                ...createDefaultLeadDraft(),
                ...(options?.priorDraft as Partial<LeadDraft> | undefined)
              },
              options?.userMessage ?? ''
            );
            toolArguments = guarded;
          } else {
            logger.warn('record_brief_updates tool arguments failed schema validation', {
              sessionId: options?.sessionId,
              issues: result.error.issues
            });
          }
        } catch (error) {
          logger.warn('record_brief_updates tool arguments failed to parse as JSON', {
            sessionId: options?.sessionId,
            message: 'tool_arguments_invalid'
          });
        }
      } else if (functionName === SHARE_WORK_TOOL_NAME) {
        try {
          const parsed = JSON.parse(call.function.arguments);
          const cleaned = sanitizeShareWork(parsed);
          if (cleaned.slugs.length > 0) {
            sharedWork = buildSharedWorkFromEntries(cleaned.slugs, cleaned.category);
          }
        } catch (error) {
          logger.warn('share_work tool arguments failed to parse as JSON', {
            sessionId: options?.sessionId,
            message: 'tool_arguments_invalid'
          });
        }
      }
    }

    if (toolArguments !== null || sharedWork !== null) {
      return { content: rawContent ?? '', toolArguments, sharedWork, truncated };
    }
  }

  return { content: rawContent ?? getFallbackResponse(), toolArguments: null, sharedWork: null, truncated };
}

async function callMinimax(apiKey: string, messages: OpenAIMessage[]): Promise<string> {
  const systemContent = messages.find((m) => m.role === 'system')?.content ?? '';
  const userMessages = messages.filter((m) => m.role !== 'system');

  const response = await fetchProvider('https://api.minimax.chat/v1/text/chatcompletion_v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'MiniMax-Text-01',
      messages: [
        { role: 'system', content: systemContent },
        ...userMessages
      ],
      max_tokens: 512,
      temperature: 0.6
    })
  });

  if (!response.ok) {
    throw new Error(`Minimax API returned ${response.status}`);
  }

  const data = await response.json();

  if (data?.base_resp?.status_code && data.base_resp.status_code !== 0) {
    throw new Error(`Minimax API error ${data.base_resp.status_code}: ${data.base_resp.status_msg ?? 'unknown error'}`);
  }

  const content = readMinimaxContent(data);

  if (!content) {
    throw new Error('Minimax response did not contain assistant content');
  }

  return content;
}

async function logLlmEvent(
  sessionId: string | undefined,
  category: 'reply' | 'refusal' | 'local_fallback',
  hasDraft: boolean,
  requestId?: string
) {
  if (!sessionId) return;
  emitEvent('llm_request', { sessionId, category, hasDraft }, requestId);
}

type ChatContext = {
  step?: string;
  isTeamConnected?: boolean;
  draft?: string;
  sessionId?: string;
  capturedFields?: string[];
} | undefined;

const CAPTURED_FIELD_KEYS = [
  'projectScope',
  'projectType',
  'service',
  'timelineBand',
  'budgetBand',
  'contactName',
  'contactCompany',
  'contactEmail'
] as const;

function computeCapturedFieldsFromDraft(draft: Record<string, string>): string[] {
  const captured: string[] = [];
  for (const key of CAPTURED_FIELD_KEYS) {
    const value = draft[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      captured.push(key);
    }
  }
  return captured;
}

function toLeadDraftState(draft: Record<string, string>): Partial<LeadDraft> {
  const leadDraft: Partial<LeadDraft> = {};
  const target = leadDraft as Record<string, unknown>;

  for (const [key, value] of Object.entries(draft)) {
    target[key] = value;
  }

  return leadDraft;
}

async function loadAuthenticatedDraftState(session: Awaited<ReturnType<typeof requireSession>>) {
  const emptyDraft = {} as VersionedDraft;
  const emptyPromptDraft: Record<string, string> = {};
  const emptyPriorDraft: Partial<LeadDraft> = {};

  if (!session.ok) {
    return {
      authenticated: false,
      sessionId: undefined,
      supabase: null,
      versionedDraft: emptyDraft,
      draftVersion: 0,
      promptDraft: emptyPromptDraft,
      priorDraft: emptyPriorDraft,
      response: session.response
    };
  }

  const sessionId = session.auth.sessionId;

  const { data, error } = await session.supabase
    .from('sessions')
    .select('draft, draft_version')
    .eq('id', sessionId)
    .maybeSingle();

  if (error) {
    return {
      authenticated: false,
      sessionId,
      supabase: null,
      versionedDraft: emptyDraft,
      draftVersion: 0,
      promptDraft: emptyPromptDraft,
      priorDraft: emptyPriorDraft,
      response: jsonWithCors({ error: 'chat_session_load_failed' }, { status: 500 })
    };
  }

  if (!data) {
    return {
      authenticated: false,
      sessionId,
      supabase: null,
      versionedDraft: emptyDraft,
      draftVersion: 0,
      promptDraft: emptyPromptDraft,
      priorDraft: emptyPriorDraft,
      response: jsonWithCors({ error: 'Session not found' }, { status: 404 })
    };
  }

  const row = data as { draft?: unknown; draft_version?: number | null };
  const versionedDraft = normalizeVersionedDraft(row.draft);
  const promptDraft = getVisibleDraftValues(versionedDraft);

  return {
    authenticated: true,
    sessionId,
    supabase: session.supabase,
    versionedDraft,
    draftVersion: typeof row.draft_version === 'number' ? row.draft_version : 0,
    promptDraft,
    priorDraft: toLeadDraftState(promptDraft),
    response: null as Response | null
  };
}

async function persistAuthenticatedDraftState(
  state: Awaited<ReturnType<typeof loadAuthenticatedDraftState>>,
  draftUpdates: Record<string, string | boolean>
) {
  if (!state.authenticated || !state.supabase || !state.sessionId) {
    return;
  }

  let nextDraft = { ...state.versionedDraft };
  let changed = false;

  for (const [field, value] of Object.entries(draftUpdates)) {
    const existing = state.versionedDraft[field];

    if (typeof value === 'boolean') {
      if (existing?.provenance !== 'cleared' && existing?.value === String(value)) {
        continue;
      }
      nextDraft = updateField(nextDraft, field, String(value), 'user-stated');
      changed = true;
      continue;
    }

    if (value.length === 0) {
      if (!existing || existing.provenance === 'cleared' || existing.value.length === 0) {
        continue;
      }
      nextDraft = clearField(nextDraft, field);
      changed = true;
      continue;
    }

    if (existing?.provenance !== 'cleared' && existing?.value === value) {
      continue;
    }

    nextDraft = updateField(nextDraft, field, value, 'user-stated');
    changed = true;
  }

  if (changed) {
    const fields = Object.entries(nextDraft)
      .filter(([field, entry]) => state.versionedDraft[field]?.value !== entry.value || state.versionedDraft[field]?.provenance !== entry.provenance)
      .map(([field, entry]) => ({ field, value: entry.value, provenance: entry.provenance }));
    await state.supabase.rpc('update_session_draft', {
      p_session_id: state.sessionId,
      p_expected_draft_version: state.draftVersion,
      p_fields: fields
    });
  } else {
    await state.supabase
      .from('sessions')
      .update({ last_activity_at: new Date().toISOString(), draft_expires_at: temporaryDraftExpiry().toISOString() })
      .eq('id', state.sessionId);
  }
}

function buildLlmContext(context: ChatContext, promptDraft: Record<string, string>, priorDraft: Partial<LeadDraft>) {
  const briefReady = isBriefReadyForApproval(priorDraft);
  const capturedFields = computeCapturedFieldsFromDraft(promptDraft);
  const systemPrompt = buildSystemPrompt({
    isTeamConnected: context?.isTeamConnected,
    step: context?.step,
    draft: Object.keys(promptDraft).length > 0 ? JSON.stringify(promptDraft) : undefined,
    briefReady,
    capturedFields
  });
  return { priorDraft, briefReady, capturedFields, systemPrompt };
}

export async function POST(request: Request) {
  const requestId = extractRequestId(request);
  const session = await requireSession(request);
  if (!session.ok) return session.response;

  const body = await readJsonBodyLimited(request, MAX_CHAT_BODY_BYTES);
  if (!body.ok && body.tooLarge) {
    return jsonWithCors({ error: 'Payload too large', code: 'payload_too_large' }, { status: 413 }, request);
  }
  if (!body.ok) {
    return jsonWithCors({ error: 'Invalid JSON body' }, { status: 400 }, request);
  }
  const parsed = chatRequestPayloadSchema.safeParse(body.data);

  if (!parsed.success) {
    const tooLarge = parsed.error.issues.some((issue) => issue.code === 'too_big');
    return jsonWithCors(
      { error: tooLarge ? 'Payload too large' : 'Invalid request payload', ...(tooLarge ? { code: 'payload_too_large' } : { issues: parsed.error.issues }) },
      { status: tooLarge ? 413 : 400 },
      request
    );
  }

  const { messages, context } = parsed.data;
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
  const sessionId = session.auth.sessionId;

  if (context?.sessionId && context.sessionId !== sessionId) {
    return jsonWithCors({ error: 'Session mismatch' }, { status: 403 }, request);
  }

  try {
    if (classifyConfidentialIntent(lastUserMessage) !== 'allow') {
      return confidentialDiversionResponse(request);
    }
  } catch {
    return confidentialDiversionResponse(request);
  }

  const faqResponse = !context?.isTeamConnected ? getBalanceFaqResponse(lastUserMessage) : null;

  if (messages.some((message) => isCareersIntent(message.content))) {
    return jsonWithCors({ message: `Please apply through ${getCareersRedirect()}.`, draftUpdates: {}, briefReady: false, reviewPrompt: null, missingFields: [], truncated: false }, undefined, request);
  }

  try {
    const limit = await consumeRateLimit(`chat:${session.auth.capability}`, 20, 60 * 60);
    if (!limit.permitted) {
      return jsonWithCors({ error: 'Rate limit reached', code: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }, request);
    }
  } catch {
    return jsonWithCors({ error: 'Service unavailable', code: 'rate_limit_unavailable' }, { status: 503 }, request);
  }

  const env = getEnv();

  if (faqResponse) {
    const sharedWork = faqResponse.sharedWorkQuery
      ? buildSharedWorkFromEntries(
          searchWorks(faqResponse.sharedWorkQuery, 5).map((entry) => entry.slug),
          'reference'
        )
      : undefined;

    return jsonWithCors({
      messages: faqResponse.messages,
      draftUpdates: {},
      briefReady: false,
      reviewPrompt: null,
      missingFields: [],
      sharedWork: sharedWork && sharedWork.entries.length > 0 ? sharedWork : undefined,
      truncated: false
    });
  }

  const draftState = await loadAuthenticatedDraftState(session);
  if (draftState.response) {
    return draftState.response;
  }

  const llmContext = buildLlmContext(context, draftState.promptDraft, draftState.priorDraft);

  let visibleContent: string;
  let toolArguments: Record<string, unknown> | null = null;
  let sharedWork: SharedWork | null = null;
  let truncated = false;
  let category: 'reply' | 'refusal' | 'local_fallback' = 'reply';

  try {
    if (env.DEEPSEEK_API_KEY) {
      const llmMessages = [{ role: 'system' as const, content: llmContext.systemPrompt }, ...messages];
      const model = env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
      const providerResult = await callOpenAICompatible(
        'https://api.deepseek.com/v1/chat/completions',
        env.DEEPSEEK_API_KEY,
        model,
        llmMessages,
        { useTools: true, sessionId, priorDraft: llmContext.priorDraft, userMessage: lastUserMessage, requestId }
      );
      visibleContent = providerResult.content;
      toolArguments = providerResult.toolArguments;
      sharedWork = providerResult.sharedWork;
      truncated = providerResult.truncated;
    } else if (env.MINIMAX_API_KEY) {
      const llmMessages = [{ role: 'system' as const, content: llmContext.systemPrompt }, ...messages];
      visibleContent = await callMinimax(env.MINIMAX_API_KEY, llmMessages);
    } else if (env.OPENAI_API_KEY) {
      const llmMessages = [{ role: 'system' as const, content: llmContext.systemPrompt }, ...messages];
      const endpoint = env.OPENAI_API_ENDPOINT ?? 'https://api.openai.com/v1/chat/completions';
      const model = env.OPENAI_MODEL ?? 'gpt-4o-mini';
      const providerResult = await callOpenAICompatible(
        endpoint,
        env.OPENAI_API_KEY,
        model,
        llmMessages,
        { useTools: true, sessionId, priorDraft: llmContext.priorDraft, userMessage: lastUserMessage, requestId }
      );
      visibleContent = providerResult.content;
      toolArguments = providerResult.toolArguments;
      sharedWork = providerResult.sharedWork;
      truncated = providerResult.truncated;
    } else {
      category = 'local_fallback';
      const localResponse = getLocalResponse(lastUserMessage, {
        draft: llmContext.priorDraft as never,
        step: (context?.step as ConversationStepId) ?? 'free-chat',
        isTeamConnected: context?.isTeamConnected ?? false
      });

      if (localResponse) {
        visibleContent = localResponse;
      } else if (context?.step && conversationSteps[context.step as ConversationStepId]?.quickReplies) {
        visibleContent = "I didn't quite catch that — could you pick one of the options above, or tell me about your project?";
      } else {
        visibleContent = getFallbackResponse();
      }

      await new Promise((r) => setTimeout(r, 400));
    }

    const sanitized = sanitizeReply(visibleContent, lastUserMessage, { toolCallArguments: toolArguments ?? undefined });
    let replyText = sanitized.reply;
    if (sanitized.overridden) {
      category = 'refusal';
    }

    if (truncated && replyText.trim().length > 0) {
      replyText = `(continuing…)\n\n${replyText}`;
    }

    const draftUpdates = sanitizeDraftUpdates(sanitized.draft);
    const mergedDraft = { ...llmContext.priorDraft, ...draftUpdates };
    const briefReady = isBriefReadyForApproval(mergedDraft);
    const missingFields = missingReviewFields(mergedDraft);

    await persistAuthenticatedDraftState(draftState, draftUpdates);

    void logLlmEvent(sessionId, category, Object.keys(draftUpdates).length > 0, requestId);

    const replyChunks = splitReplyIntoMessages(replyText);
    if (replyChunks.length > 1) {
      return jsonWithCors({
        messages: replyChunks,
        draftUpdates,
        briefReady,
        reviewPrompt: briefReady ? REVIEW_PROMPT : null,
        missingFields,
        sharedWork: sharedWork ?? undefined,
        truncated
      });
    }

    return jsonWithCors({
      message: replyText,
      draftUpdates,
      briefReady,
      reviewPrompt: briefReady ? REVIEW_PROMPT : null,
      missingFields,
      sharedWork: sharedWork ?? undefined,
      truncated
    });
  } catch (error) {
    const message = 'chat_provider_failed';
    return jsonWithCors({ error: 'Chat service error', detail: message }, { status: 500 });
  }
}

function splitReplyIntoMessages(text: string): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [text];

  const capAt4 = (parts: string[]): string[] => {
    if (parts.length <= 4) return parts;
    const tail = parts.slice(3).join('\n\n').trim();
    return [...parts.slice(0, 3), tail].filter((p) => p.length > 0);
  };

  const hasRuleSeparator = /(^|\n)\s*---\s*(\n|$)/.test(cleaned);
  if (hasRuleSeparator) {
    const parts = cleaned
      .split(/\s*---\s*/g)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length > 1) {
      return capAt4(parts.map((part) => splitLongChunk(part)).flat()).flat();
    }
  }

  const doubleNewlineParts = cleaned
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (doubleNewlineParts.length > 4) {
    const head = doubleNewlineParts.slice(0, 3);
    const tail = doubleNewlineParts.slice(3).join('\n\n').trim();
    const capped = [...head, tail].filter((p) => p.length > 0);
    return capped.map((part) => splitLongChunk(part)).flat();
  }

  if (doubleNewlineParts.length > 1) {
    return doubleNewlineParts.map((part) => splitLongChunk(part)).flat();
  }

  return [cleaned];
}

function splitLongChunk(chunk: string): string[] {
  const MAX_CHUNK = 600;
  if (chunk.length <= MAX_CHUNK) return [chunk];

  const sentenceBoundary = /([.!?])\s+/g;
  const pieces: string[] = [];
  let buffer = '';
  let lastBoundary = -1;
  let cursor = 0;

  for (const match of chunk.matchAll(sentenceBoundary)) {
    const boundaryIndex = match.index ?? 0;
    const sentenceEnd = boundaryIndex + match[0].length;
    if (sentenceEnd > MAX_CHUNK && buffer.trim().length > 0) {
      pieces.push(buffer.trim());
      buffer = '';
    }
    buffer += chunk.slice(cursor, sentenceEnd);
    lastBoundary = sentenceEnd;
    cursor = sentenceEnd;
    if (buffer.length > MAX_CHUNK) {
      pieces.push(buffer.trim());
      buffer = '';
    }
  }

  if (cursor < chunk.length) {
    buffer += chunk.slice(cursor);
  }
  if (buffer.trim().length > 0) {
    pieces.push(buffer.trim());
  }

  return pieces.length > 0 ? pieces : [chunk];
}
