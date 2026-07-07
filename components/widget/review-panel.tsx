'use client';

import { ProjectBriefCard } from '@/components/widget/widget-overlay-parts';
import { brandTokens } from '@/lib/brand-tokens';
import { isBriefReadyForApproval, missingReviewFields } from '@/lib/conversation/review-state';
import type { LeadDraft } from '@/lib/onboarding/types';

const TOTAL_FIELDS = 8;

function ProgressStrip({ completed, total }: { completed: number; total: number }) {
  const pct = Math.min(100, Math.max(0, (completed / total) * 100));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="review-panel-progress">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: brandTokens.colors.warmGold,
            textTransform: 'uppercase',
            letterSpacing: '0.16em'
          }}
        >
          Progress
        </span>
        <span style={{ fontSize: 11, color: brandTokens.colors.mutedText }}>
          {completed} of {total} captured
        </span>
      </div>
      <div
        style={{
          height: 4,
          width: '100%',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.05)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`
          }}
        />
      </div>
    </div>
  );
}

function PrimaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        padding: '10px 12px',
        borderRadius: '8px',
        border: 'none',
        background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
        color: brandTokens.colors.baseBlack,
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer',
        textTransform: 'uppercase',
        letterSpacing: '0.12em'
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        padding: '10px 12px',
        borderRadius: '8px',
        border: `1px solid ${brandTokens.colors.border}`,
        background: 'transparent',
        color: brandTokens.colors.lightText,
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        textTransform: 'uppercase',
        letterSpacing: '0.12em'
      }}
    >
      {children}
    </button>
  );
}

export function ReviewPanel({
  draft,
  approved,
  mode,
  onApprove,
  onContinueRefining
}: {
  draft: LeadDraft;
  approved: boolean;
  mode: 'essentials' | 'summary';
  onApprove: () => void;
  onContinueRefining: () => void;
}) {
  const ready = isBriefReadyForApproval(draft);

  // Progress must match the 8 visible rows on the brief card. Mirroring the exact substitution ProjectBriefCard applies.
  const projectScopeFilled = (draft.scopePolished ?? draft.projectScope ?? '').trim().length > 0;
  const projectTypeFilled = (draft.projectType ?? '').trim().length > 0;
  const serviceFilled = Boolean(draft.service);
  const timelineFilled = Boolean(draft.timelineBand);
  const budgetFilled = Boolean(draft.budgetBand);
  const contactNameFilled = draft.contactName.trim().length > 0;
  const companyFilled = (draft.contactCompany ?? '').trim().length > 0;
  const contactEmailFilled = draft.contactEmail.trim().length > 0;
  const completed =
    (projectScopeFilled ? 1 : 0) +
    (projectTypeFilled ? 1 : 0) +
    (serviceFilled ? 1 : 0) +
    (timelineFilled ? 1 : 0) +
    (budgetFilled ? 1 : 0) +
    (contactNameFilled ? 1 : 0) +
    (companyFilled ? 1 : 0) +
    (contactEmailFilled ? 1 : 0);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}
      data-testid="review-panel"
      data-mode={mode}
    >
      <ProgressStrip completed={completed} total={TOTAL_FIELDS} data-completed={String(completed)} />

      <ProjectBriefCard
        draft={draft}
        showNudge={mode === 'essentials'}
        title="Project Brief"
        readyForApproval={false}
        approved={approved}
        compact={mode === 'essentials'}
      />

      {mode === 'summary' && ready && !approved && (
        <div style={{ display: 'grid', gap: 8 }}>
          <PrimaryButton onClick={onApprove}>Approve &amp; send to team</PrimaryButton>
          <SecondaryButton onClick={onContinueRefining}>Continue refining</SecondaryButton>
        </div>
      )}

      {approved && (
        <div
          style={{
            fontSize: 11,
            color: '#4ade80',
            lineHeight: 1.5,
            padding: '8px 10px',
            border: `1px solid ${brandTokens.colors.subtleBorder}`,
            borderRadius: 8,
            background: 'rgba(74, 222, 128, 0.06)'
          }}
        >
          Brief approved. The Balance team has been notified.
        </div>
      )}
    </div>
  );
}
