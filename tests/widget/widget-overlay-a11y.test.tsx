// @vitest-environment jsdom
import { describe, expect, test, vi, beforeAll, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act, screen } from '@testing-library/react';
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
  setMobileViewport(false);
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

function setMobileViewport(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)' ? matches : false,
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

function stubReadyFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/chat') && init?.method === 'POST') {
      const canonicalDraft = {
        service: 'production', projectScope: 'A launch film', projectObjective: 'Build awareness',
        audience: 'Young adults', intendedOutputs: 'Hero film', timelineBand: 'Not sure yet',
        budgetBand: 'Prefer not to share', contactEmail: 'jayden@example.com'
      };
      return new Response(JSON.stringify({
        message: 'Use the rail on the right to review this.',
        outcome: 'draft_persisted', canonicalDraft, canonicalProvenance: {}, draftVersion: 1,
        currentStage: 'references-contact', stageRecaps: [], briefReady: true,
        reviewPrompt: 'Use the rail on the right to review this.', missingFields: []
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/sessions')) {
      return new Response(JSON.stringify({ sessionId: 'test-session', persisted: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

async function startReadyAiIntake() {
  fireEvent.click(screen.getByRole('button', { name: 'Build a brief with AI' }));
  const input = await screen.findByPlaceholderText(/Type your message/i, {}, { timeout: 5000 });
  await waitFor(() => {
    expect(screen.getByRole('dialog', { name: /balance assist/i })).toHaveTextContent(/What can I help you with today\?/i);
  }, { timeout: 7000 });
  fireEvent.change(input, { target: { value: 'A launch film' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByRole('tablist', { name: 'Widget sections' }, { timeout: 7000 });
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

  test('compact desktop is nonmodal while maximized and mobile modes are modal', () => {
    stubFetch();
    const { container, unmount } = render(<WidgetOverlay autoOpen={true} />);
    let dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(dialog).toHaveAttribute('aria-labelledby', 'balance-assist-dialog-title');
    fireEvent.click(screen.getByRole('button', { name: 'Maximize Balance Assist' }));
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('data-maximized', 'true');
    unmount();

    setMobileViewport(true);
    stubFetch();
    const mobile = render(<WidgetOverlay autoOpen={true} />);
    dialog = mobile.container.querySelector('[role="dialog"]');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.queryByRole('button', { name: /maximize balance assist/i })).not.toBeInTheDocument();
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

  test('entry actions remain native enabled buttons at the informed choice', () => {
    stubFetch();
    const { getByRole } = render(<WidgetOverlay autoOpen={true} />);

    const initialActions = ['Build a brief with AI', 'Talk to the team without AI', 'Leave'];
    for (const name of initialActions) {
      const action = getByRole('button', { name });
      expect(action.tagName).toBe('BUTTON');
      expect(action).toBeEnabled();
      expect(action).toHaveAttribute('type', 'button');
      expect(action).toHaveClass('balance-entry-action');
    }

  });

  test('Tab key cycles focus within the widget (focus trap)', async () => {
    stubFetch();
    const { container } = render(<WidgetOverlay autoOpen={true} />);

    await waitFor(() => {
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Maximize Balance Assist' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Maximize Balance Assist' }));
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
    const { container, findByRole, getByRole } = render(<WidgetOverlay autoOpen={true} />);
    fireEvent.click(getByRole('button', { name: 'Build a brief with AI' }));

    await waitFor(() => {
      expect(container.querySelector('[role="log"]')).not.toBeNull();
    });
    const transcript = getByRole('log', { name: 'Conversation transcript' });

    expect(transcript).toHaveAttribute('aria-live', 'polite');
    expect(transcript?.parentElement).not.toHaveAttribute('aria-live');
    expect(await findByRole('textbox', { name: 'Message Balance Assist' })).toBeVisible();
  });

  test('close button has accessible name', () => {
    stubFetch();
    const { getByLabelText } = render(<WidgetOverlay autoOpen={true} />);
    const closeButton = getByLabelText('Close Balance Assist');
    expect(closeButton).toBeDefined();
  });

  test('does not render enabled widget controls inside an inert subtree', () => {
    stubFetch();
    const { container } = render(<WidgetOverlay autoOpen={true} />);
    const controls = container.querySelectorAll<HTMLElement>('.balance-widget-root button:not([disabled]), .balance-widget-root a[href], .balance-widget-root input:not([disabled])');
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.closest('[inert]')).toBeNull();
  });

  test('does not add persistent stage chrome to either intake path', async () => {
    setMobileViewport(false);
    stubFetch();
    const { unmount } = render(<WidgetOverlay autoOpen={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Build a brief with AI' }));
    expect(screen.queryByRole('list', { name: 'Intake stages' })).toBeNull();
    unmount();

    stubFetch();
    render(<WidgetOverlay autoOpen={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Talk to the team without AI' }));
    expect(screen.queryByRole('list', { name: 'Intake stages' })).toBeNull();
  });

  test('implements mobile tab arrow, Home, and End semantics', async () => {
    setMobileViewport(true);
    stubReadyFetch();
    render(<WidgetOverlay autoOpen={true} />);
    await startReadyAiIntake();

    const chat = screen.getByRole('tab', { name: 'Chat' });
    const brief = screen.getByRole('tab', { name: 'Brief' });
    const chatPanel = document.getElementById('widget-chat-panel');
    const briefPanel = document.getElementById('widget-brief-panel');
    expect(chatPanel).toBeVisible();
    expect(chatPanel).not.toHaveAttribute('aria-hidden');
    expect(briefPanel).toBeInTheDocument();
    expect(briefPanel).not.toBeVisible();
    expect(briefPanel).toHaveAttribute('aria-hidden', 'true');
    expect(briefPanel).toHaveAttribute('inert');
    expect(chat).toHaveAttribute('aria-controls', 'widget-chat-panel');
    expect(brief).toHaveAttribute('aria-controls', 'widget-brief-panel');
    expect(chat).toHaveClass('balance-widget-action');

    fireEvent.keyDown(chat, { key: 'ArrowRight' });
    expect(brief).toHaveFocus();
    expect(brief).toHaveAttribute('aria-selected', 'true');
    expect(chatPanel).not.toBeVisible();
    expect(chatPanel).toHaveAttribute('aria-hidden', 'true');
    expect(chatPanel).toHaveAttribute('inert');
    expect(briefPanel).toBeVisible();

    const edit = screen.getByRole('button', { name: 'Edit project description' });
    fireEvent.click(edit);
    const editor = screen.getByRole('textbox', { name: 'Project description' });
    fireEvent.change(editor, { target: { value: 'Unsaved mobile wording' } });
    fireEvent.click(chat);
    expect(editor).not.toBeVisible();
    expect(editor.closest('[inert]')).toBe(briefPanel);
    fireEvent.click(brief);
    expect(screen.getByRole('textbox', { name: 'Project description' })).toHaveValue('Unsaved mobile wording');

    fireEvent.keyDown(brief, { key: 'ArrowLeft' });
    expect(chat).toHaveFocus();
    fireEvent.keyDown(chat, { key: 'End' });
    expect(brief).toHaveFocus();
    fireEvent.keyDown(brief, { key: 'Home' });
    expect(chat).toHaveFocus();

    const human = screen.getByRole('button', { name: 'Talk to the team without AI' });
    expect(human).toHaveClass('balance-widget-action');
    expect(human).toBeVisible();
  }, 15_000);
});
