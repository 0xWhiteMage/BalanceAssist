import type { LeadDraft } from '@/lib/onboarding/types';

const STRONG_INTENT_FIELDS: Array<(draft: LeadDraft) => boolean> = [
  (draft) => Boolean(draft.service),
  (draft) => Boolean(draft.projectType && draft.projectType.trim().length > 0),
  (draft) => Boolean(draft.projectScope && draft.projectScope.trim().length > 0)
];

export function detectProjectIntent(draft: LeadDraft): boolean {
  return STRONG_INTENT_FIELDS.some((check) => check(draft));
}
