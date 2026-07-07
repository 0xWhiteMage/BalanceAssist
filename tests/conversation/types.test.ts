import { describe, expect, test } from 'vitest';
import type { InlineCard } from '@/lib/conversation/types';

describe('InlineCard union', () => {
  test('accepts the calendly variant with optional subtitle', () => {
    const card: InlineCard = {
      type: 'calendly',
      url: 'https://calendly.com/example/intro',
      label: 'Book'
    };
    expect(card.type).toBe('calendly');
  });

  test('accepts the telegram variant without url', () => {
    const card: InlineCard = { type: 'telegram', label: 'Talk to a human' };
    expect(card.type).toBe('telegram');
  });

  test('accepts the email variant with href field', () => {
    const card: InlineCard = {
      type: 'email',
      label: 'Email us',
      href: 'mailto:hello@balancestudio.tv'
    };
    expect(card.type).toBe('email');
    expect(card.href).toBe('mailto:hello@balancestudio.tv');
  });

  test('email variant href is required at the type level', () => {
    const card = {
      type: 'email',
      label: 'Email us',
      subtitle: '1-day reply',
      href: 'mailto:hi@example.com'
    } satisfies InlineCard;
    expect(card.href).toBe('mailto:hi@example.com');
  });
});
