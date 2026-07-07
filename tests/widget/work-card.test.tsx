import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});