import type { LeadDraft } from '@/lib/onboarding/types';
import { getRecommendedNextStep, type QualificationStatus, type RecommendedNextStep } from '@/lib/qualification/next-step';

export type QualificationResult = {
  status: QualificationStatus;
  score: number;
  dimensions: {
    service: number;
    budget: number;
    timeline: number;
    completeness: number;
    seriousness: number;
  };
  recommendedNextStep: RecommendedNextStep;
};

const QUALIFIED_MIN = 8;
const REVIEW_MIN = 5;

function scoreService(service: LeadDraft['service']) {
  if (!service) {
    return 0;
  }

  return service === 'not-sure-yet' ? 1 : 2;
}

function scoreBudget(budgetBand: LeadDraft['budgetBand']) {
  if (!budgetBand) {
    return 0;
  }

  if (budgetBand === 'under-20k') {
    return 1;
  }

  return budgetBand === 'not-sure-yet' ? 1 : 2;
}

function scoreTimeline(timelineBand: LeadDraft['timelineBand']) {
  if (!timelineBand) {
    return 0;
  }

  return timelineBand === 'asap' ? 1 : 2;
}

function scoreCompleteness(draft: LeadDraft) {
  const fields = [draft.projectScope, draft.contactName, draft.contactEmail].filter((value) => value.trim().length > 0).length;

  if (fields === 3) {
    return 2;
  }

  return fields > 0 ? 1 : 0;
}

function scoreSeriousness(draft: LeadDraft) {
  if (draft.projectScope.trim().length > 20 && draft.contactEmail.trim().length > 0) {
    return 2;
  }

  return draft.projectScope.trim().length > 0 ? 1 : 0;
}

export function scoreLead(draft: LeadDraft): QualificationResult {
  const dimensions = {
    service: scoreService(draft.service),
    budget: scoreBudget(draft.budgetBand),
    timeline: scoreTimeline(draft.timelineBand),
    completeness: scoreCompleteness(draft),
    seriousness: scoreSeriousness(draft)
  };
  const totalScore = Object.values(dimensions).reduce((sum, value) => sum + value, 0);
  const hasAnySignal = Boolean(
    draft.service || draft.projectScope.trim() || draft.contactName.trim() || draft.contactEmail.trim()
  );

  let status: QualificationStatus;

  if (totalScore >= QUALIFIED_MIN) {
    status = 'qualified';
  } else if (totalScore >= REVIEW_MIN) {
    status = 'needs_review';
  } else if (!hasAnySignal) {
    status = 'unqualified';
  } else if (dimensions.service === 0 || dimensions.budget === 0 || dimensions.timeline === 0) {
    status = 'unqualified';
  } else {
    status = 'misfit';
  }

  return {
    status,
    score: totalScore,
    dimensions,
    recommendedNextStep: getRecommendedNextStep(status)
  };
}
