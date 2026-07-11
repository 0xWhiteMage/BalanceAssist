import type { LeadDraft } from '@/lib/onboarding/types';

export function createDefaultLeadDraft(): LeadDraft {
  return {
    service: '',
    projectType: '',
    projectScope: '',
    scopePolished: '',
    timelineBand: '',
    budgetBand: '',
    contactName: '',
    contactEmail: '',
    contactCompany: '',
    consentToShare: false
  };
}

export function createDemoLeadDraft(): LeadDraft {
  return {
    ...createDefaultLeadDraft(),
    service: 'production',
    timelineBand: '1-2-months',
    budgetBand: '50k-150k'
  };
}
