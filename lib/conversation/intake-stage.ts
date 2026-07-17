import type { LeadDraft } from '@/lib/onboarding/types';

export type IntakeStageId = 'project' | 'audience' | 'planning' | 'references-contact';

export const INTAKE_STAGES = [
  { id: 'project', label: 'Project and objective' },
  { id: 'audience', label: 'Audience and outputs' },
  { id: 'planning', label: 'Timeline and budget' },
  { id: 'references-contact', label: 'References and contact' }
] as const;

const hasValue = (value: string | undefined) => Boolean(value?.trim());

export function getCurrentIntakeStage(draft: Partial<LeadDraft>) {
  if (
    !(hasValue(draft.projectScope) || hasValue(draft.service)) ||
    !hasValue(draft.projectObjective)
  ) {
    return INTAKE_STAGES[0];
  }
  if (!hasValue(draft.audience) || !hasValue(draft.intendedOutputs)) {
    return INTAKE_STAGES[1];
  }
  if (!hasValue(draft.timelineBand) || !hasValue(draft.budgetBand)) {
    return INTAKE_STAGES[2];
  }
  return INTAKE_STAGES[3];
}
