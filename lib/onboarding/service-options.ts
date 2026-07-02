import type { BudgetBandId, ServiceOptionId, TimelineBandId } from '@/lib/onboarding/types';

export type LabeledOption<T extends string> = {
  id: T;
  label: string;
};

export const serviceOptions: LabeledOption<ServiceOptionId>[] = [
  { id: 'production', label: 'Production' },
  { id: 'post-production', label: 'Post-Production' },
  { id: 'event-experience-content', label: 'Event & Experience Content' },
  { id: 'media-asset-adaptation', label: 'Media Asset Adaptation' },
  { id: 'design-direction', label: 'Design & Direction' },
  { id: 'generative-ai', label: 'Generative AI' },
  { id: 'not-sure-yet', label: 'Not sure yet' }
];

export const timelineBandOptions: LabeledOption<TimelineBandId>[] = [
  { id: 'asap', label: 'ASAP' },
  { id: '1-2-months', label: '1-2 months' },
  { id: '3-plus-months', label: '3+ months' },
  { id: 'flexible', label: 'Flexible' }
] as const;

export const budgetBandOptions: LabeledOption<BudgetBandId>[] = [
  { id: 'under-20k', label: 'Under $20,000' },
  { id: '20k-50k', label: '$20,000-$50,000' },
  { id: '50k-150k', label: '$50,000-$150,000' },
  { id: '150k-plus', label: '$150,000+' },
  { id: 'not-sure-yet', label: 'Not sure yet' }
] as const;
