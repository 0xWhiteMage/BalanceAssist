import { describe, expect, test } from 'vitest';
import {
  formatMemoryInventory,
  getWidgetWidth,
  WIDGET_WIDTH_CHAT_ONLY,
  WIDGET_WIDTH_WITH_RAIL
} from '@/components/widget/widget-overlay';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';

describe('getWidgetWidth', () => {
  test('returns the chat-only width when team is connected', () => {
    expect(getWidgetWidth({ isTeamConnected: true, hasProjectIntent: true })).toBe(WIDGET_WIDTH_CHAT_ONLY);
    expect(getWidgetWidth({ isTeamConnected: true, hasProjectIntent: false })).toBe(WIDGET_WIDTH_CHAT_ONLY);
  });

  test('returns the chat-only width when no project intent is detected', () => {
    expect(getWidgetWidth({ isTeamConnected: false, hasProjectIntent: false })).toBe(WIDGET_WIDTH_CHAT_ONLY);
  });

  test('returns the wide width once project intent is detected and team is not connected', () => {
    expect(getWidgetWidth({ isTeamConnected: false, hasProjectIntent: true })).toBe(WIDGET_WIDTH_WITH_RAIL);
  });

  test('wide width is strictly larger than chat-only width', () => {
    const chatOnly = parseInt(WIDGET_WIDTH_CHAT_ONLY.match(/min\((\d+)px/)?.[1] ?? '0', 10);
    const withRail = parseInt(WIDGET_WIDTH_WITH_RAIL.match(/min\((\d+)px/)?.[1] ?? '0', 10);
    expect(withRail).toBeGreaterThan(chatOnly);
    expect(chatOnly).toBe(380);
    expect(withRail).toBe(820);
  });
});

describe('temporary project memory inventory', () => {
  test('renders only canonical saved facts and private-link count', () => {
    const draft = { ...createDefaultLeadDraft(), projectScope: 'A launch film', contactEmail: 'producer@example.com' };
    expect(formatMemoryInventory(draft, 2)).toContain('Editable brief saved for this temporary session:\n- Project: A launch film\n- Contact email: producer@example.com\n- Private reference links: 2');
    expect(formatMemoryInventory(draft, 2)).toMatch(/does not inventory uploads/i);
  });

  test('states when canonical memory is empty', () => {
    expect(formatMemoryInventory(createDefaultLeadDraft(), 0)).toMatch(/editable brief is empty/i);
  });
});
