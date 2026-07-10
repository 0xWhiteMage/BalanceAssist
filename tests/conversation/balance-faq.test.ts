import { describe, expect, test } from 'vitest';
import { getBalanceFaqResponse } from '@/lib/conversation/balance-faq';

describe('getBalanceFaqResponse', () => {
  test('matches the company overview prompt', () => {
    const reply = getBalanceFaqResponse('Can you tell me about Balance Studio?');

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

    expect(reply?.messages).toHaveLength(2);
    expect(reply?.messages[0]).toMatch(/Benjamin Ang/i);
    expect(reply?.messages[1]).toMatch(/PURE NOW creative podcast/i);
  });

  test('matches past-work requests', () => {
    const reply = getBalanceFaqResponse('Could you share some portfolio examples?');

    expect(reply?.messages).toHaveLength(2);
    expect(reply?.messages[0]).toMatch(/share a few relevant references/i);
    expect(reply?.messages[1]).toMatch(/format or service/i);
  });
});
