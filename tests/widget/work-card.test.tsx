import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkCard, WorkCardRow } from '@/components/chat/work-card';

const baseEntry = {
  title: 'MILO — Energy and the Spirit to Success',
  slug: 'milo',
  url: 'https://www.balancestudio.tv/milo',
  clients: 'Nestlé MILO',
  description: 'Creative post-production support for MILO Vietnam.',
  image_url: 'https://images.example.com/milo.jpg',
  year: null as number | null
};

describe('WorkCard', () => {
  test('renders the project title', () => {
    render(<WorkCard entry={baseEntry} category="reference" />);
    expect(screen.getByTestId('work-card-title').textContent).toContain('MILO');
  });

  test('renders the project URL as an anchor href and opens in a new tab', () => {
    render(<WorkCard entry={baseEntry} category="reference" />);
    const link = screen.getByTestId('work-card');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://www.balancestudio.tv/milo');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
  });

  test('renders the thumbnail image URL when provided', () => {
    render(<WorkCard entry={baseEntry} category="pitch" />);
    const img = screen.getByTestId('work-card-image');
    expect(img.getAttribute('src')).toBe('https://images.example.com/milo.jpg');
    expect(img.getAttribute('alt')).toBe('MILO — Energy and the Spirit to Success');
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  test('renders the category badge', () => {
    render(<WorkCard entry={baseEntry} category="pitch" />);
    expect(screen.getByText('PITCH')).toBeInTheDocument();
  });

  test('exposes the slug via a data attribute', () => {
    render(<WorkCard entry={baseEntry} category="reference" />);
    expect(screen.getByTestId('work-card').getAttribute('data-slug')).toBe('milo');
  });
});

describe('WorkCard sizing and grab affordance', () => {
  test('renders cards with a min-width of 240px for a more grabbable feel', () => {
    render(<WorkCard entry={baseEntry} category="reference" />);
    const card = screen.getByTestId('work-card');
    expect(card.style.minWidth).toBe('240px');
  });

  test('renders the card with cursor: grab so users know it can be swiped', () => {
    render(<WorkCard entry={baseEntry} category="reference" />);
    expect(screen.getByTestId('work-card').style.cursor).toBe('grab');
  });

  test('the whole card is clickable (display: flex + min-height: 220px)', () => {
    render(<WorkCard entry={baseEntry} category="reference" />);
    const card = screen.getByTestId('work-card');
    expect(card.style.display).toBe('flex');
    expect(card.style.minHeight).toBe('220px');
  });

  test('cards do not get text-selected while swiping', () => {
    render(<WorkCard entry={baseEntry} category="reference" />);
    expect(screen.getByTestId('work-card').style.userSelect).toBe('none');
  });

  test('thumbnail uses a 130px image real estate', () => {
    render(<WorkCard entry={baseEntry} category="reference" />);
    const img = screen.getByTestId('work-card-image');
    expect(img.style.height).toBe('130px');
  });
});

describe('WorkCardRow', () => {
  test('renders nothing when entries array is empty', () => {
    const { container } = render(<WorkCardRow entries={[]} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders one card per entry', () => {
    render(
      <WorkCardRow
        entries={[
          { entry: baseEntry, category: 'reference' },
          {
            entry: { ...baseEntry, slug: 'razer', title: 'Razer', url: 'https://www.balancestudio.tv/razer' },
            category: 'pitch'
          }
        ]}
      />
    );
    expect(screen.getAllByTestId('work-card')).toHaveLength(2);
  });

  test('uses horizontal scroll-snap on the row so cards snap to the start', () => {
    render(
      <WorkCardRow
        entries={[
          { entry: baseEntry, category: 'reference' },
          {
            entry: { ...baseEntry, slug: 'razer', title: 'Razer', url: 'https://www.balancestudio.tv/razer' },
            category: 'pitch'
          }
        ]}
      />
    );
    const row = screen.getByTestId('work-card-row');
    expect(row.style.scrollSnapType).not.toBe('x mandatory');
    expect(row.style.scrollSnapType === '' || row.style.scrollSnapType === 'x proximity').toBe(true);
    const cards = screen.getAllByTestId('work-card');
    for (const card of cards) {
      expect(card.style.scrollSnapAlign).toBe('start');
    }
  });

  test('row has a 14px gap and 12px vertical padding for touch comfort', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    const row = screen.getByTestId('work-card-row');
    expect(row.style.gap).toBe('14px');
    expect(row.style.padding).toBe('12px 0px');
  });

  test('row has a right-edge fade to signal there are more cards', () => {
    const { container } = render(
      <WorkCardRow
        entries={[
          { entry: baseEntry, category: 'reference' },
          {
            entry: { ...baseEntry, slug: 'razer', title: 'Razer', url: 'https://www.balancestudio.tv/razer' },
            category: 'pitch'
          }
        ]}
      />
    );
    const fade = container.querySelector('[data-testid="work-card-row-fade"]');
    expect(fade).not.toBeNull();
    expect((fade as HTMLElement).style.pointerEvents).toBe('none');
    expect((fade as HTMLElement).style.position).toBe('absolute');
    expect((fade as HTMLElement).style.right).toBe('0px');
    expect((fade as HTMLElement).style.width).toBe('28px');
  });

  test('row starts with cursor: grab so users know it can be dragged', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    const row = screen.getByTestId('work-card-row');
    expect(row.style.cursor).toBe('grab');
    expect(row.getAttribute('data-dragging')).toBe('false');
  });

  test('row has touch-action: pan-x so mobile devices use horizontal panning instead of pinch-zoom', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    const row = screen.getByTestId('work-card-row');
    expect(row.style.touchAction).toBe('pan-x');
  });

  test('row has a minHeight of 220px so it has enough draggable area', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    const row = screen.getByTestId('work-card-row');
    expect(row.style.minHeight).toBe('220px');
  });

  test('row renders no dot indicators when content fits on one page', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    expect(screen.queryByTestId('work-card-row-dots')).toBeNull();
    expect(screen.queryAllByTestId('work-card-row-dot')).toHaveLength(0);
  });

  test('row uses align-items: stretch so cards line up vertically when their heights differ', () => {
    render(
      <WorkCardRow
        entries={[
          { entry: baseEntry, category: 'reference' },
          { entry: { ...baseEntry, slug: 'razer', title: 'Razer', url: 'https://www.balancestudio.tv/razer' }, category: 'pitch' }
        ]}
      />
    );
    const row = screen.getByTestId('work-card-row') as HTMLDivElement;
    expect(row.style.alignItems).toBe('stretch');
  });

  test('row has overscroll-behavior-x: contain to avoid bouncing the page on horizontal drag', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    const row = screen.getByTestId('work-card-row') as HTMLDivElement;
    expect(row.style.overscrollBehaviorX).toBe('contain');
  });

  test('each card has align-self: stretch so they fill the row height', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    const card = screen.getByTestId('work-card') as HTMLAnchorElement;
    expect(card.style.alignSelf).toBe('stretch');
  });

  test('each card disables text selection so a drag never highlights text', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    const card = screen.getByTestId('work-card') as HTMLAnchorElement;
    expect(card.style.userSelect).toBe('none');
  });
});

