# Task 11: Mobile, Accessibility, and Calendly Integrity

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add mobile responsive tabbed layout, focus management, ARIA accessibility, and calendly origin validation to the BalanceAssist widget.

**Architecture:** Modify 3 existing components (widget-overlay, review-panel, calendly-embed) and add 1 new test file. Mobile uses a 640px breakpoint with tabbed layout. Focus trapping uses refs and keydown handlers. Calendly validates event.origin against https://calendly.com.

**Tech Stack:** React 19, TypeScript, Vitest, @testing-library/react

---

## Task 1: Add mobile responsive tabbed layout to widget-overlay.tsx

**Files:**
- Modify: `components/widget/widget-overlay.tsx:1143-1171` (container div)
- Modify: `components/widget/widget-overlay.tsx:1202-1231` (review rail area)

**Step 1: Add mobile tab state and CSS media query**

Add state for mobile tab selection and a useEffect to detect window width:

```tsx
// After existing useState declarations (around line 198)
const [isMobile, setIsMobile] = useState(false);
const [mobileTab, setMobileTab] = useState<'chat' | 'brief'>('chat');

// Add useEffect for responsive detection
useEffect(() => {
  function checkMobile() {
    setIsMobile(window.innerWidth < 640);
  }
  checkMobile();
  window.addEventListener('resize', checkMobile);
  return () => window.removeEventListener('resize', checkMobile);
}, []);
```

**Step 2: Update container to include role="dialog" and aria-label**

Update the main widget container div (line 1154) to add ARIA attributes:

```tsx
<div
  role="dialog"
  aria-label="Balance Assist"
  style={{
    position: 'absolute',
    bottom: '72px',
    right: '0px',
    width: getWidgetWidth({ isTeamConnected, hasProjectIntent }),
    height: 'min(580px, calc(100vh - 120px))',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '16px',
    overflow: 'hidden',
    background: brandTokens.gradients.panel,
    color: brandTokens.colors.lightText,
    boxShadow: brandTokens.shadows.panel,
    border: `1px solid ${brandTokens.colors.border}`,
    animation: 'balance-assist-fade-in 0.2s ease-out'
  }}
>
```

**Step 3: Add mobile tab bar when isMobile is true**

Before the content area (before line 1172), add a mobile tab bar:

```tsx
{/* Mobile Tab Bar */}
{isMobile && (
  <div
    role="tablist"
    aria-label="Widget views"
    style={{
      display: 'flex',
      borderBottom: `1px solid ${brandTokens.colors.subtleBorder}`,
      background: 'rgba(16, 16, 16, 0.6)',
      flexShrink: 0
    }}
  >
    <button
      role="tab"
      aria-selected={mobileTab === 'chat'}
      aria-controls="widget-chat-panel"
      onClick={() => setMobileTab('chat')}
      style={{
        flex: 1,
        padding: '10px 16px',
        background: mobileTab === 'chat' ? 'rgba(219, 181, 128, 0.15)' : 'transparent',
        border: 'none',
        borderBottom: mobileTab === 'chat' ? `2px solid ${brandTokens.colors.warmGold}` : '2px solid transparent',
        color: mobileTab === 'chat' ? brandTokens.colors.warmGold : brandTokens.colors.mutedText,
        fontSize: '12px',
        fontWeight: 600,
        cursor: 'pointer',
        textTransform: 'uppercase',
        letterSpacing: '0.08em'
      }}
    >
      Chat
    </button>
    {hasProjectIntent && (
      <button
        role="tab"
        aria-selected={mobileTab === 'brief'}
        aria-controls="widget-brief-panel"
        onClick={() => setMobileTab('brief')}
        style={{
          flex: 1,
          padding: '10px 16px',
          background: mobileTab === 'brief' ? 'rgba(219, 181, 128, 0.15)' : 'transparent',
          border: 'none',
          borderBottom: mobileTab === 'brief' ? `2px solid ${brandTokens.colors.warmGold}` : '2px solid transparent',
          color: mobileTab === 'brief' ? brandTokens.colors.warmGold : brandTokens.colors.mutedText,
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
          textTransform: 'uppercase',
          letterSpacing: '0.08em'
        }}
      >
        Brief
      </button>
    )}
  </div>
)}
```

**Step 4: Conditionally render review rail based on mobileTab**

Update the review rail section (lines 1202-1231) to respect mobile tab:

