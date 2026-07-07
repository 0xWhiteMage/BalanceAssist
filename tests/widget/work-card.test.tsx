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
});