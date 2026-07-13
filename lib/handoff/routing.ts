export type RoutingDestination = 'standard' | 'priority_review';

export type RoutingReason =
  | 'high_budget'
  | 'urgent_timeline'
  | 'ambiguous_intent'
  | 'low_score_frustrated';

export type RoutingInput = {
  service: string;
  projectScope: string;
  timelineBand: string;
  budgetBand: string;
  contactName: string;
  contactEmail: string;
  qualificationStatus: string;
  score: number;
};

export type RoutingResult = {
  destination: RoutingDestination;
  reasons: RoutingReason[];
  caseId: string;
};

function generateCaseId(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    hash = ((hash << 5) - hash + sessionId.charCodeAt(i)) | 0;
  }
  const num = Math.abs(hash) % 10000;
  return `CASE-${String(num).padStart(4, '0')}`;
}

function detectHighBudget(budgetBand: string): boolean {
  return budgetBand === '150k-plus' || budgetBand === '50k-150k';
}

function detectUrgentTimeline(timelineBand: string): boolean {
  return /asap|urgent/i.test(timelineBand);
}

function detectAmbiguousIntent(draft: RoutingInput): boolean {
  const noService = !draft.service || draft.service === 'not-sure-yet';
  const noScope = !draft.projectScope.trim();
  return noService && noScope;
}

function detectLowScoreFrustrated(
  qualificationStatus: string,
  score: number
): boolean {
  return qualificationStatus === 'unqualified' && score <= 3;
}

export function routeLead(
  draft: RoutingInput,
  sessionId: string = ''
): RoutingResult {
  const reasons: RoutingReason[] = [];

  if (detectHighBudget(draft.budgetBand)) {
    reasons.push('high_budget');
  }

  if (detectUrgentTimeline(draft.timelineBand)) {
    reasons.push('urgent_timeline');
  }

  if (detectAmbiguousIntent(draft)) {
    reasons.push('ambiguous_intent');
  }

  if (detectLowScoreFrustrated(draft.qualificationStatus, draft.score)) {
    reasons.push('low_score_frustrated');
  }

  const destination: RoutingDestination =
    reasons.length > 0 ? 'priority_review' : 'standard';

  return {
    destination,
    reasons,
    caseId: generateCaseId(sessionId || draft.contactEmail || 'default')
  };
}
