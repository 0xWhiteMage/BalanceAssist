import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { LeadDraft } from '@/lib/onboarding/types';
import { getBudgetGuidance } from '@/lib/qualification/budget-matrix';
import { getNextStepCopy } from '@/lib/qualification/next-step';
import { scoreLead } from '@/lib/qualification/score';
import { getTimelineGuidance } from '@/lib/qualification/timeline-matrix';

type SummaryPanelProps = {
  draft: LeadDraft;
};

export function SummaryPanel({ draft }: SummaryPanelProps) {
  const budget = getBudgetGuidance(draft.budgetBand);
  const timeline = getTimelineGuidance(draft.timelineBand);
  const qualification = scoreLead(draft);
  const nextStep = getNextStepCopy(qualification.recommendedNextStep);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card className="p-5">
        <p className="text-xs uppercase tracking-[0.24em] text-white/70">Project summary</p>
        <div className="mt-4 space-y-3 text-sm text-white/80">
          <p><span className="font-semibold text-white">Service:</span> {draft.service || 'Unknown'}</p>
          <p><span className="font-semibold text-white">Project scope:</span> {draft.projectScope || 'To be confirmed'}</p>
          <p><span className="font-semibold text-white">Primary contact:</span> {draft.contactName || 'To be confirmed'}</p>
          <p><span className="font-semibold text-white">Qualification status:</span> {qualification.status}</p>
        </div>
      </Card>
      <Card className="p-5">
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/70">Recommended next step</p>
            <p className="mt-2 text-base font-semibold text-white">{nextStep.label}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/70">Timeline guidance</p>
            <p className="mt-2 text-base font-semibold text-white">{timeline.label}</p>
            <p className="mt-2 text-sm leading-6 text-white/70">{timeline.guidance}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-white/70">Budget guidance</p>
            <p className="mt-2 text-base font-semibold text-white">{budget.label}</p>
            <p className="mt-2 text-sm leading-6 text-white/70">{budget.guidance}</p>
          </div>
          <p className="text-sm leading-6 text-white/70">
            Indicative only. Final scope, timing, and pricing require human review.
          </p>
          <div className="grid gap-3">
            <Button fullWidth>{nextStep.primaryAction}</Button>
            <Button fullWidth variant="secondary">
              {nextStep.secondaryAction}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
