import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('WidgetOverlay transfer copy', () => {
  test('does not promise team review without durable review evidence', () => {
    const source = readFileSync('components/widget/widget-overlay.tsx', 'utf8');

    expect(source).not.toMatch(/Our team will review them/i);
  });
});
