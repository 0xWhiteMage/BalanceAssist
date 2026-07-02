export type QualificationStatus = 'qualified' | 'needs_review' | 'misfit' | 'unqualified';
export type RecommendedNextStep = 'schedule' | 'human_followup' | 'manual_review' | 'redirect';

export type NextStepCopy = {
  label: string;
  primaryAction: string;
  secondaryAction: string;
};

const nextStepCopy: Record<RecommendedNextStep, NextStepCopy> = {
  schedule: {
    label: 'Book a call',
    primaryAction: 'Book a call',
    secondaryAction: 'Request human follow-up'
  },
  human_followup: {
    label: 'Request human follow-up',
    primaryAction: 'Request human follow-up',
    secondaryAction: 'Continue refining brief'
  },
  manual_review: {
    label: 'Needs manual review',
    primaryAction: 'Request human follow-up',
    secondaryAction: 'Continue refining brief'
  },
  redirect: {
    label: 'Redirect to the right contact channel',
    primaryAction: 'Talk to a human',
    secondaryAction: 'Continue refining brief'
  }
};

export function getRecommendedNextStep(status: QualificationStatus): RecommendedNextStep {
  switch (status) {
    case 'qualified':
      return 'schedule';
    case 'needs_review':
      return 'manual_review';
    case 'misfit':
      return 'redirect';
    case 'unqualified':
      return 'human_followup';
  }
}

export function getNextStepCopy(step: RecommendedNextStep) {
  return nextStepCopy[step];
}
