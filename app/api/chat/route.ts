import { NextResponse } from 'next/server';
import { corsOptionsResponse, jsonWithCors, parseRequestBody } from '@/lib/api/route-helpers';
import { z } from 'zod';
import { getEnv } from '@/lib/env';
import { buildSystemPrompt } from '@/lib/conversation/system-prompt';
import { getLocalResponse, getFallbackResponse } from '@/lib/conversation/local-responses';
import { conversationSteps } from '@/lib/conversation/flow';
import type { ConversationStepId } from '@/lib/conversation/types';

const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string()
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
  context: z
    .object({
      step: z.string().optional(),
      isTeamConnected: z.boolean().optional(),
      draft: z.string().optional()
    })
    .optional()
});

export async function OPTIONS() {
  return corsOptionsResponse();
}

type OpenAIMessage = { role: 'system' | 'user' | 'assistant'; content: string };

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

async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: OpenAIMessage[]
): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, messages, max_tokens: 256, temperature: 0.7 })
  });

  if (!response.ok) {
    throw new Error(`LLM API returned ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? getFallbackResponse();
}

async function callMinimax(apiKey: string, messages: OpenAIMessage[]): Promise<string> {
  const systemContent = messages.find((m) => m.role === 'system')?.content ?? '';
  const userMessages = messages.filter((m) => m.role !== 'system');

  const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
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
      max_tokens: 256,
      temperature: 0.7
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

export async function POST(request: Request) {
  const parsed = await parseRequestBody(request, chatRequestSchema);

  if (!parsed.ok) {
    return parsed.response;
  }

  const { messages, context } = parsed.data;
  const env = getEnv();
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  try {
    let response: string;

    if (env.DEEPSEEK_API_KEY) {
      const systemPrompt = buildSystemPrompt({
        isTeamConnected: context?.isTeamConnected,
        step: context?.step,
        draft: context?.draft
      });
      const llmMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages];
      const model = env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
      response = await callOpenAICompatible(
        'https://api.deepseek.com/v1/chat/completions',
        env.DEEPSEEK_API_KEY,
        model,
        llmMessages
      );
    } else if (env.MINIMAX_API_KEY) {
      const systemPrompt = buildSystemPrompt({
        isTeamConnected: context?.isTeamConnected,
        step: context?.step,
        draft: context?.draft
      });
      const llmMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages];
      response = await callMinimax(env.MINIMAX_API_KEY, llmMessages);
    } else if (env.OPENAI_API_KEY) {
      const systemPrompt = buildSystemPrompt({
        isTeamConnected: context?.isTeamConnected,
        step: context?.step,
        draft: context?.draft
      });
      const llmMessages = [{ role: 'system' as const, content: systemPrompt }, ...messages];
      const endpoint = env.OPENAI_API_ENDPOINT ?? 'https://api.openai.com/v1/chat/completions';
      const model = env.OPENAI_MODEL ?? 'gpt-4o-mini';
      response = await callOpenAICompatible(endpoint, env.OPENAI_API_KEY, model, llmMessages);
    } else {
      const localResponse = getLocalResponse(lastUserMessage, {
        draft: {} as never,
        step: (context?.step as ConversationStepId) ?? 'free-chat',
        isTeamConnected: context?.isTeamConnected ?? false
      });

      if (localResponse) {
        response = localResponse;
      } else if (context?.step && conversationSteps[context.step as ConversationStepId]?.quickReplies) {
        response = "I didn't quite catch that — could you pick one of the options above, or tell me about your project?";
      } else {
        response = getFallbackResponse();
      }

      await new Promise((r) => setTimeout(r, 400));
    }

    return jsonWithCors({ message: response });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonWithCors({ error: 'Chat service error', detail: message }, { status: 500 });
  }
}
