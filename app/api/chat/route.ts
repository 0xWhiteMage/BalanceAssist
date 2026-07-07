import { NextResponse } from 'next/server';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { z } from 'zod';
import { getEnv } from '@/lib/env';
import { buildSystemPrompt } from '@/lib/conversation/system-prompt';
import { sanitizeDraftUpdates } from '@/lib/conversation/draft-schema';
import { getLocalResponse, getFallbackResponse } from '@/lib/conversation/local-responses';
import { conversationSteps } from '@/lib/conversation/flow';
import { sanitizeReply } from '@/lib/conversation/reply-sanitize';
import { checkRateLimit } from '@/lib/conversation/rate-limit';
import { isBriefReadyForApproval, missingReviewFields, REVIEW_PROMPT } from '@/lib/conversation/review-state';
import {
  guardAgainstFabricatedBriefFields,
  recordBriefUpdatesJsonSchema,
  recordBriefUpdatesSchema,
  sanitizeShareWork,
  shareWorkJsonSchema
} from '@/lib/conversation/tool-schema';
import { listAllWorks, type WorkEntry } from '@/lib/conversation/works-search';
import type { ConversationStepId } from '@/lib/conversation/types';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { LeadDraft } from '@/lib/onboarding/types';

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(8000)
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(20),
  context: z
    .object({
      step: z.string().optional(),
      isTeamConnected: z.boolean().optional(),
      draft: z.string().optional(),
      sessionId: z.string().optional()
    })
    .optional()
});

export async function OPTIONS() {
  return corsOptionsResponse();
}

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string };
const PROVIDER_TIMEOUT_MS = 15000;
const TOOL_NAME = 'record_brief_updates';
const SHARE_WORK_TOOL_NAME = 'share_work';

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
};

async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: OpenAIMessage[],
  options?: {
    useTools?: boolean;
    sessionId?: string;
    priorDraft?: Record<string, string>;
    userMessage?: string;
  }
): Promise<ProviderResult> {
  const useTools = options?.useTools ?? false;
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: useTools ? 2400 : 600,
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
  const content = typeof message?.content === 'string' ? message.content : getFallbackResponse();

  if (choice?.finish_reason === 'length') {
    const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
    if (!hasToolCalls) {
      console.warn('[chat] response truncated: finish_reason=length');
    }
  }

  if (useTools && Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
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
            console.warn('[chat] record_brief_updates tool arguments failed schema validation', {
              sessionId: options?.sessionId,
              issues: result.error.issues
            });
          }
        } catch (error) {
          console.warn('[chat] record_brief_updates tool arguments failed to parse as JSON', {
            sessionId: options?.sessionId,
            message: error instanceof Error ? error.message : 'unknown'
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
          console.warn('[chat] share_work tool arguments failed to parse as JSON', {
            sessionId: options?.sessionId,
            message: error instanceof Error ? error.message : 'unknown'
          });
        }
      }
    }

    if (toolArguments !== null || sharedWork !== null) {
      return { content, toolArguments, sharedWork };
    }
  }

  return { content, toolArguments: null, sharedWork: null };
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
  baseUrl: string,
  sessionId: string | undefined,
  category: 'reply' | 'refusal' | 'local_fallback',
  hasDraft: boolean
) {
  try {
    await fetch(`${baseUrl}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionId ?? 'anonymous',
        eventName: 'llm_request',
        properties: { category, hasDraft }
      })
    });
  } catch {
    // best-effort
  }
}

function parsePriorDraft(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
}

type ChatContext = {
  step?: string;
  isTeamConnected?: boolean;
  draft?: string;
  sessionId?: string;
} | undefined;

function buildLlmContext(context: ChatContext) {
  const priorDraft = parsePriorDraft(context?.draft);
  const briefReady = isBriefReadyForApproval(priorDraft);
  const systemPrompt = buildSystemPrompt({
    isTeamConnected: context?.isTeamConnected,
    step: context?.step,
    draft: context?.draft,
    briefReady
  });
  return { priorDraft, briefReady, systemPrompt };
}

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, chatRequestSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { messages, context } = parsed.data;
  const env = getEnv();
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const sessionId = context?.sessionId;
  const baseUrl = new URL(request.url).origin;

  if (sessionId) {
    const limit = checkRateLimit(sessionId);
    if (!limit.allowed) {
      return jsonWithCors(
        {
          error: 'Rate limit reached',
          detail: `Max ${limit.max} LLM calls per session per hour.`
        },
        { status: 429 }
      );
    }
  }

  let visibleContent: string;
  let toolArguments: Record<string, unknown> | null = null;
  let sharedWork: SharedWork | null = null;
  let category: 'reply' | 'refusal' | 'local_fallback' = 'reply';

  try {
    if (env.DEEPSEEK_API_KEY) {
      const ctx = buildLlmContext(context);
      const systemPrompt = ctx.systemPrompt;
      const llmMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages];
      const model = env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
      const providerResult = await callOpenAICompatible(
        'https://api.deepseek.com/v1/chat/completions',
        env.DEEPSEEK_API_KEY,
        model,
        llmMessages,
        { useTools: true, sessionId, priorDraft: ctx.priorDraft, userMessage: lastUserMessage }
      );
      visibleContent = providerResult.content;
      toolArguments = providerResult.toolArguments;
      sharedWork = providerResult.sharedWork;
    } else if (env.MINIMAX_API_KEY) {
      const ctx = buildLlmContext(context);
      const systemPrompt = ctx.systemPrompt;
      const llmMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages];
      visibleContent = await callMinimax(env.MINIMAX_API_KEY, llmMessages);
    } else if (env.OPENAI_API_KEY) {
      const ctx = buildLlmContext(context);
      const systemPrompt = ctx.systemPrompt;
      const llmMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages];
      const endpoint = env.OPENAI_API_ENDPOINT ?? 'https://api.openai.com/v1/chat/completions';
      const model = env.OPENAI_MODEL ?? 'gpt-4o-mini';
      const providerResult = await callOpenAICompatible(
        endpoint,
        env.OPENAI_API_KEY,
        model,
        llmMessages,
        { useTools: true, sessionId, priorDraft: ctx.priorDraft, userMessage: lastUserMessage }
      );
      visibleContent = providerResult.content;
      toolArguments = providerResult.toolArguments;
      sharedWork = providerResult.sharedWork;
    } else {
      category = 'local_fallback';
      const localResponse = getLocalResponse(lastUserMessage, {
        draft: {} as never,
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
    const replyText = sanitized.reply;
    if (sanitized.overridden) {
      category = 'refusal';
    }

    const draftUpdates = sanitizeDraftUpdates(sanitized.draft);
    const priorDraft = parsePriorDraft(context?.draft);
    const mergedDraft = { ...priorDraft, ...draftUpdates };
    const briefReady = isBriefReadyForApproval(mergedDraft);
    const missingFields = missingReviewFields(mergedDraft);

    if (sessionId) {
      void logLlmEvent(baseUrl, sessionId, category, Object.keys(draftUpdates).length > 0);
    }

    return jsonWithCors({
      message: replyText,
      draftUpdates,
      briefReady,
      reviewPrompt: briefReady ? REVIEW_PROMPT : null,
      missingFields,
      sharedWork: sharedWork ?? undefined
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonWithCors({ error: 'Chat service error', detail: message }, { status: 500 });
  }
}