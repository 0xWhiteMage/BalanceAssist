import { describe, expect, test } from 'vitest';
import { parseProviderResponse } from '@/app/api/chat/provider-response';

describe('parseProviderResponse', () => {
  test('extracts content, finish reason, and tool calls from an OpenAI-compatible response', () => {
    const toolCall = { function: { name: 'record_brief_updates', arguments: '{"service":"production"}' } };

    expect(parseProviderResponse({
      choices: [{ message: { content: 'Saved.', tool_calls: [toolCall] }, finish_reason: 'tool_calls' }]
    })).toEqual({ rawContent: 'Saved.', toolCalls: [toolCall], finishReason: 'tool_calls' });
  });

  test('returns an empty boundary result for malformed provider data', () => {
    expect(parseProviderResponse({ choices: 'invalid' })).toEqual({
      rawContent: null,
      toolCalls: [],
      finishReason: undefined
    });
  });
});
