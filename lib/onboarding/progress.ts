import { essentialFields, type EssentialField } from '@/lib/onboarding/flow-config';
import type { EssentialsProgress, LeadDraft } from '@/lib/onboarding/types';

export function isLeadFieldComplete(value: LeadDraft[keyof LeadDraft]) {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return Boolean(value);
}

export function isEssentialFieldComplete(field: EssentialField, draft: LeadDraft) {
  return field.fields.every((draftField) => isLeadFieldComplete(draft[draftField]));
}

export function getEssentialsProgress(draft: LeadDraft): EssentialsProgress {
  const completed = essentialFields.filter((field) => isEssentialFieldComplete(field, draft)).length;

  return {
    completed,
    total: essentialFields.length
  };
}