describe('WorkCardRow drag-to-scroll', () => {
  test('mousedown + mousemove updates the row scrollLeft in the dragging direction', () => {
    render(
      <WorkCardRow
        entries={[
          { entry: baseEntry, category: 'reference' },
          { entry: { ...baseEntry, slug: 'razer', title: 'Razer', url: 'https://www.balancestudio.tv/razer' }, category: 'pitch' }
        ]}
      />
    );
    const row = screen.getByTestId('work-card-row') as HTMLDivElement;
    Object.defineProperty(row, 'scrollLeft', { value: 0, writable: true, configurable: true });

    fireEvent.mouseDown(row, { clientX: 200, button: 0 });
    fireEvent.mouseMove(document, { clientX: 80 }); // user dragged left by 120px
    fireEvent.mouseUp(document);

    // Drag left → scrollLeft = startScrollLeft(0) - delta(80-200=-120) = +120
    expect(Number((row as unknown as { scrollLeft: number }).scrollLeft)).toBeGreaterThan(0);
  });

  test('mousedown on a card with no movement lets the link click fire (no preventDefault)', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    const card = screen.getByTestId('work-card');

    fireEvent.mouseDown(card, { clientX: 100, button: 0 });
    fireEvent.mouseUp(document);

    // Listen at the window level (bubble phase) — React's onClick handler delegates
    // from the root, so the row's preventDefault() runs BEFORE this listener only if
    // the listener is attached as a bubble-phase listener on an ancestor of the row.
    let defaultPrevented = false;
    const handler = (event: MouseEvent) => {
      defaultPrevented = event.defaultPrevented;
    };
    window.addEventListener('click', handler);
    fireEvent.click(card);
    window.removeEventListener('click', handler);
    expect(defaultPrevented).toBe(false);
  });

  test('mousedown + 50px movement before mouseup prevents the subsequent click', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    const card = screen.getByTestId('work-card');

    fireEvent.mouseDown(card, { clientX: 100, button: 0 });
    fireEvent.mouseMove(document, { clientX: 50 }); // 50px drag
    fireEvent.mouseUp(document);

    // Spy on Event.prototype.preventDefault: if the row's onClick handler fires
    // and calls preventDefault (the drag-vs-click branch), the spy gets called.
    const preventDefaultSpy = vi.spyOn(MouseEvent.prototype, 'preventDefault');
    fireEvent.click(card);
    expect(preventDefaultSpy).toHaveBeenCalled();
    preventDefaultSpy.mockRestore();
  });

  test('row flips cursor to grabbing and data-dragging=true while dragging', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    const row = screen.getByTestId('work-card-row');

    fireEvent.mouseDown(row, { clientX: 100, button: 0 });
    expect(row.getAttribute('data-dragging')).toBe('true');
    expect((row as HTMLElement).style.cursor).toBe('grabbing');

    fireEvent.mouseUp(document);
    expect(row.getAttribute('data-dragging')).toBe('false');
    expect((row as HTMLElement).style.cursor).toBe('grab');
  });

  test('mousedown on a row calls preventDefault so the underlying card link is not activated', () => {
    render(
      <WorkCardRow
        entries={[{ entry: baseEntry, category: 'reference' }]}
      />
    );
    const row = screen.getByTestId('work-card-row');

    const preventDefaultSpy = vi.spyOn(MouseEvent.prototype, 'preventDefault');
    fireEvent.mouseDown(row, { clientX: 100, button: 0 });
    expect(preventDefaultSpy).toHaveBeenCalled();
    preventDefaultSpy.mockRestore();
  });

  test('after a drag ends, scrollLeft is snapped to a multiple of clientWidth with instant (auto) behavior', () => {
    render(
      <WorkCardRow
        entries={[
          { entry: baseEntry, category: 'reference' },
          { entry: { ...baseEntry, slug: 'razer', title: 'Razer', url: 'https://www.balancestudio.tv/razer' }, category: 'pitch' },
          { entry: { ...baseEntry, slug: 'f1', title: 'F1', url: 'https://www.balancestudio.tv/f1' }, category: 'pitch' }
        ]}
      />
    );
    const row = screen.getByTestId('work-card-row') as HTMLDivElement;
    const clientWidth = 300;
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => clientWidth });
    Object.defineProperty(row, 'scrollWidth', { configurable: true, get: () => clientWidth * 3 });
    let scrollLeft = 137;
    Object.defineProperty(row, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      }
    });
    const scrollToSpy = vi.fn(function scrollTo(this: HTMLDivElement, opts: { left: number; behavior?: ScrollBehavior }) {
      this.scrollLeft = opts.left;
    });
    Object.defineProperty(row, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollToSpy
    });

    fireEvent.mouseDown(row, { clientX: 200, button: 0 });
    fireEvent.mouseMove(document, { clientX: 80 });
    fireEvent.mouseUp(document);

    expect(scrollToSpy).toHaveBeenCalled();
    const callArgs = scrollToSpy.mock.calls[0]?.[0] as { left: number; behavior?: string } | undefined;
    expect(callArgs).toBeDefined();
    expect(callArgs!.left % clientWidth).toBe(0);
    expect(callArgs!.behavior).toBe('auto');
    expect(callArgs!.behavior).not.toBe('smooth');
  });

  test('row does NOT render any dot indicators (replaced with swipe hint)', () => {
    render(
      <WorkCardRow
        entries={[
          { entry: baseEntry, category: 'reference' },
          { entry: { ...baseEntry, slug: 'razer', title: 'Razer', url: 'https://www.balancestudio.tv/razer' }, category: 'pitch' },
          { entry: { ...baseEntry, slug: 'f1', title: 'F1', url: 'https://www.balancestudio.tv/f1' }, category: 'pitch' }
        ]}
      />
    );
    // Force the overflow computation to run with non-zero dimensions so the
    // swipe hint would actually render. Even then, no dots should appear.
    const row = screen.getByTestId('work-card-row') as HTMLDivElement;
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(row, 'scrollWidth', { configurable: true, get: () => 1800 });
    fireEvent.scroll(row);

    expect(screen.queryByTestId('work-card-row-dots')).toBeNull();
    expect(screen.queryAllByTestId('work-card-row-dot')).toHaveLength(0);
  });

  test('row renders a swipe-hint element when content overflows and the user has not scrolled yet', async () => {
    const { container } = render(
      <WorkCardRow
        entries={[
          { entry: baseEntry, category: 'reference' },
          { entry: { ...baseEntry, slug: 'razer', title: 'Razer', url: 'https://www.balancestudio.tv/razer' }, category: 'pitch' },
          { entry: { ...baseEntry, slug: 'f1', title: 'F1', url: 'https://www.balancestudio.tv/f1' }, category: 'pitch' }
        ]}
      />
    );
    // jsdom defaults clientWidth to 0; the row's resize observer fires on
    // mount, so we have to mutate the underlying element to make the row
    // "overflow" before we look for the swipe hint.
    const row = container.querySelector('[data-testid="work-card-row"]') as HTMLDivElement;
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(row, 'scrollWidth', { configurable: true, get: () => 1800 });
    let scrollLeft = 0;
    Object.defineProperty(row, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      }
    });
    fireEvent.scroll(row);
    await waitFor(() => {
      expect(screen.getByTestId('work-card-row-swipe-hint')).toBeInTheDocument();
    });
  });

  test('swipe-hint fades out (is removed) once the user has scrolled', async () => {
    const { container } = render(
      <WorkCardRow
        entries={[
          { entry: baseEntry, category: 'reference' },
          { entry: { ...baseEntry, slug: 'razer', title: 'Razer', url: 'https://www.balancestudio.tv/razer' }, category: 'pitch' },
          { entry: { ...baseEntry, slug: 'f1', title: 'F1', url: 'https://www.balancestudio.tv/f1' }, category: 'pitch' }
        ]}
      />
    );
    const row = container.querySelector('[data-testid="work-card-row"]') as HTMLDivElement;
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => 600 });
    Object.defineProperty(row, 'scrollWidth', { configurable: true, get: () => 1800 });
    let scrollLeft = 0;
    Object.defineProperty(row, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      }
    });
    fireEvent.scroll(row);
    await waitFor(() => {
      expect(screen.getByTestId('work-card-row-swipe-hint')).toBeInTheDocument();
    });

    // Simulate the user scrolling — the swipe hint should disappear.
    scrollLeft = 50;
    fireEvent.scroll(row);
    await waitFor(() => {
      expect(screen.queryByTestId('work-card-row-swipe-hint')).toBeNull();
    });
  });
});

