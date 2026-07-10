import { describe, expect, test } from 'vitest';
import { getBalanceFaqResponse } from '@/lib/conversation/balance-faq';

describe('getBalanceFaqResponse', () => {
  test('matches the company overview prompt', () => {
    const reply = getBalanceFaqResponse('Tell me about the company.');

    expect(reply?.messages).toHaveLength(2);
    expect(reply?.messages[0]).toMatch(/Singapore-based, full-service video and creative production house/i);
  });

  test('matches filming questions and includes a work query', () => {
    const reply = getBalanceFaqResponse('Can you do filming?');

    expect(reply?.messages).toHaveLength(2);
    expect(reply?.sharedWorkQuery).toBe('production canon dulux doctor anywhere');
  });

  test('matches founder questions', () => {
    const reply = getBalanceFaqResponse('Who founded Balance?');

    expect(reply?.messages[0]).toMatch(/Benjamin Ang/i);
    expect(reply?.messages[1]).toMatch(/PURE NOW creative podcast/i);
  });

  test('matches past-work requests', () => {
    const reply = getBalanceFaqResponse('Could you share some portfolio examples?');

    expect(reply?.messages).toEqual([
      "Absolutely — I can share a few relevant references. If you tell me the format or service you're interested in (for example 2D animation, event visuals, or product launch work), I'll pull the most relevant projects."
    ]);
  });
});
