import { describe, expect, test } from 'vitest';
import { listAllWorks, searchWorks } from '@/lib/conversation/works-search';

describe('searchWorks', () => {
  test('returns an empty array for an empty query', () => {
    expect(searchWorks('')).toEqual([]);
  });

  test('returns an empty array for a whitespace-only query', () => {
    expect(searchWorks('   ')).toEqual([]);
  });

  test('searches by client name (case-insensitive)', () => {
    const results = searchWorks('hsbc');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].clients.toLowerCase()).toContain('hsbc');
  });

  test('searches by service category', () => {
    const results = searchWorks('2d animation');
    expect(results.length).toBeGreaterThan(0);
    const firstHasCategory = results[0].service_categories.toLowerCase().includes('2d');
    expect(firstHasCategory).toBe(true);
  });

  test('returns results in descending score order', () => {
    const results = searchWorks('animation');
    expect(results.length).toBeGreaterThan(1);
    for (let i = 0; i < results.length - 1; i++) {
      const current = results[i];
      const next = results[i + 1];
      const currentText = [
        current.title,
        current.clients,
        current.service_categories,
        current.description
      ]
        .join(' ')
        .toLowerCase();
      const nextText = [next.title, next.clients, next.service_categories, next.description]
        .join(' ')
        .toLowerCase();
      expect(currentText.includes('animation')).toBe(true);
      expect(nextText.includes('animation')).toBe(true);
    }
  });

  test('caps results at the requested limit', () => {
    const results = searchWorks('video', 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  test('returns the default cap of 8 when no limit is passed', () => {
    const results = searchWorks('video');
    expect(results.length).toBeLessThanOrEqual(8);
  });

  test('ignores tokens shorter than three characters', () => {
    const onlyShortTokens = searchWorks('a b c');
    expect(onlyShortTokens).toEqual([]);
  });
});

describe('listAllWorks', () => {
  test('returns the full works array', () => {
    const all = listAllWorks();
    expect(all.length).toBeGreaterThan(50);
    expect(all[0]).toHaveProperty('slug');
    expect(all[0]).toHaveProperty('title');
    expect(all[0]).toHaveProperty('url');
  });
});