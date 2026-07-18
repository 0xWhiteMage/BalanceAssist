'use client';

import { ProjectBriefCard, type BriefMutationOutcome } from '@/components/widget/widget-overlay-parts';
import { brandTokens } from '@/lib/brand-tokens';
import { isBriefReadyForApproval } from '@/lib/conversation/review-state';
import type { LeadDraft } from '@/lib/onboarding/types';

type TransferStatus = 'saved' | 'queued' | 'delivered';

function SecondaryButton({ onClick, children, ariaLabel }: { onClick: () => void; children: React.ReactNode; ariaLabel?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="balance-widget-action balance-widget-wrap"
      style={{
        width: '100%',
        minHeight: 44,
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
  provenance = {},
  referenceLinks = [],
  onAddReference,
  onRemoveReference,
  transferStatus = 'saved',
  approvalInFlight = false,
  requiresReapproval = false
}: {
  draft: LeadDraft;
  approved: boolean;
  mode: 'essentials' | 'summary';
  onApprove: () => void | Promise<void>;
  onContinueRefining: () => void;
  onChange?: (key: string, value: string) => Promise<BriefMutationOutcome>;
  onBookCatchUp?: () => void;
  onTalkToHuman?: () => void;
  provenance?: Record<string, 'user-stated' | 'inferred' | 'confirmed' | 'cleared'>;
  referenceLinks?: ReadonlyArray<{ id: string; kind: string; url: string }>;
  onAddReference?: (url: string) => Promise<BriefMutationOutcome>;
  onRemoveReference?: (id: string) => Promise<BriefMutationOutcome>;
  transferStatus?: TransferStatus;
  approvalInFlight?: boolean;
  requiresReapproval?: boolean;
}) {
  const ready = isBriefReadyForApproval(draft);

  const approveDisabled = !ready || approved || approvalInFlight;
  const approveButtonLabel = approvalInFlight
    ? 'Sending...'
    : requiresReapproval
      ? 'Send updated brief to Balance'
      : 'Send brief to Balance';
  const confirmation = transferStatus === 'delivered'
    ? 'Delivered to the Balance team'
    : transferStatus === 'queued'
      ? 'Queued for the Balance team'
      : 'Brief saved';

  return (
    <div
      className="balance-review-panel"
      data-testid="review-panel"
      data-mode={mode}
      aria-label="Project brief review"
    >
      <section aria-label="Core brief status" style={{ display: 'grid', gap: 4 }}>
        <strong style={{ color: ready ? '#4ade80' : brandTokens.colors.warmGold, fontSize: 12 }}>
          {ready ? 'Core brief ready' : 'Core brief needs a project need and contact detail'}
        </strong>
      </section>

      <section aria-label="Optional brief details" style={{ display: 'grid', gap: 4 }}>
        <span style={{ color: brandTokens.colors.mutedText, fontSize: 11, lineHeight: 1.45 }}>
          Add any useful context, or leave these for the team conversation
        </span>
      </section>

      <ProjectBriefCard
        draft={draft}
        showNudge={false}
        title="Project Brief"
        compact={mode === 'essentials'}
        onChange={onChange}
        provenance={provenance}
        referenceLinks={referenceLinks}
        onAddReference={onAddReference}
        onRemoveReference={onRemoveReference}
      />

      {!approved && (
        <div style={{ display: 'grid', gap: 6 }}>
          <button
            type="button"
            className="balance-widget-action balance-widget-wrap balance-primary-action"
            data-testid="approve-button"
            onClick={() => { if (!approveDisabled) void onApprove(); }}
            disabled={approveDisabled}
            data-in-flight={approvalInFlight ? 'true' : 'false'}
            data-ready={ready ? 'true' : 'false'}
            aria-busy={approvalInFlight || undefined}
            aria-describedby={!ready ? 'approve-disabled-hint' : 'producer-transfer-note'}
            style={{
              width: '100%',
              minHeight: 44,
              padding: '10px 12px',
              borderRadius: 8,
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
          >
            {approveButtonLabel}
          </button>
          {ready && (
            <div id="producer-transfer-note" style={{ fontSize: 10, color: brandTokens.colors.mutedText, lineHeight: 1.5, textAlign: 'center' }}>
              Sends this brief and its reference links to Balance through Telegram and may create a Monday.com record. Those copies have separate retention.
            </div>
          )}
          {approvalInFlight && (
            <span
              role="status"
              aria-live="polite"
              style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0 }}
            >
              Sending brief to Balance
            </span>
          )}
          {!ready && (
            <div id="approve-disabled-hint" data-testid="approve-disabled-hint" style={{ fontSize: 10, color: brandTokens.colors.mutedText, lineHeight: 1.5, textAlign: 'center' }}>
              Add a project need and contact detail to enable sending.
            </div>
          )}
          {mode === 'summary' && ready && (
            <SecondaryButton onClick={onContinueRefining} ariaLabel="Continue refining brief">Continue refining</SecondaryButton>
          )}
        </div>
      )}

      {approved && (
        <div
          data-testid="approve-confirmation"
          role="status"
          aria-live="polite"
          style={{ display: 'grid', gap: 10, padding: 12, border: '1px solid rgba(74, 222, 128, 0.6)', borderRadius: 10, background: 'rgba(74, 222, 128, 0.10)' }}
        >
          <strong style={{ color: '#4ade80', fontSize: 12 }}>{confirmation}</strong>
          {onBookCatchUp && <SecondaryButton onClick={onBookCatchUp} ariaLabel="Book a catch-up call">Book a catch-up</SecondaryButton>}
          {onTalkToHuman && <SecondaryButton onClick={onTalkToHuman} ariaLabel="Talk to a human team member">Talk to a human</SecondaryButton>}
        </div>
      )}
    </div>
  );
}
