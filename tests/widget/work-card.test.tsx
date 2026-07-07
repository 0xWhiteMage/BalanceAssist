import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  test('renders cards with a min-width of 280px for a more grabbable feel', () => {
    render(<WorkCard entry={baseEntry} category="reference" />);
    const card = screen.getByTestId('work-card');
    expect(card.style.minWidth).toBe('280px');
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

  test('thumbnail uses a 160px image real estate', () => {
    render(<WorkCard entry={baseEntry} category="reference" />);
    const img = screen.getByTestId('work-card-image');
    expect(img.style.height).toBe('160px');
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
    expect(row.style.scrollSnapType).toBe('x mandatory');
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
});