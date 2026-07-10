export type ServiceOptionId =
  | 'production'
  | 'post-production'
  | 'event-experience-content'
  | 'media-asset-adaptation'
  | 'design-direction'
  | 'generative-ai'
  | 'not-sure-yet';

export type TimelineBandId = 'asap' | '1-2-months' | '3-plus-months' | 'flexible';

export type BudgetBandId = 'under-20k' | '20k-50k' | '50k-150k' | '150k-plus' | 'not-sure-yet';

export type LeadDraft = {
  service: ServiceOptionId | '';
  projectType?: string;
  projectScope: string;
  scopePolished?: string;
  timelineBand: string;
  budgetBand: string;
  contactName: string;
  contactEmail: string;
  contactCompany?: string;
};

export type EssentialsProgress = {
  completed: number;
  total: number;
};