```tsx
{!isTeamConnected && hasProjectIntent && (!isMobile || mobileTab === 'brief') && (
  <div
    data-testid="review-rail"
    id="widget-brief-panel"
    role="tabpanel"
    style={{
      width: isMobile ? '100%' : 280,
      flexShrink: 0,
      borderRight: isMobile ? 'none' : `1px solid ${brandTokens.colors.subtleBorder}`,
      overflowY: 'auto',
      background: 'rgba(16, 16, 16, 0.35)'
    }}
  >
    <ReviewPanel
      draft={draft}
      approved={briefApproved}
      mode={railMode}
      onApprove={handleApproveBrief}
      onContinueRefining={() => {
        setBriefApproved(false);
        setRailMode('essentials');
      }}
      onChange={handleDraftEdit}
      telegramBroadcastStatus={telegramBroadcastStatus}
      onBookCatchUp={() => {
        setCalendlyUrl('https://calendly.com/haiha-dang/catch-up');
        setView('calendly');
      }}
      onTalkToHuman={handleTeamConnect}
    />
  </div>
)}
```

**Step 5: Update chat panel to respect mobile tab**

Update the chat messages area (line 1233) to conditionally render:

```tsx
{(!isMobile || mobileTab === 'chat') && (
  <div
    id="widget-chat-panel"
    role="tabpanel"
    style={{
      flex: 1,
      overflowY: 'auto',
      overflowX: 'hidden',
      padding: '16px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '14px',
      minWidth: 0,
      maxWidth: '100%',
      position: 'relative'
    }}
  >
    {/* ... existing messages content ... */}
  </div>
)}
```

**Step 6: Run tests to verify no regressions**

Run: `npx vitest run tests/widget/widget-overlay-intent.test.tsx`
Expected: PASS

---

## Task 2: Add focus management and Escape key handling to widget-overlay.tsx

**Files:**
- Modify: `components/widget/widget-overlay.tsx:1143-1480` (widget container and effects)

**Step 1: Add focus trap ref and state**

Add refs for focus management:

```tsx
// After existing refs (around line 210)
const widgetContainerRef = useRef<HTMLDivElement>(null);
const previousFocusRef = useRef<HTMLElement | null>(null);
```

**Step 2: Add useEffect for focus trapping when widget opens**

Add a new useEffect after the existing effects:

```tsx
// Trap focus inside widget when open
useEffect(() => {
  if (!isOpen) return;

  // Store the previously focused element
  previousFocusRef.current = document.activeElement as HTMLElement;

  // Focus the widget container
  const timer = setTimeout(() => {
    widgetContainerRef.current?.focus();
  }, 100);

  return () => {
    clearTimeout(timer);
    // Restore focus when widget closes
    previousFocusRef.current?.focus();
  };
}, [isOpen]);
```

**Step 3: Add Escape key handler to close widget**

Add a useEffect for Escape key handling:

```tsx
// Close widget on Escape key
useEffect(() => {
  if (!isOpen) return undefined;

  function handleEscape(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }

  document.addEventListener('keydown', handleEscape);
  return () => document.removeEventListener('keydown', handleEscape);
}, [isOpen, handleClose]);
```

**Step 4: Add focus trap logic inside the widget**

Add another useEffect for trapping Tab key inside the widget:

```tsx
// Trap Tab key inside widget when open
useEffect(() => {
  if (!isOpen) return undefined;

  function handleTab(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;

    const container = widgetContainerRef.current;
    if (!container) return;

    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  }

  document.addEventListener('keydown', handleTab);
  return () => document.removeEventListener('keydown', handleTab);
}, [isOpen]);
```

**Step 5: Update widget container to be focusable**

Update the widget container div (line 1154) to add ref and tabIndex:

```tsx
<div
  ref={widgetContainerRef}
  role="dialog"
  aria-label="Balance Assist"
  tabIndex={-1}
  style={{
    position: 'absolute',
    bottom: '72px',
    right: '0px',
    width: getWidgetWidth({ isTeamConnected, hasProjectIntent }),
    height: 'min(580px, calc(100vh - 120px))',
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '16px',
    overflow: 'hidden',
    background: brandTokens.gradients.panel,
    color: brandTokens.colors.lightText,
    boxShadow: brandTokens.shadows.panel,
    border: `1px solid ${brandTokens.colors.border}`,
    animation: 'balance-assist-fade-in 0.2s ease-out',
    outline: 'none'
  }}
>
```

**Step 6: Run tests to verify no regressions**

Run: `npx vitest run tests/widget/widget-overlay-intent.test.tsx`
Expected: PASS

---

## Task 3: Add ARIA labels and keyboard navigation to review-panel.tsx

**Files:**
- Modify: `components/widget/review-panel.tsx:145-150` (panel container)
- Modify: `components/widget/review-panel.tsx:52-74` (SecondaryButton)
- Modify: `components/widget/review-panel.tsx:297-341` (action buttons)

**Step 1: Add aria-label to review panel container**

Update the panel container div (line 146) to add aria-label:

```tsx
<div
  style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}
  data-testid="review-panel"
  data-mode={mode}
  aria-label="Project brief review"
>
```

