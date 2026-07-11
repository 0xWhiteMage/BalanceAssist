import { describe, test, expect } from 'vitest';
import {
  createDraft,
  updateField,
  clearField,
  getVisibleDraft,
  getDraftSummary,
  renderDraftSummary,
  FIELD_LABELS
} from '@/lib/conversation/draft-versioning';
import type { VersionedDraft } from '@/lib/conversation/draft-versioning';

describe('createDraft', () => {
  test('returns an empty object', () => {
    const draft = createDraft();
    expect(draft).toEqual({});
  });
});

describe('updateField', () => {
  test('adds a new field with provenance', () => {
    const draft = createDraft();
    const updated = updateField(draft, 'service', 'production', 'user-stated');

    expect(updated.service).toBeDefined();
    expect(updated.service.value).toBe('production');
    expect(updated.service.provenance).toBe('user-stated');
    expect(updated.service.updatedAt).toBeTruthy();
  });

  test('preserves existing fields', () => {
    let draft = createDraft();
    draft = updateField(draft, 'service', 'production', 'user-stated');
    draft = updateField(draft, 'contactName', 'Jayden', 'inferred');

    expect(Object.keys(draft)).toHaveLength(2);
    expect(draft.service.value).toBe('production');
    expect(draft.contactName.value).toBe('Jayden');
  });

  test('overwrites an existing field', () => {
    let draft = createDraft();
    draft = updateField(draft, 'service', 'production', 'user-stated');
    draft = updateField(draft, 'service', 'post-production', 'confirmed');

    expect(draft.service.value).toBe('post-production');
    expect(draft.service.provenance).toBe('confirmed');
  });

  test('does not mutate the original draft', () => {
    const draft = createDraft();
    const updated = updateField(draft, 'service', 'production', 'user-stated');

    expect(draft).toEqual({});
    expect(updated).not.toEqual(draft);
  });
});

describe('clearField', () => {
  test('marks field as cleared with empty value', () => {
    let draft = createDraft();
    draft = updateField(draft, 'service', 'production', 'user-stated');
    draft = clearField(draft, 'service');

    expect(draft.service.value).toBe('');
    expect(draft.service.provenance).toBe('cleared');
    expect(draft.service.updatedAt).toBeTruthy();
  });

  test('does not affect other fields', () => {
    let draft = createDraft();
    draft = updateField(draft, 'service', 'production', 'user-stated');
    draft = updateField(draft, 'contactName', 'Jayden', 'confirmed');
    draft = clearField(draft, 'service');

    expect(Object.keys(draft)).toHaveLength(2);
    expect(draft.contactName.value).toBe('Jayden');
  });
});

describe('getVisibleDraft', () => {
  test('returns only non-cleared fields with values', () => {
    let draft = createDraft();
    draft = updateField(draft, 'service', 'production', 'user-stated');
    draft = updateField(draft, 'contactName', 'Jayden', 'inferred');
    draft = clearField(draft, 'service');

    const visible = getVisibleDraft(draft);

    expect(Object.keys(visible)).toHaveLength(1);
    expect(visible.contactName.value).toBe('Jayden');
  });

  test('returns empty draft when all fields cleared', () => {
    let draft = createDraft();
    draft = updateField(draft, 'service', 'production', 'user-stated');
    draft = clearField(draft, 'service');

    const visible = getVisibleDraft(draft);
    expect(Object.keys(visible)).toHaveLength(0);
  });

  test('returns empty draft for empty input', () => {
    const visible = getVisibleDraft(createDraft());
    expect(Object.keys(visible)).toHaveLength(0);
  });
});

describe('getDraftSummary', () => {
  test('reports zero fields for empty draft', () => {
    const summary = getDraftSummary(createDraft());

    expect(summary.fields).toHaveLength(0);
    expect(summary.totalFields).toBe(0);
    expect(summary.clearedFields).toBe(0);
  });

  test('counts visible and cleared fields', () => {
    let draft = createDraft();
    draft = updateField(draft, 'service', 'production', 'user-stated');
    draft = updateField(draft, 'contactName', 'Jayden', 'confirmed');
    draft = clearField(draft, 'budgetBand');

    const summary = getDraftSummary(draft);

    expect(summary.fields).toHaveLength(2);
    expect(summary.totalFields).toBe(3);
    expect(summary.clearedFields).toBe(1);
  });

  test('includes provenance in field data', () => {
    let draft = createDraft();
    draft = updateField(draft, 'service', 'production', 'inferred');

    const summary = getDraftSummary(draft);
    expect(summary.fields[0].provenance).toBe('inferred');
  });

  test('excludes empty non-cleared fields', () => {
    let draft = createDraft();
    draft = updateField(draft, 'service', 'production', 'user-stated');
    draft = updateField(draft, 'contactName', '', 'user-stated');

    const summary = getDraftSummary(draft);
    expect(summary.fields).toHaveLength(1);
    expect(summary.fields[0].name).toBe('service');
  });
});

describe('renderDraftSummary', () => {
  test('returns default message for empty draft', () => {
    const summary = getDraftSummary(createDraft());
    expect(renderDraftSummary(summary)).toBe("I don't have any project details yet.");
  });

  test('renders field labels with values', () => {
    let draft = createDraft();
    draft = updateField(draft, 'service', 'production', 'confirmed');
    draft = updateField(draft, 'contactName', 'Jayden', 'user-stated');

    const summary = getDraftSummary(draft);
    const rendered = renderDraftSummary(summary);

    expect(rendered).toContain('Service: production');
    expect(rendered).toContain('Contact name: Jayden');
    expect(rendered).toContain('(confirmed)');
  });

  test('uses raw field name for unknown fields', () => {
    let draft = createDraft();
    draft = updateField(draft, 'customField', 'value', 'user-stated');

    const summary = getDraftSummary(draft);
    const rendered = renderDraftSummary(summary);

    expect(rendered).toContain('customField: value');
  });
});

describe('FIELD_LABELS', () => {
  test('contains labels for standard draft fields', () => {
    expect(FIELD_LABELS.service).toBe('Service');
    expect(FIELD_LABELS.projectType).toBe('Project type');
    expect(FIELD_LABELS.contactEmail).toBe('Contact email');
  });
});
