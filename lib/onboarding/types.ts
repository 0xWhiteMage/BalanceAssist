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
export type ReferencesStatus = '' | 'added' | 'skipped';

export type LeadDraft = {
  service: ServiceOptionId | '';
  projectType?: string;
  projectScope: string;
  projectObjective: string;
  audience: string;
  intendedOutputs: string;
  referencesStatus: ReferencesStatus;
  scopePolished?: string;
  timelineBand: string;
  budgetBand: string;
  contactName: string;
  contactEmail: string;
  contactCompany?: string;
  consentToShare?: boolean;
};

export type EssentialsProgress = {
  completed: number;
  total: number;
};
