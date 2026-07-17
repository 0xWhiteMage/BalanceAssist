import type { LeadDraft } from '@/lib/onboarding/types';

export type IntakeStageId = 'project' | 'audience' | 'planning' | 'references-contact';

export const INTAKE_STAGES = [
  { id: 'project', label: 'Project and objective' },
  { id: 'audience', label: 'Audience and outputs' },
  { id: 'planning', label: 'Timeline and budget' },
  { id: 'references-contact', label: 'References and contact' }
] as const;

const hasValue = (value: string | undefined) => Boolean(value?.trim());
const MAX_RECAP_VALUE_LENGTH = 200;

export function getCurrentIntakeStage(draft: Partial<LeadDraft>) {
  if (
    !(
      hasValue(draft.projectScope) ||
      hasValue(draft.projectType) ||
      hasValue(draft.service)
    ) ||
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

export function getIntakeStageIndex(draft: Partial<LeadDraft>): number {
  return INTAKE_STAGES.findIndex((stage) => stage.id === getCurrentIntakeStage(draft).id);
}

export function getCompletedIntakeStageCount(draft: Partial<LeadDraft>): number {
  const projectComplete = (
    hasValue(draft.projectScope) || hasValue(draft.projectType) || hasValue(draft.service)
  ) && hasValue(draft.projectObjective);
  if (!projectComplete) return 0;

  const audienceComplete = hasValue(draft.audience) && hasValue(draft.intendedOutputs);
  if (!audienceComplete) return 1;

  const planningComplete = hasValue(draft.timelineBand) && hasValue(draft.budgetBand);
  if (!planningComplete) return 2;

  const referencesComplete = draft.referencesStatus === 'added' || draft.referencesStatus === 'skipped';
  const contactComplete = hasValue(draft.contactName) || hasValue(draft.contactEmail);
  return referencesComplete && contactComplete ? 4 : 3;
}

function recapValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_RECAP_VALUE_LENGTH) : null;
}

export function formatIntakeStageRecap(stageId: IntakeStageId, draft: Partial<LeadDraft>): string | null {
  const fields: Array<[string | null, string | undefined]> = stageId === 'project'
    ? [[null, draft.projectScope], ['objective', draft.projectObjective]]
    : stageId === 'audience'
      ? [['audience', draft.audience], ['intended outputs', draft.intendedOutputs]]
      : stageId === 'planning'
        ? [['timeline', draft.timelineBand], ['budget', draft.budgetBand]]
        : [
            ['references', draft.referencesStatus === 'added' ? 'Added' : draft.referencesStatus === 'skipped' ? 'Skipped' : undefined],
            ['contact name', draft.contactName],
            ['contact email', draft.contactEmail]
          ];
  const facts = fields.flatMap(([label, value]) => {
    const safeValue = recapValue(value);
    return safeValue ? [`${label ? `${label}: ` : ''}${safeValue}`] : [];
  });
  return facts.length > 0 ? `So far: ${facts.join('; ')}.` : null;
}
