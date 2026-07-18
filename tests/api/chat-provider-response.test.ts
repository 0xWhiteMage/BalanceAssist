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

  test('preserves tool calls when the provider returns null content', () => {
    const toolCall = { function: { name: 'record_brief_updates', arguments: '{"projectScope":"Launch film"}' } };

    expect(parseProviderResponse({
      choices: [{ message: { content: null, tool_calls: [toolCall] }, finish_reason: 'tool_calls' }]
    })).toEqual({ rawContent: null, toolCalls: [toolCall], finishReason: 'tool_calls' });
  });
});