describe('WorkCardRow magnetic snap is instant (no smooth scroll, no mandatory snap)', () => {
  test('row uses scroll-snap-type: x proximity (NOT mandatory) so drag-only motion stays predictable', () => {
    const { container } = render(
      <WorkCardRow
        entries={[
          { entry: baseEntry, category: 'reference' },
          { entry: { ...baseEntry, slug: 'razer', title: 'Razer', url: 'https://www.balancestudio.tv/razer' }, category: 'pitch' }
        ]}
      />
    );
    const row = container.querySelector('[data-testid="work-card-row"]') as HTMLDivElement;
    expect(row.style.scrollSnapType).not.toBe('x mandatory');
    expect(['x proximity', ''].includes(row.style.scrollSnapType)).toBe(true);
  });

  test('drag + release triggers scrollTo with behavior: "auto" (instant magnetic snap, no smooth scroll)', () => {
    const { container } = render(
      <WorkCardRow
        entries={[
          { entry: baseEntry, category: 'reference' },
          { entry: { ...baseEntry, slug: 'razer', title: 'Razer', url: 'https://www.balancestudio.tv/razer' }, category: 'pitch' },
          { entry: { ...baseEntry, slug: 'f1', title: 'F1', url: 'https://www.balancestudio.tv/f1' }, category: 'pitch' }
        ]}
      />
    );
    const row = container.querySelector('[data-testid="work-card-row"]') as HTMLDivElement;
    const clientWidth = 320;
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => clientWidth });
    Object.defineProperty(row, 'scrollWidth', { configurable: true, get: () => clientWidth * 3 });
    let scrollLeft = 175;
    Object.defineProperty(row, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      }
    });
    const scrollToSpy = vi.fn(function scrollTo(this: HTMLDivElement, opts: { left: number; behavior?: string }) {
      this.scrollLeft = opts.left;
    });
    Object.defineProperty(row, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollToSpy
    });

    fireEvent.mouseDown(row, { clientX: 220, button: 0 });
    fireEvent.mouseMove(document, { clientX: 90 });
    fireEvent.mouseUp(document);

    expect(scrollToSpy).toHaveBeenCalled();
    const callArgs = scrollToSpy.mock.calls[0]?.[0] as { left: number; behavior?: string } | undefined;
    expect(callArgs).toBeDefined();
    expect(callArgs!.behavior).toBe('auto');
    expect(callArgs!.behavior).not.toBe('smooth');
    expect(callArgs!.left).toBe(Math.round(scrollLeft / clientWidth) * clientWidth);
  });
});

