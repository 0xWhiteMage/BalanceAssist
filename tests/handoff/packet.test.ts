import { describe, expect, test } from 'vitest';
import { buildHandoffPacket, type PacketInput, type HandoffPacket } from '@/lib/handoff/packet';

function basePacketInput(overrides: Partial<PacketInput> = {}): PacketInput {
  return {
    sessionId: '11111111-2222-3333-4444-555555555555',
    caseId: 'CASE-0042',
    routingDestination: 'priority_review' as const,
    routingReasons: ['high_budget', 'urgent_timeline'],
    qualificationStatus: 'needs_review' as const,
    score: 7,
    draft: {
      service: 'production',
      projectScope: 'Promo video for product launch',
      timelineBand: 'asap',
      budgetBand: '150k-plus',
      contactName: 'Alex',
      contactEmail: 'alex@example.com',
      contactCompany: 'Acme Corp'
    },
    attachments: [
      { originalName: 'deck.pdf', status: 'quarantined', mimeType: 'application/pdf' }
    ],
    links: [
      { url: 'https://example.com/reference', kind: 'portfolio' }
    ],
    consentScope: { aiAnalysis: true, producerShare: true },
    ...overrides
  };
}

describe('buildHandoffPacket', () => {
  test('includes caseId and routing metadata', () => {
    const packet = buildHandoffPacket(basePacketInput());
    expect(packet.caseId).toBe('CASE-0042');
    expect(packet.routing.destination).toBe('priority_review');
    expect(packet.routing.reasons).toContain('high_budget');
  });

  test('includes confirmed facts from draft', () => {
    const packet = buildHandoffPacket(basePacketInput());
    expect(packet.confirmedFacts).toContain('production');
    expect(packet.confirmedFacts).toContain('Promo video for product launch');
    expect(packet.confirmedFacts).toContain('asap');
    expect(packet.confirmedFacts).toContain('150k-plus');
    expect(packet.confirmedFacts).toContain('Alex');
  });

  test('lists unknowns for missing fields', () => {
    const packet = buildHandoffPacket(basePacketInput({
      draft: { projectScope: '', timelineBand: '', budgetBand: '', contactName: '', contactEmail: '' }
    }));
    expect(packet.unknowns.length).toBeGreaterThan(0);
  });

  test('reports attachment status', () => {
    const packet = buildHandoffPacket(basePacketInput());
    expect(packet.attachments).toHaveLength(1);
    expect(packet.attachments[0].status).toBe('quarantined');
  });

  test('reports consent scope', () => {
    const packet = buildHandoffPacket(basePacketInput());
    expect(packet.consentScope.aiAnalysis).toBe(true);
    expect(packet.consentScope.producerShare).toBe(true);
  });

  test('includes reference links', () => {
    const packet = buildHandoffPacket(basePacketInput());
    expect(packet.links).toHaveLength(1);
    expect(packet.links[0].url).toBe('https://example.com/reference');
  });

  test('generates a plain-text summary for Telegram', () => {
    const packet = buildHandoffPacket(basePacketInput());
    expect(packet.summaryText).toContain('CASE-0042');
    expect(packet.summaryText).toContain('priority_review');
    expect(packet.summaryText).toContain('high_budget');
  });

  test('omits contact email from summary when not provided', () => {
    const packet = buildHandoffPacket(basePacketInput({
      draft: { projectScope: 'Video', timelineBand: '1-2-months', budgetBand: '20k-50k', contactName: 'Alex', contactEmail: '' }
    }));
    expect(packet.summaryText).not.toContain('alex@');
  });

  test('summary includes all routing reasons', () => {
    const packet = buildHandoffPacket(basePacketInput({
      routingReasons: ['high_budget', 'urgent_timeline', 'ambiguous_intent']
    }));
    expect(packet.summaryText).toContain('high_budget');
    expect(packet.summaryText).toContain('urgent_timeline');
    expect(packet.summaryText).toContain('ambiguous_intent');
  });

  test('packet conforms to HandoffPacket shape', () => {
    const packet = buildHandoffPacket(basePacketInput());
    expect(typeof packet.caseId).toBe('string');
    expect(typeof packet.sessionId).toBe('string');
    expect(typeof packet.routing).toBe('object');
    expect(typeof packet.confirmedFacts).toBe('string');
    expect(Array.isArray(packet.unknowns)).toBe(true);
    expect(Array.isArray(packet.attachments)).toBe(true);
    expect(Array.isArray(packet.links)).toBe(true);
    expect(typeof packet.consentScope).toBe('object');
    expect(typeof packet.summaryText).toBe('string');
  });
});
