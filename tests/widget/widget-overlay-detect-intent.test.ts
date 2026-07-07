import { describe, expect, test } from 'vitest';
import { detectProjectIntent } from '@/lib/conversation/project-intent';
import { createDefaultLeadDraft } from '@/lib/onboarding/default-state';
import type { LeadDraft } from '@/lib/onboarding/types';

function withOverrides(overrides: Partial<LeadDraft>): LeadDraft {
  return { ...createDefaultLeadDraft(), ...overrides };
}

describe('detectProjectIntent', () => {
  test('returns false for a default empty draft', () => {
    expect(detectProjectIntent(createDefaultLeadDraft())).toBe(false);
  });

  test('returns false when only contactCompany is populated', () => {
    expect(detectProjectIntent(withOverrides({ contactCompany: 'Balance' }))).toBe(false);
  });

  test('returns false when only budgetBand is populated', () => {
    expect(detectProjectIntent(withOverrides({ budgetBand: '20k-50k' }))).toBe(false);
  });

  test('returns false when only timelineBand is populated', () => {
    expect(detectProjectIntent(withOverrides({ timelineBand: '1-2-months' }))).toBe(false);
  });

  test('returns false when only contactName is populated', () => {
    expect(detectProjectIntent(withOverrides({ contactName: 'Jayden' }))).toBe(false);
  });

  test('returns false when only contactEmail is populated', () => {
    expect(detectProjectIntent(withOverrides({ contactEmail: 'jayden@example.com' }))).toBe(false);
  });

  test('returns true when projectScope alone is populated', () => {
    expect(detectProjectIntent(withOverrides({ projectScope: '30s animation' }))).toBe(true);
  });

  test('returns true when service alone is populated', () => {
    expect(detectProjectIntent(withOverrides({ service: 'production' }))).toBe(true);
  });

  test('returns true when projectType alone is populated', () => {
    expect(detectProjectIntent(withOverrides({ projectType: 'Animation' }))).toBe(true);
  });

  test('returns true when scopePolished alone is populated', () => {
    expect(detectProjectIntent(withOverrides({ scopePolished: '30s brand animation' }))).toBe(true);
  });

  test('ignores whitespace-only strong fields', () => {
    expect(detectProjectIntent(withOverrides({ projectScope: '   ' }))).toBe(false);
    expect(detectProjectIntent(withOverrides({ projectType: '   ' }))).toBe(false);
    expect(detectProjectIntent(withOverrides({ scopePolished: '   ' }))).toBe(false);
  });

  test('returns true when any two strong signals are present', () => {
    expect(
      detectProjectIntent(
        withOverrides({ projectScope: '30s animation', service: 'production' })
      )
    ).toBe(true);
    expect(
      detectProjectIntent(
        withOverrides({ projectType: 'Animation', projectScope: '30s animation' })
      )
    ).toBe(true);
    expect(
      detectProjectIntent(
        withOverrides({ contactCompany: 'Balance', projectScope: '30s animation' })
      )
    ).toBe(true);
    expect(
      detectProjectIntent(
        withOverrides({ budgetBand: '20k-50k', service: 'production' })
      )
    ).toBe(true);
  });
});