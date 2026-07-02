import type { BudgetBandId } from '@/lib/onboarding/types';

type BudgetGuidance = {
  label: string;
  guidance: string;
};

const budgetMatrix: Record<BudgetBandId, BudgetGuidance> = {
  'under-20k': {
    label: 'Under $20,000',
    guidance: 'Typically better suited to tightly scoped edits, adaptations, or lighter content packages.'
  },
  '20k-50k': {
    label: '$20,000-$50,000',
    guidance: 'A workable range for contained production, post-production, or smaller campaign deliverables.'
  },
  '50k-150k': {
    label: '$50,000-$150,000',
    guidance: 'A strong range for multi-deliverable campaigns, premium production, and more involved post workflows.'
  },
  '150k-plus': {
    label: '$150,000+',
    guidance: 'Well suited to complex productions, regional rollouts, or high-craft hybrid execution.'
  },
  'not-sure-yet': {
    label: 'Not sure yet',
    guidance: 'We can still review fit, but a budget band helps the team recommend the right scope.'
  }
};

export function getBudgetGuidance(budgetBand: BudgetBandId | '') {
  return budgetBand ? budgetMatrix[budgetBand] : { label: 'Unknown', guidance: 'Budget guidance is not available until a band is selected.' };
}