**Step 2: Add role="status" for live announcements**

Add a live region div after the progress strip (after line 151):

```tsx
<ProgressStrip completed={completed} total={TOTAL_FIELDS} data-completed={String(completed)} />

{/* Live region for screen reader announcements */}
<div
  role="status"
  aria-live="polite"
  aria-atomic="true"
  style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)' }}
>
  {approved
    ? `Brief approved. ${completed} of ${TOTAL_FIELDS} fields captured.`
    : `${completed} of ${TOTAL_FIELDS} fields captured.`
  }
</div>
```

**Step 3: Add accessible names to SecondaryButton**

Update the SecondaryButton component (line 52) to include aria-label:

```tsx
function SecondaryButton({ onClick, children, ariaLabel }: { onClick: () => void; children: React.ReactNode; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      style={{
        width: '100%',
        padding: '10px 12px',
        borderRadius: '8px',
        border: `1px solid ${brandTokens.colors.border}`,
        background: 'transparent',
        color: brandTokens.colors.lightText,
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        textTransform: 'uppercase',
        letterSpacing: '0.12em'
      }}
    >
      {children}
    </button>
  );
}
```

**Step 4: Update SecondaryButton usage to include aria-label**

Update line 229:

```tsx
{mode === 'summary' && ready && !approved && (
  <SecondaryButton onClick={onContinueRefining} ariaLabel="Continue refining brief">
    Continue refining
  </SecondaryButton>
)}
```

**Step 5: Add aria-label to action buttons**

Update the "Book a catch-up" button (line 298):

```tsx
<button
  type="button"
  data-testid="book-catch-up-cta"
  onClick={onBookCatchUp}
  aria-label="Book a catch-up call"
  style={{
    // ... existing styles
  }}
>
  Book a catch-up
</button>
```

Update the "Talk to a human" button (line 321):

```tsx
<button
  type="button"
  data-testid="talk-to-human-cta"
  onClick={onTalkToHuman}
  aria-label="Talk to a human team member"
  style={{
    // ... existing styles
  }}
>
  Talk to a human
</button>
```

**Step 6: Run tests to verify no regressions**

Run: `npx vitest run tests/widget/review-panel.test.tsx`
Expected: PASS

---

## Task 4: Add origin validation to calendly-embed.tsx

**Files:**
- Modify: `components/chat/calendly-embed.tsx:85-98` (message listener)

**Step 1: Add origin validation to postMessage handler**

Update the message listener useEffect (lines 85-98) to validate origin:

```tsx
useEffect(() => {
  const ALLOWED_ORIGINS = ['https://calendly.com', 'https://assets.calendly.com'];

  const listener = (event: MessageEvent) => {
    // Validate origin for security
    if (!ALLOWED_ORIGINS.includes(event.origin)) {
      return;
    }

    if (typeof event.data?.event !== 'string') {
      return;
    }

    if (event.data.event === 'calendly.event_scheduled') {
      onScheduled?.();
    }
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}, [onScheduled]);
```

**Step 2: Run tests to verify no regressions**

Run: `npx vitest run`
Expected: All tests PASS

---

## Task 5: Write accessibility tests for widget-overlay

**Files:**
- Create: `tests/widget/widget-overlay-a11y.test.tsx`

**Step 1: Create the test file with accessibility tests**