describe('WorkCardRow prev/next arrow buttons', () => {
  function setupOverflowRow(numCards: number) {
    const entries = Array.from({ length: numCards }, (_, i) => ({
      entry: { ...baseEntry, slug: `card-${i}`, title: `Card ${i}`, url: `https://www.balancestudio.tv/card-${i}` },
      category: 'reference' as const
    }));
    const result = render(<WorkCardRow entries={entries} />);
    const row = result.container.querySelector('[data-testid="work-card-row"]') as HTMLDivElement;
    const clientWidth = 320;
    Object.defineProperty(row, 'clientWidth', { configurable: true, get: () => clientWidth });
    Object.defineProperty(row, 'scrollWidth', { configurable: true, get: () => clientWidth * 3 });
    let scrollLeft = 0;
    Object.defineProperty(row, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (v: number) => {
        scrollLeft = v;
      }
    });
    fireEvent.scroll(row);
    return { row };
  }

  test('renders prev and next buttons inside an overflowing row', async () => {
    setupOverflowRow(4);
    await waitFor(() => {
      expect(screen.queryByTestId('work-card-row-prev')).not.toBeNull();
      expect(screen.queryByTestId('work-card-row-next')).not.toBeNull();
    });
  });

  test('does NOT render arrow buttons when the row does not overflow (single page)', async () => {
    render(<WorkCardRow entries={[{ entry: baseEntry, category: 'reference' }]} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('work-card-row-prev')).toBeNull();
    expect(screen.queryByTestId('work-card-row-next')).toBeNull();
  });

  test('clicking "next" calls scrollBy with the row clientWidth (positive direction)', async () => {
    const { row } = setupOverflowRow(4);
    const scrollBySpy = vi.fn(function scrollBy(this: HTMLDivElement, opts: ScrollToOptions) {
      (this as unknown as { scrollLeft: number }).scrollLeft += opts.left ?? 0;
    });
    Object.defineProperty(row, 'scrollBy', {
      configurable: true,
      writable: true,
      value: scrollBySpy
    });
    let nextButton: HTMLElement | null = null;
    await waitFor(() => {
      nextButton = screen.getByTestId('work-card-row-next');
    });
    fireEvent.mouseEnter(row);
    fireEvent.click(nextButton!);
    expect(scrollBySpy).toHaveBeenCalled();
    const opts = scrollBySpy.mock.calls[0]?.[0] as ScrollToOptions | undefined;
    expect(opts).toBeDefined();
    expect(opts!.behavior).toBe('auto');
    expect(opts!.left).toBe(320);
  });

  test('clicking "prev" calls scrollBy with the row clientWidth (negative direction)', async () => {
    const { row } = setupOverflowRow(4);
    const scrollBySpy = vi.fn(function scrollBy(this: HTMLDivElement, opts: ScrollToOptions) {
      (this as unknown as { scrollLeft: number }).scrollLeft += opts.left ?? 0;
    });
    Object.defineProperty(row, 'scrollBy', {
      configurable: true,
      writable: true,
      value: scrollBySpy
    });
    let prevButton: HTMLElement | null = null;
    let nextButton: HTMLElement | null = null;
    await waitFor(() => {
      prevButton = screen.getByTestId('work-card-row-prev');
      nextButton = screen.getByTestId('work-card-row-next');
    });
    fireEvent.mouseEnter(row);
    fireEvent.click(nextButton!);

    // First click moves forward (activePage=0 → activePage=1, but the row scroll didn't change
    // because scrollBy is a stub that updates scrollLeft by 320 anyway).
    // Force scrollLeft to 320 so the prev button is enabled.
    fireEvent.scroll(row);
    fireEvent.click(prevButton!);
    expect(scrollBySpy).toHaveBeenCalledTimes(2);
    const prevOpts = scrollBySpy.mock.calls[1]?.[0] as ScrollToOptions | undefined;
    expect(prevOpts).toBeDefined();
    expect(prevOpts!.behavior).toBe('auto');
    expect(prevOpts!.left).toBe(-320);
  });

  test('at scroll position 0, the "prev" button has data-disabled="true" and is not clickable', async () => {
    setupOverflowRow(4);
    let prevButton: HTMLElement | null = null;
    await waitFor(() => {
      prevButton = screen.getByTestId('work-card-row-prev');
    });
    const btn = prevButton as HTMLButtonElement;
    expect(btn.getAttribute('data-disabled')).toBe('true');
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  test('at the last page, the "next" button has data-disabled="true"', async () => {
    const { row } = setupOverflowRow(4);
    let nextButton: HTMLElement | null = null;
    await waitFor(() => {
      nextButton = screen.getByTestId('work-card-row-next');
    });
    const realNext = nextButton as HTMLButtonElement;
    Object.defineProperty(row, 'scrollLeft', { configurable: true, get: () => 640, set: () => undefined });
    fireEvent.scroll(row);
    await waitFor(() => {
      expect(realNext.getAttribute('data-disabled')).toBe('true');
    });
    expect(realNext.hasAttribute('disabled')).toBe(true);
  });

  test('arrow buttons are visually hidden (opacity: 0) until the row is hovered', async () => {
    setupOverflowRow(4);
    let prevButton: HTMLElement | null = null;
    let nextButton: HTMLElement | null = null;
    await waitFor(() => {
      prevButton = screen.getByTestId('work-card-row-prev');
      nextButton = screen.getByTestId('work-card-row-next');
    });
    const prev = prevButton as HTMLButtonElement;
    const next = nextButton as HTMLButtonElement;
    // Initially the row is not hovered, so opacity is 0 even when the button is scrollable.
    expect(prev.style.opacity).toBe('0');
    expect(next.style.opacity).toBe('0');

    fireEvent.mouseEnter(screen.getByTestId('work-card-row'));
    // After hover, the next button (scrollable forward) becomes visible.
    await waitFor(() => {
      expect(next.style.opacity).toBe('1');
    });

    fireEvent.mouseLeave(screen.getByTestId('work-card-row'));
    await waitFor(() => {
      expect(next.style.opacity).toBe('0');
    });
  });

  test('clicking next does not start a row drag (prevents underlying card link)', async () => {
    const { row } = setupOverflowRow(4);
    // jsdom does not implement scrollBy/scrollTo on HTMLElement; stub them so
    // the click handler does not throw before we can assert the click guards.
    if (typeof row.scrollBy !== 'function') {
      Object.defineProperty(row, 'scrollBy', { configurable: true, writable: true, value: vi.fn() });
    }
    if (typeof row.scrollTo !== 'function') {
      Object.defineProperty(row, 'scrollTo', { configurable: true, writable: true, value: vi.fn() });
    }
    let nextButton: HTMLElement | null = null;
    await waitFor(() => {
      nextButton = screen.getByTestId('work-card-row-next');
    });
    const preventDefaultSpy = vi.spyOn(MouseEvent.prototype, 'preventDefault');
    const stopPropagationSpy = vi.spyOn(MouseEvent.prototype, 'stopPropagation');
    fireEvent.mouseEnter(row);
    fireEvent.click(nextButton!);
    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
    preventDefaultSpy.mockRestore();
    stopPropagationSpy.mockRestore();
  });
});