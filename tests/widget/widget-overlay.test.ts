import { describe, expect, test } from 'vitest';
import {
  getWidgetWidth,
  WIDGET_WIDTH_CHAT_ONLY,
  WIDGET_WIDTH_WITH_RAIL
} from '@/components/widget/widget-overlay';

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