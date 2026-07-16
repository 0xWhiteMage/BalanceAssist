import { describe, expect, test } from 'vitest';

import schema from '../../config/monday-crm-schema.json';
import {
  approvedCrmSnapshotSchema,
  buildMondayCreatePayload,
  buildMondayUpdatePayload,
} from '../../lib/monday/projection';

const approvedSnapshotFixture = {
  schemaVersion: 1,
  crmRecordId: '5e35b4cc-c025-4a35-a213-52800d34dc08',
  approvedRevision: 2,
  approvedDraftVersion: 4,
  approvedAt: '2026-07-15T12:00:00.000Z',
  producerTransferNoticeVersion: '2026-07-monday',
  producerTransferRecordedAt: '2026-07-15T11:59:00.000Z',
  contactName: 'Ada Example',
  contactEmail: 'ada@example.com',
  company: 'Example Co',
  service: 'post-production',
  projectType: 'Campaign finishing',
  projectScope: 'Finish a campaign.',
  timeline: 'September',
  budget: '20k-50k',
  qualificationStatus: 'qualified',
  score: 80,
  recommendedNextStep: 'schedule',
  referenceLinks: [
    { url: 'https://example.org/b?z=2&a=1', label: 'Second' },
    { url: 'https://example.com/a', label: null },
  ],
};

describe('approved CRM snapshot', () => {
  test('accepts nullable contact fields and current hyphenated enum values', () => {
    expect(approvedCrmSnapshotSchema.parse({
      ...approvedSnapshotFixture,
      contactName: null,
      contactEmail: null,
      service: 'event-experience-content',
      budget: '150k-plus',
    })).toMatchObject({ contactName: null, contactEmail: null });
  });

  test.each([
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/path#fragment',
    'https://localhost/path',
    'https://printer.local/path',
    'https://service.internal/path',
    'https://service.internal./path',
    'https://service.test/path',
    'https://127.0.0.1/path',
    'https://10.0.0.1/path',
    'https://172.16.0.1/path',
    'https://192.168.0.1/path',
    'https://192.0.2.1/path',
    'https://198.51.100.1/path',
    'https://203.0.113.1/path',
    'https://169.254.1.1/path',
    'https://100.64.0.1/path',
    'https://[fc00::1]/path',
    'https://[fe80::1]/path',
    'https://[2001:db8::1]/path',
    'https://[::1]/path',
    'https://[::ffff:7f00:1]/path',
    'https://[::7f00:1]/path',
    'https://[::ffff:c0a8:1]/path',
    'https://[::c0a8:1]/path',
    'https://example.com/file?signature=secret',
    'https://example.com/file?token=secret',
    'https://example.com/file?X-Amz-Signature=secret',
  ])('rejects non-public reference URL %s', (url) => {
    expect(approvedCrmSnapshotSchema.safeParse({
      ...approvedSnapshotFixture,
      referenceLinks: [{ url, label: null }],
    }).success).toBe(false);
  });

  test.each([
    ['https://example.com./path', 'https://example.com/path'],
    ['https://8.8.8.8/path', 'https://8.8.8.8/path'],
    ['https://[2606:4700:4700::1111]/path', 'https://[2606:4700:4700::1111]/path'],
    ['https://example.com/path?signature_version=4&tokenization=1', 'https://example.com/path?signature_version=4&tokenization=1'],
  ])('normalizes and accepts public reference URL %s', (url, normalizedUrl) => {
    expect(approvedCrmSnapshotSchema.parse({
      ...approvedSnapshotFixture,
      referenceLinks: [{ url, label: null }],
    }).referenceLinks[0].url).toBe(normalizedUrl);
  });
});

