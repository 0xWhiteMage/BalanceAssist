'use client';

import { useEffect, useState } from 'react';
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
  onContinueRefining,
  onChange,
  onBookCatchUp,
  onTalkToHuman,
  telegramBroadcastStatus = 'unconfigured',
  telegramPending = false
}: {
  draft: LeadDraft;
  approved: boolean;
  mode: 'essentials' | 'summary';
  onApprove: () => void;
  onContinueRefining: () => void;
  onChange?: (key: string, value: string) => void;
  onBookCatchUp?: () => void;
  onTalkToHuman?: () => void;
  telegramBroadcastStatus?: 'pending' | 'sent' | 'unconfigured';
  telegramPending?: boolean;
}) {
  const ready = isBriefReadyForApproval(draft);
  const [isApproveInFlight, setIsApproveInFlight] = useState(false);

  useEffect(() => {
    if (approved) {
      setIsApproveInFlight(false);
    }
  }, [approved]);

  function handleApproveClick() {
    if (approved || isApproveInFlight || !ready) return;
    setIsApproveInFlight(true);
    onApprove();
  }

  const approveDisabled = !ready || approved || isApproveInFlight;

  // Progress must match the 8 visible rows on the brief card. Mirroring the exact substitution ProjectBriefCard applies.
  const projectScopeFilled = (draft.scopePolished || draft.projectScope || '').trim().length > 0;
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

  const missing = missingReviewFields(draft);

  const approveButtonLabel = approved
    ? 'Approved'
    : isApproveInFlight
      ? 'Sending…'
      : mode === 'summary'
        ? 'Approve & send to team'
        : 'Send to team';

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
        onChange={onChange}
      />

      {!approved && (
        <div style={{ display: 'grid', gap: 6 }}>
          <button
            type="button"
            data-testid="approve-button"
            onClick={handleApproveClick}
            disabled={approveDisabled}
            data-in-flight={isApproveInFlight ? 'true' : 'false'}
            data-ready={ready ? 'true' : 'false'}
            aria-busy={isApproveInFlight || undefined}
            aria-label={!ready ? 'Fill the missing fields to send to the team' : undefined}
            title={!ready ? 'Fill the missing fields to send to the team' : undefined}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              border: 'none',
              background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
              color: brandTokens.colors.baseBlack,
              fontSize: 11,
              fontWeight: 700,
              cursor: approveDisabled ? 'not-allowed' : 'pointer',
              opacity: approveDisabled ? 0.4 : 1,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              boxShadow: approveDisabled ? 'none' : '0 4px 18px rgba(219, 181, 128, 0.45)'
            }}
            onMouseEnter={(e) => {
              if (approveDisabled) return;
              e.currentTarget.style.filter = 'brightness(1.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'brightness(1)';
            }}
          >
            {approveButtonLabel}
          </button>
          {!ready && missing.length > 0 && mode === 'essentials' && (
            <div
              data-testid="approve-disabled-hint"
              style={{
                fontSize: 10,
                color: brandTokens.colors.mutedText,
                lineHeight: 1.5,
                textAlign: 'center',
                padding: '4px 6px'
              }}
            >
              Fill the missing fields to enable.
            </div>
          )}
          {!ready && missing.length > 0 && mode === 'summary' && (
            <div
              data-testid="approve-disabled-hint"
              style={{
                fontSize: 10,
                color: brandTokens.colors.mutedText,
                lineHeight: 1.5,
                textAlign: 'center',
                padding: '4px 6px'
              }}
            >
              Fill the missing fields to enable.
            </div>
          )}
          {mode === 'summary' && ready && !approved && (
            <SecondaryButton onClick={onContinueRefining}>Continue refining</SecondaryButton>
          )}
        </div>
      )}

      {approved && (
        <div
          data-testid="approve-confirmation"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: '12px 12px',
            border: `1px solid rgba(74, 222, 128, 0.6)`,
            borderRadius: 10,
            background: 'rgba(74, 222, 128, 0.10)',
            animation: 'approve-confirm 0.4s ease-out'
          }}
        >
          <div
            data-testid="approve-confirmation-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 700,
              color: '#4ade80',
              textTransform: 'uppercase',
              letterSpacing: '0.10em'
            }}
          >
            <span style={{ fontSize: 14 }}>✓</span>
            Brief approved
          </div>
          <div
            data-testid="approve-confirmation-count"
            style={{
              fontSize: 11,
              color: brandTokens.colors.lightText,
              lineHeight: 1.45
            }}
          >
            {completed} of {TOTAL_FIELDS} fields captured · The Balance team has been notified.
          </div>
          <div
            data-testid="approve-confirmation-telegram"
            style={{
              fontSize: 10,
              fontWeight: 600,
              color:
                telegramBroadcastStatus === 'sent'
                  ? '#4ade80'
                  : telegramBroadcastStatus === 'pending' || telegramPending
                    ? brandTokens.colors.warmGold
                    : brandTokens.colors.mutedText,
              textTransform: 'uppercase',
              letterSpacing: '0.10em'
            }}
          >
            {telegramBroadcastStatus === 'sent'
              ? 'Telegram notification sent'
              : telegramBroadcastStatus === 'pending' || telegramPending
                ? 'Telegram broadcast pending…'
                : 'Telegram connection pending'}
          </div>
          {onBookCatchUp && (
            <button
              type="button"
              data-testid="book-catch-up-cta"
              onClick={onBookCatchUp}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
                border: 'none',
                background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
                color: brandTokens.colors.baseBlack,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                boxShadow: '0 4px 18px rgba(219, 181, 128, 0.45)'
              }}
            >
              Book a catch-up
            </button>
          )}
          {onTalkToHuman && (
            <button
              type="button"
              data-testid="talk-to-human-cta"
              onClick={onTalkToHuman}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 8,
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
              Talk to a human
            </button>
          )}
        </div>
      )}
    </div>
  );
}
