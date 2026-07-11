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

export function createDraft(): VersionedDraft {
  return {};
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
    const field = draft[key];
    if (field.provenance !== 'cleared' && field.value) {
      visible[key] = field;
    }
  }
  return visible;
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
  scopePolished: 'Scope',
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