describe('Monday payload projection', () => {
  test('never includes Monday-owned or analysis-only data in an update', () => {
    const payload = buildMondayUpdatePayload(approvedSnapshotFixture);

    expect(payload).not.toHaveProperty('lead_owner');
    expect(payload).not.toHaveProperty('pipeline_stage');
    expect(payload).not.toHaveProperty('reference_files');
    expect(JSON.stringify(payload)).not.toContain('object_key');
    expect(JSON.stringify(payload)).not.toContain('telegram');
    expect(Object.keys(payload)).toEqual(expect.arrayContaining([
      schema.columns.crm_record_id.id,
      schema.columns.qualification_status.id,
    ]));
  });

  test('preserves missing email instead of fabricating it', () => {
    const payload = buildMondayCreatePayload({
      ...approvedSnapshotFixture,
      contactEmail: null,
    });

    expect(payload.columnValues).not.toHaveProperty(schema.columns.contact_email.id);
  });

  test('uses canonical Monday shapes and sorted normalized links', () => {
    const payload = buildMondayCreatePayload(approvedSnapshotFixture);

    expect(payload.columnValues).toMatchObject({
      [schema.columns.contact_email.id]: { email: 'ada@example.com', text: 'Ada Example' },
      [schema.columns.project_scope.id]: { text: 'Finish a campaign.' },
      [schema.columns.qualification_status.id]: { index: 1 },
      [schema.columns.recommended_next_step.id]: { index: 7 },
      [schema.columns.service.id]: { index: 109 },
      [schema.columns.budget.id]: { index: 15 },
      [schema.columns.source_channel.id]: { index: 7 },
    });
    expect(payload.columnValues[schema.columns.reference_links.id]).toBe(
      'https://example.com/a\nhttps://example.org/b?a=1&z=2 | Second',
    );
  });

  test('limits project scope to 2,000 characters', () => {
    const projectScope = 'x'.repeat(2_000);
    const payload = buildMondayCreatePayload({ ...approvedSnapshotFixture, projectScope });

    expect(payload.columnValues[schema.columns.project_scope.id]).toEqual({ text: projectScope });
    expect(approvedCrmSnapshotSchema.safeParse({
      ...approvedSnapshotFixture,
      projectScope: `${projectScope}x`,
    }).success).toBe(false);
  });

  test('fails closed when an emitted enum has no numeric label ID', () => {
    expect(() => buildMondayUpdatePayload({
      ...approvedSnapshotFixture,
      service: 'not-a-board-label',
    })).toThrow('service');
  });

  test.each(Object.entries(schema.statusLabelIds.qualification_status))(
    'projects qualification status %s with its numeric label ID',
    (qualificationStatus, labelId) => {
      const payload = buildMondayUpdatePayload({ ...approvedSnapshotFixture, qualificationStatus });
      expect(payload[schema.columns.qualification_status.id]).toEqual({ index: labelId });
    },
  );

  test.each(Object.entries(schema.statusLabelIds.recommended_next_step))(
    'projects recommended next step %s with its numeric label ID',
    (recommendedNextStep, labelId) => {
      const payload = buildMondayUpdatePayload({ ...approvedSnapshotFixture, recommendedNextStep });
      expect(payload[schema.columns.recommended_next_step.id]).toEqual({ index: labelId });
    },
  );

  test.each(Object.entries(schema.statusLabelIds.service))(
    'projects service %s with its numeric label ID',
    (service, labelId) => {
      const payload = buildMondayUpdatePayload({ ...approvedSnapshotFixture, service });
      expect(payload[schema.columns.service.id]).toEqual({ index: labelId });
    },
  );

  test.each(Object.entries(schema.statusLabelIds.budget))(
    'projects budget %s with its numeric label ID',
    (budget, labelId) => {
      const payload = buildMondayUpdatePayload({ ...approvedSnapshotFixture, budget });
      expect(payload[schema.columns.budget.id]).toEqual({ index: labelId });
    },
  );

  test('fails closed before building a payload for an unsupported raw budget', () => {
    const snapshot = {
      ...approvedSnapshotFixture,
      budget: '$5,000 SGD',
    };
    expect(approvedCrmSnapshotSchema.parse(snapshot).budget).toBe('$5,000 SGD');
    expect(() => buildMondayUpdatePayload(snapshot)).toThrow('budget');
  });

  test.each(Object.entries(schema.statusLabelIds.source_channel))(
    'projects source channel %s with its numeric label ID',
    (sourceChannel, labelId) => {
      expect(sourceChannel).toBe('balance-assist');
      const payload = buildMondayUpdatePayload(approvedSnapshotFixture);
      expect(payload[schema.columns.source_channel.id]).toEqual({ index: labelId });
    },
  );

  test.each(Object.entries(schema.statusLabelIds.initial_stage))(
    'has a numeric initial-stage label ID for %s',
    (initialStage, labelId) => {
      expect(initialStage).not.toBe('');
      expect(typeof labelId).toBe('number');
    },
  );

  test('omits an initial stage when no approved initial-stage label is configured', () => {
    const payload = buildMondayCreatePayload(approvedSnapshotFixture);

    expect(payload.columnValues).not.toHaveProperty('pipeline_stage');
  });

  test('derives an opaque item name capped at 255 characters', () => {
    const payload = buildMondayCreatePayload({
      ...approvedSnapshotFixture,
      service: null,
      projectType: 'x'.repeat(500),
      contactName: 'Ada Example',
      contactEmail: 'ada@example.com',
      company: 'Example Co',
      projectScope: 'Private project details',
    });

    expect(payload.itemName).toHaveLength(255);
    expect(payload.itemName).toContain('Balance Assist - ');
    expect(payload.itemName).toContain('5e35b4cc');
    expect(payload.itemName).not.toContain('Ada Example');
    expect(payload.itemName).not.toContain('ada@example.com');
    expect(payload.itemName).not.toContain('Example Co');
    expect(payload.itemName).not.toContain('Private project details');
  });

  test('falls back to the short CRM ID when service and project type are empty', () => {
    const payload = buildMondayCreatePayload({
      ...approvedSnapshotFixture,
      service: null,
      projectType: null,
    });

    expect(payload.itemName).toBe('Balance Assist - 5e35b4cc');
  });

  test('falls back to the short CRM ID when service and project type are empty strings', () => {
    const payload = buildMondayCreatePayload({
      ...approvedSnapshotFixture,
      service: '',
      projectType: '',
    });

    expect(payload.itemName).toBe('Balance Assist - 5e35b4cc');
  });
});