```tsx
// @vitest-environment jsdom
import { describe, expect, test, vi, beforeAll, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WidgetOverlay } from '@/components/widget/widget-overlay';

const originalFetch = global.fetch;

beforeAll(() => {
  if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
      // no-op for jsdom
    };
  }
});

afterEach(() => {
  global.fetch = originalFetch;
});

function mockFetchSession() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/sessions')) {
      return new Response(
        JSON.stringify({ sessionId: 'mock-session', persisted: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/api/events')) {
      return new Response('{}', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
}

describe('WidgetOverlay accessibility (Task 11)', () => {
  test('widget container has role="dialog" and aria-label="Balance Assist"', () => {
    global.fetch = mockFetchSession();
    render(<WidgetOverlay autoOpen={true} />);

    const dialog = screen.getByRole('dialog', { name: /Balance Assist/i });
    expect(dialog).toBeInTheDocument();
  });

  test('widget container is focusable with tabIndex=-1', () => {
    global.fetch = mockFetchSession();
    render(<WidgetOverlay autoOpen={true} />);

    const dialog = screen.getByRole('dialog', { name: /Balance Assist/i });
    expect(dialog.getAttribute('tabindex')).toBe('-1');
  });

  test('Escape key closes the widget', async () => {
    global.fetch = mockFetchSession();
    render(<WidgetOverlay autoOpen={true} />);

    // Wait for widget to be open
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Balance Assist/i })).toBeInTheDocument();
    });

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' });

    // Widget should be closed - dialog should not be in document
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Balance Assist/i })).not.toBeInTheDocument();
    });
  });

  test('open button has accessible name "Open Balance Assist"', () => {
    global.fetch = mockFetchSession();
    render(<WidgetOverlay autoOpen={false} />);

    const openButton = screen.getByRole('button', { name: /Open Balance Assist/i });
    expect(openButton).toBeInTheDocument();
  });

  test('close button has accessible name "Close Balance Assist"', async () => {
    global.fetch = mockFetchSession();
    render(<WidgetOverlay autoOpen={true} />);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Balance Assist/i })).toBeInTheDocument();
    });

    const closeButton = screen.getByRole('button', { name: /Close Balance Assist/i });
    expect(closeButton).toBeInTheDocument();
  });

  test('send button has accessible name "Send message"', async () => {
    global.fetch = mockFetchSession();
    render(<WidgetOverlay autoOpen={true} />);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Balance Assist/i })).toBeInTheDocument();
    });

    const sendButton = screen.getByRole('button', { name: /Send message/i });
    expect(sendButton).toBeInTheDocument();
  });

  test('attach button has accessible name "Attach references"', async () => {
    global.fetch = mockFetchSession();
    render(<WidgetOverlay autoOpen={true} />);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Balance Assist/i })).toBeInTheDocument();
    });

    const attachButton = screen.getByRole('button', { name: /Attach references/i });
    expect(attachButton).toBeInTheDocument();
  });

  test('input field has appropriate placeholder text', async () => {
    global.fetch = mockFetchSession();
    render(<WidgetOverlay autoOpen={true} />);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Balance Assist/i })).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Type your message|Message the team/i);
    expect(input).toBeInTheDocument();
    expect(input.getAttribute('type')).toBe('text');
  });
});

describe('WidgetOverlay mobile responsive (Task 11)', () => {
  test('mobile tab bar renders when window width is below 640px', async () => {
    global.fetch = mockFetchSession();

    // Mock window.innerWidth to be mobile
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 500
    });

    render(<WidgetOverlay autoOpen={true} />);

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Balance Assist/i })).toBeInTheDocument();
    });

    // Trigger resize event
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      const tablist = screen.getByRole('tablist', { name: /Widget views/i });
      expect(tablist).toBeInTheDocument();
    });

    // Chat tab should be present
    const chatTab = screen.getByRole('tab', { name: /Chat/i });
    expect(chatTab).toBeInTheDocument();
    expect(chatTab.getAttribute('aria-selected')).toBe('true');

    // Reset
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024
    });
    fireEvent(window, new Event('resize'));
  });

  test('brief tab appears when project intent is detected on mobile', async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/chat') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            message: 'Got it.',
            draftUpdates: {
              service: 'production',
              projectType: 'Video',
              projectScope: '30s animation',
              scopePolished: '30s animation'
            },
            briefReady: false
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/sessions')) {
        return new Response(
          JSON.stringify({ sessionId: 'mock-session', persisted: true }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/api/events')) {
        return new Response('{}', { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    // Mock mobile viewport
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 500
    });

    render(<WidgetOverlay autoOpen={true} />);

    const input = (await waitFor(() => {
      const el = screen.getByPlaceholderText(/Type your message|Message the team/i) as HTMLInputElement;
      expect(el).toBeInTheDocument();
      return el;
    }, { timeout: 4000 })) as HTMLInputElement;

    fireEvent(window, new Event('resize'));

    // Send a message that triggers project intent
    fireEvent.change(input, { target: { value: 'I want a 30s animation' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Wait for the brief tab to appear
    await waitFor(() => {
      const briefTab = screen.queryByRole('tab', { name: /Brief/i });
      expect(briefTab).not.toBeNull();
    }, { timeout: 4000 });

    // Reset
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024
    });
    fireEvent(window, new Event('resize'));
  });
});
```

**Step 2: Run the new tests**

Run: `npx vitest run tests/widget/widget-overlay-a11y.test.tsx`
Expected: All tests PASS

---

## Task 6: Verify all tests pass

**Step 1: Run the full widget test suite**

Run: `npx vitest run tests/widget/`
Expected: All tests PASS

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

---

## Summary

| Task | Files Modified | Files Created |
|------|---------------|---------------|
| 1. Mobile responsive layout | widget-overlay.tsx | - |
| 2. Focus management & Escape | widget-overlay.tsx | - |
| 3. ARIA labels & keyboard nav | review-panel.tsx | - |
| 4. Calendly origin validation | calendly-embed.tsx | - |
| 5. Accessibility tests | - | widget-overlay-a11y.test.tsx |
| 6. Verification | - | - |
