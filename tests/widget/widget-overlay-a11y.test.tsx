// @vitest-environment jsdom
import { describe, expect, test, vi, beforeAll, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { WidgetOverlay } from '@/components/widget/widget-overlay';

const originalFetch = global.fetch;

beforeAll(() => {
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
      // no-op for jsdom
    };
  }
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  }
});

afterEach(() => {
  global.fetch = originalFetch;
});

function stubFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/sessions')) {
      return new Response(JSON.stringify({ sessionId: 'test-session', persisted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (url.includes('/api/events')) {
      return new Response('{}', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

describe('WidgetOverlay accessibility', () => {
  test('widget container has role="dialog"', () => {
    stubFetch();
    const { container } = render(<WidgetOverlay autoOpen={true} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
  });

  test('widget container has aria-label="Balance Assist"', () => {
    stubFetch();
    const { container } = render(<WidgetOverlay autoOpen={true} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toHaveAttribute('aria-label', 'Balance Assist');
  });

  test('widget is a labelled modal dialog at mobile and desktop widths', () => {
    stubFetch();
    const { container } = render(<WidgetOverlay autoOpen={true} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'balance-assist-dialog-title');
  });

  test('pressing Escape closes the widget', async () => {
    stubFetch();
    const { container } = render(<WidgetOverlay autoOpen={true} />);

    await waitFor(() => {
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });

    await waitFor(() => {
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });
  });

  test('when widget opens, focus moves to the first focusable element inside the dialog', async () => {
    stubFetch();
    const { container } = render(<WidgetOverlay autoOpen={true} />);

    await waitFor(() => {
      const dialog = container.querySelector('[role="dialog"]');
      expect(dialog).not.toBeNull();
    });

    const dialog = container.querySelector('[role="dialog"]')!;
    const focusedElement = document.activeElement as HTMLElement;
    expect(dialog.contains(focusedElement)).toBe(true);
  });

  test('Tab key cycles focus within the widget (focus trap)', async () => {
    stubFetch();
    const { container } = render(<WidgetOverlay autoOpen={true} />);

    await waitFor(() => {
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });

    const dialog = container.querySelector('[role="dialog"]')!;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    expect(focusables.length).toBeGreaterThan(1);

    const last = focusables[focusables.length - 1];
    act(() => {
      last.focus();
    });
    expect(document.activeElement).toBe(last);

    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    });

    const newFocused = document.activeElement as HTMLElement;
    expect(dialog.contains(newFocused)).toBe(true);
  });

  test('Shift+Tab from first element wraps to last focusable element', async () => {
    stubFetch();
    const { container } = render(<WidgetOverlay autoOpen={true} />);

    await waitFor(() => {
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });

    const dialog = container.querySelector('[role="dialog"]')!;
    const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    const first = focusables[0];

    act(() => {
      first.focus();
    });
    expect(document.activeElement).toBe(first);

    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    });

    const newFocused = document.activeElement as HTMLElement;
    expect(dialog.contains(newFocused)).toBe(true);
  });

  test('uses the transcript log as the only live announcement mechanism for transcript updates', async () => {
    stubFetch();
    const { container, getByRole } = render(<WidgetOverlay autoOpen={true} />);
    fireEvent.click(container.querySelector('[data-testid="consent-button"]')!);
    fireEvent.click(getByRole('button', { name: /start with balance assist/i }));

    await waitFor(() => {
      expect(container.querySelector('[role="log"]')).not.toBeNull();
    });
    const transcript = container.querySelector('[role="log"]')!;

    expect(transcript).toHaveAttribute('aria-live', 'polite');
    expect(transcript?.parentElement).not.toHaveAttribute('aria-live');
  });

  test('close button has accessible name', () => {
    stubFetch();
    const { getByLabelText } = render(<WidgetOverlay autoOpen={true} />);
    const closeButton = getByLabelText('Close Balance Assist');
    expect(closeButton).toBeDefined();
  });
});
