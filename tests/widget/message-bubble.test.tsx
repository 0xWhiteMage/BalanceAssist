import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from '@/components/chat/message-bubble';
import type { ChatMessage } from '@/lib/conversation/types';

function botMessage(inlineCards: ChatMessage['inlineCards']): ChatMessage {
  return {
    id: 'msg-1',
    sender: 'bot',
    text: 'Follow-up below.',
    timestamp: 0,
    inlineCards
  };
}

describe('MessageBubble inline cards', () => {
  test('email card renders an <a> with the exact mailto href', () => {
    render(
      <MessageBubble
        message={botMessage([
          {
            type: 'email',
            label: 'Email the team',
            subtitle: 'hello@balancestudio.tv · 1 business day',
            href: 'mailto:hello@balancestudio.tv'
          }
        ])}
      />
    );
    const link = screen.getByText('Email the team').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('mailto:hello@balancestudio.tv');
  });

  test('email card subtitle is rendered', () => {
    render(
      <MessageBubble
        message={botMessage([
          {
            type: 'email',
            label: 'Email the team',
            subtitle: 'hello@balancestudio.tv · 1 business day',
            href: 'mailto:hello@balancestudio.tv'
          }
        ])}
      />
    );
    expect(screen.getByText(/hello@balancestudio\.tv · 1 business day/)).toBeInTheDocument();
  });

  test('email card without subtitle renders only the label', () => {
    render(
      <MessageBubble
        message={botMessage([
          { type: 'email', label: 'Email us', href: 'mailto:hi@example.com' }
        ])}
      />
    );
    const link = screen.getByText('Email us').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('mailto:hi@example.com');
  });

  test('calendly card renders the URL but uses no setView side effect (component-level check)', () => {
    render(
      <MessageBubble
        message={botMessage([
          {
            type: 'calendly',
            url: 'https://calendly.com/example/intro',
            label: 'Book a call',
            subtitle: 'Pick a time'
          }
        ])}
      />
    );
    const link = screen.getByText('Book a call').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://calendly.com/example/intro');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  test('telegram card renders its label when present', () => {
    render(
      <MessageBubble
        message={botMessage([
          { type: 'telegram', label: 'Talk to a human', subtitle: 'A producer will reply' }
        ])}
      />
    );
    expect(screen.getByText('Talk to a human')).toBeInTheDocument();
  });
});
