type ProviderToolCall = {
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
};

export type ParsedProviderResponse = {
  toolCalls: ProviderToolCall[];
  rawContent: string | null;
  finishReason: unknown;
};

export function parseProviderResponse(data: unknown): ParsedProviderResponse {
  if (!data || typeof data !== 'object') {
    return { toolCalls: [], rawContent: null, finishReason: undefined };
  }

  const choices = (data as { choices?: unknown }).choices;
  const choice = Array.isArray(choices) && choices[0] && typeof choices[0] === 'object'
    ? choices[0] as { message?: unknown; finish_reason?: unknown }
    : undefined;
  const message = choice?.message && typeof choice.message === 'object'
    ? choice.message as { content?: unknown; tool_calls?: unknown }
    : undefined;

  return {
    toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : [],
    rawContent: typeof message?.content === 'string' ? message.content : null,
    finishReason: choice?.finish_reason
  };
}
