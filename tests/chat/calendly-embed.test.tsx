import { describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { CalendlyEmbed } from '@/components/chat/calendly-embed';

const TEST_URL = 'https://calendly.com/haiha-dang/catch-up';

function CalendlyHarness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open calendar</button>
      {open && <CalendlyEmbed url={TEST_URL} onBack={() => setOpen(false)} />}
    </div>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CalendlyEmbed', () => {
  test('passes the provided URL to Calendly.initInlineWidget unmodified (no query params appended)', () => {
    const initCalls: Array<{ url: string }> = [];
    (window as unknown as { Calendly: unknown }).Calendly = {
      initInlineWidget: ({ url }: { url: string; parentElement: HTMLElement }) => {
        initCalls.push({ url });
      }
    };

    render(<CalendlyEmbed url={TEST_URL} onBack={() => {}} />);

    expect(initCalls).toHaveLength(1);
    expect(initCalls[0].url).toBe(TEST_URL);
    expect(initCalls[0].url).not.toMatch(/[?&]hide_gdpr_banner=/);
    expect(initCalls[0].url).not.toMatch(/[?&]primary_color=/);
    expect(initCalls[0].url).not.toMatch(/#/);

    delete (window as unknown as { Calendly?: unknown }).Calendly;
  });

  test('after 1500ms with no Calendly.loaded event, renders an iframe fallback with the URL as-is in src', () => {
    vi.useFakeTimers();
    const onBack = vi.fn();
    render(<CalendlyEmbed url={TEST_URL} onBack={onBack} />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading calendar');

    // before the fallback timeout, no iframe is shown
    expect(screen.queryByTestId('calendly-fallback-iframe')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1600);
    });

    const iframe = screen.getByTestId('calendly-fallback-iframe') as HTMLIFrameElement;
    expect(iframe).toBeInTheDocument();
    expect(iframe.tagName).toBe('IFRAME');
    expect(iframe.getAttribute('src')).toBe(TEST_URL);
    expect(iframe.getAttribute('src')).not.toMatch(/[?&]hide_gdpr_banner=/);
    expect(iframe).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: /back to chat/i })).toHaveClass('balance-widget-action');
  });

  test('clicking the Back button invokes onBack', () => {
    const onBack = vi.fn();
    render(<CalendlyEmbed url={TEST_URL} onBack={onBack} />);
    screen.getByRole('button', { name: /back to chat/i }).click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  test('restores focus to the calendar opener after using Back from the iframe', () => {
    vi.useFakeTimers();
    render(<CalendlyHarness />);
    const opener = screen.getByRole('button', { name: 'Open calendar' });
    opener.focus();
    fireEvent.click(opener);

    act(() => vi.advanceTimersByTime(1600));
    const frame = screen.getByTitle('Book a Discovery Call');
    frame.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }));

    expect(screen.queryByRole('dialog', { name: 'Book a Discovery Call' })).toBeNull();
    expect(opener).toHaveFocus();
  });

  test('ignores calendly scheduled events from an unexpected message source', () => {
    const onScheduled = vi.fn();
    render(<CalendlyEmbed url={TEST_URL} onBack={() => {}} onScheduled={onScheduled} />);

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://calendly.com',
      data: { event: 'calendly.event_scheduled' },
      source: window
    }));

    expect(onScheduled).not.toHaveBeenCalled();
  });

  test('accepts a scheduled event from the actual iframe created by the inline widget', () => {
    const onScheduled = vi.fn();
    (window as unknown as { Calendly: unknown }).Calendly = {
      initInlineWidget: ({ parentElement, url }: { url: string; parentElement: HTMLElement }) => {
        const frame = document.createElement('iframe');
        frame.src = url;
        parentElement.appendChild(frame);
      }
    };
    render(<CalendlyEmbed url={TEST_URL} onBack={() => {}} onScheduled={onScheduled} />);
    const frame = document.querySelector('.calendly-inline-widget iframe') as HTMLIFrameElement;

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://calendly.com',
      data: { event: 'calendly.event_scheduled' },
      source: frame.contentWindow
    }));

    expect(onScheduled).toHaveBeenCalledOnce();
    delete (window as unknown as { Calendly?: unknown }).Calendly;
  });
});
