import { describe, expect, test } from 'vitest';
import { routeLead, type RoutingInput, type RoutingResult } from '@/lib/handoff/routing';

function baseDraft(overrides: Partial<RoutingInput> = {}): RoutingInput {
  return {
    service: 'production',
    projectScope: 'Promo video',
    timelineBand: '1-2-months',
    budgetBand: '20k-50k',
    contactName: 'Alex',
    contactEmail: 'alex@example.com',
    qualificationStatus: 'qualified' as const,
    score: 8,
    ...overrides
  };
}

describe('routeLead', () => {
  test('returns priority_review for high-budget leads', () => {
    const result = routeLead(baseDraft({ budgetBand: '150k-plus' }));
    expect(result.destination).toBe('priority_review');
    expect(result.reasons).toContain('high_budget');
  });

  test('returns priority_review for urgent timelines', () => {
    const result = routeLead(baseDraft({ timelineBand: 'asap' }));
    expect(result.destination).toBe('priority_review');
    expect(result.reasons).toContain('urgent_timeline');
  });

  test('returns priority_review for frustrated users', () => {
    const result = routeLead(baseDraft({ service: 'not-sure-yet', projectScope: '' }));
    expect(result.destination).toBe('priority_review');
    expect(result.reasons).toContain('ambiguous_intent');
  });

  test('returns priority_review for unqualified leads (repeat failure / frustrated)', () => {
    const result = routeLead(baseDraft({ qualificationStatus: 'unqualified', score: 2 }));
    expect(result.destination).toBe('priority_review');
    expect(result.reasons).toContain('low_score_frustrated');
  });

  test('returns standard for qualified leads without escalation signals', () => {
    const result = routeLead(baseDraft());
    expect(result.destination).toBe('standard');
    expect(result.reasons).toHaveLength(0);
  });

  test('urgency never reduces score or fit', () => {
    const urgent = routeLead(baseDraft({ timelineBand: 'asap' }));
    const standard = routeLead(baseDraft({ timelineBand: '1-2-months' }));
    expect(urgent.destination).toBe('priority_review');
    expect(standard.destination).toBe('standard');
  });

  test('collects multiple routing reasons', () => {
    const result = routeLead(baseDraft({
      budgetBand: '150k-plus',
      timelineBand: 'asap',
      qualificationStatus: 'unqualified',
      score: 2
    }));
    expect(result.destination).toBe('priority_review');
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });

  test('returns standard for misfit with some substance', () => {
    const result = routeLead(baseDraft({ qualificationStatus: 'misfit', score: 4 }));
    expect(result.destination).toBe('standard');
  });

  test('generates a neutral case ID', () => {
    const result = routeLead(baseDraft(), 'session-abc-1234');
    expect(result.caseId).toMatch(/^CASE-\d{4}$/);
  });

  test('case ID is deterministic for same session', () => {
    const a = routeLead(baseDraft(), 'session-abc-1234');
    const b = routeLead(baseDraft(), 'session-abc-1234');
    expect(a.caseId).toBe(b.caseId);
  });

  test('different sessions get different case IDs', () => {
    const a = routeLead(baseDraft(), 'session-aaa-1111');
    const b = routeLead(baseDraft(), 'session-bbb-2222');
    expect(a.caseId).not.toBe(b.caseId);
  });
});
