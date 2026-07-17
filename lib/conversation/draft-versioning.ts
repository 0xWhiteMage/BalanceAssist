export type FieldProvenance = 'user-stated' | 'inferred' | 'confirmed' | 'cleared';

export type DraftField = {
  value: string;
  provenance: FieldProvenance;
  updatedAt: string;
};

export type VersionedDraft = Record<string, DraftField>;

export type DraftSummary = {
  fields: Array<{ name: string; value: string; provenance: FieldProvenance; updatedAt: string }>;
  totalFields: number;
  clearedFields: number;
};

function isFieldProvenance(value: unknown): value is FieldProvenance {
  return value === 'user-stated' || value === 'inferred' || value === 'confirmed' || value === 'cleared';
}

function normalizeDraftField(value: unknown): DraftField | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const row = value as Record<string, unknown>;
  if (typeof row.value !== 'string' || typeof row.updatedAt !== 'string' || !isFieldProvenance(row.provenance)) {
    return null;
  }

  return {
    value: row.value,
    provenance: row.provenance,
    updatedAt: row.updatedAt
  };
}

export function createDraft(): VersionedDraft {
  return {};
}

export function normalizeVersionedDraft(value: unknown): VersionedDraft {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const normalized: VersionedDraft = {};

  for (const [key, field] of Object.entries(value)) {
    const safeField = normalizeDraftField(field);
    if (safeField) {
      normalized[key] = safeField;
    }
  }

  return normalized;
}

export function updateField(
  draft: VersionedDraft,
  field: string,
  value: string,
  provenance: FieldProvenance
): VersionedDraft {
  return {
    ...draft,
    [field]: {
      value,
      provenance,
      updatedAt: new Date().toISOString()
    }
  };
}

export function clearField(draft: VersionedDraft, field: string): VersionedDraft {
  return {
    ...draft,
    [field]: {
      value: '',
      provenance: 'cleared',
      updatedAt: new Date().toISOString()
    }
  };
}

export function getVisibleDraft(draft: VersionedDraft): VersionedDraft {
  const visible: VersionedDraft = {};
  for (const key of Object.keys(draft)) {
    if (key.startsWith('__')) {
      continue;
    }
    const field = draft[key];
    if (field.provenance !== 'cleared' && field.value) {
      visible[key] = field;
    }
  }
  return visible;
}

export function getVisibleDraftValues(draft: VersionedDraft): Record<string, string> {
  const visible = getVisibleDraft(draft);
  const values: Record<string, string> = {};

  for (const [key, field] of Object.entries(visible)) {
    values[key] = field.value;
  }

  return values;
}

export function getDraftSummary(draft: VersionedDraft): DraftSummary {
  const fields: DraftSummary['fields'] = [];
  let clearedFields = 0;

  for (const key of Object.keys(draft)) {
    const field = draft[key];
    if (field.provenance === 'cleared') {
      clearedFields++;
      continue;
    }
    if (field.value) {
      fields.push({
        name: key,
        value: field.value,
        provenance: field.provenance,
        updatedAt: field.updatedAt
      });
    }
  }

  return {
    fields,
    totalFields: Object.keys(draft).length,
    clearedFields
  };
}

export const FIELD_LABELS: Record<string, string> = {
  service: 'Service',
  projectType: 'Project type',
  projectScope: 'Project scope',
  projectObjective: 'Project objective',
  audience: 'Audience',
  intendedOutputs: 'Intended outputs',
  scopePolished: 'AI-drafted summary',
  timelineBand: 'Timeline',
  budgetBand: 'Budget',
  contactName: 'Contact name',
  contactEmail: 'Contact email',
  contactCompany: 'Company'
};

export function renderDraftSummary(draft: DraftSummary): string {
  if (draft.fields.length === 0) {
    return "I don't have any project details yet.";
  }

  const lines = draft.fields.map((f) => {
    const label = FIELD_LABELS[f.name] ?? f.name;
    const provenanceHint =
      f.provenance === 'inferred' ? ' (inferred)' :
      f.provenance === 'confirmed' ? ' (confirmed)' :
      '';
    return `- ${label}: ${f.value}${provenanceHint}`;
  });

  return `Here's what I remember about your project:\n${lines.join('\n')}`;
}
