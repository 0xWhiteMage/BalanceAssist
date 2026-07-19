'use client';

import { useState } from 'react';
import { ProjectBriefCard, type BriefMutationOutcome } from '@/components/widget/widget-overlay-parts';
import { brandTokens } from '@/lib/brand-tokens';
import { isBriefReadyForApproval } from '@/lib/conversation/review-state';
import type { LeadDraft } from '@/lib/onboarding/types';

type TransferStatus = 'saved' | 'queued' | 'delivered';
type DataActionCallback = () => string | void | Promise<string | void>;

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
  onViewBrief,
  onClearBrief,
  onWithdrawTransfer,
  onRequestDeletion,
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
  onViewBrief?: DataActionCallback;
  onClearBrief?: DataActionCallback;
  onWithdrawTransfer?: DataActionCallback;
  onRequestDeletion?: DataActionCallback;
  provenance?: Record<string, 'user-stated' | 'inferred' | 'confirmed' | 'cleared'>;
  referenceLinks?: ReadonlyArray<{ id: string; kind: string; url: string }>;
  onAddReference?: (url: string) => Promise<BriefMutationOutcome>;
  onRemoveReference?: (id: string) => Promise<BriefMutationOutcome>;
  transferStatus?: TransferStatus;
  approvalInFlight?: boolean;
  requiresReapproval?: boolean;
}) {
  const ready = isBriefReadyForApproval(draft);
  const hasProjectNeed = Boolean(draft.projectScope.trim() || draft.projectObjective.trim() || draft.service.trim());
  const hasContactDetail = Boolean(draft.contactName.trim() || draft.contactEmail.trim());
  const [pendingDataAction, setPendingDataAction] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<string | null>(null);
  const [dataConfirmation, setDataConfirmation] = useState<'clear' | 'delete' | null>(null);

  async function runDataAction(name: string, callback: DataActionCallback | undefined) {
    if (!callback || pendingDataAction) return;
    setPendingDataAction(name);
    setDataStatus(null);
    try {
      const message = await callback();
      if (message) setDataStatus(message);
    } catch {
      setDataStatus('The project data action could not be completed. Please try again.');
    } finally {
      setPendingDataAction(null);
      setDataConfirmation(null);
    }
  }

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
      <section aria-label="Brief readiness" className="balance-widget-readiness">
        <div className={`balance-widget-readiness-item${hasProjectNeed ? ' is-complete' : ''}`}>
          <span className="balance-widget-readiness-mark" aria-hidden="true">{hasProjectNeed ? '\u2713' : '1'}</span>
          <span>Project need</span>
        </div>
        <div className={`balance-widget-readiness-item${hasContactDetail ? ' is-complete' : ''}`}>
          <span className="balance-widget-readiness-mark" aria-hidden="true">{hasContactDetail ? '\u2713' : '2'}</span>
          <span>Contact detail</span>
        </div>
        <p className="balance-widget-readiness-note">
          {ready ? 'Ready to send. Add context if useful.' : 'Complete both items to send.'}
        </p>
      </section>

      {(onViewBrief || onClearBrief || onWithdrawTransfer || onRequestDeletion) && (
        <details className="balance-widget-data-controls">
          <summary>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <span>Privacy &amp; project data</span>
            <svg className="balance-widget-data-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 10l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </summary>
          <div className="balance-widget-data-actions" aria-label="Brief and data controls">
            {onViewBrief && <button type="button" className="balance-widget-inline-action" disabled={Boolean(pendingDataAction)} onClick={() => void runDataAction('view', onViewBrief)}>View stored data</button>}
            {onClearBrief && <button type="button" className="balance-widget-inline-action" disabled={Boolean(pendingDataAction)} onClick={() => setDataConfirmation('clear')}>Clear editable brief</button>}
            {(onWithdrawTransfer || onRequestDeletion) && (
              <details className="balance-widget-sharing-controls">
                <summary>Sharing consent &amp; deletion</summary>
                <div className="balance-widget-sharing-actions">
                  {onWithdrawTransfer && <button type="button" className="balance-widget-inline-action" disabled={Boolean(pendingDataAction)} onClick={() => void runDataAction('withdraw', onWithdrawTransfer)}>Withdraw sharing consent</button>}
                  {onRequestDeletion && <button type="button" className="balance-widget-inline-action balance-widget-inline-action-danger" disabled={Boolean(pendingDataAction)} onClick={() => setDataConfirmation('delete')}>Request project deletion</button>}
                </div>
              </details>
            )}
            {dataConfirmation === 'clear' && (
              <div role="alert" className="balance-widget-data-confirmation">
                <span>This clears the editable brief only. Uploads, links, consent history, approved transfers, provider copies, and backups are not deleted.</span>
                <button type="button" className="balance-widget-inline-action balance-widget-inline-action-danger" onClick={() => void runDataAction('clear', onClearBrief)}>Confirm clear</button>
                <button type="button" className="balance-widget-inline-action" onClick={() => setDataConfirmation(null)}>Cancel</button>
              </div>
            )}
            {dataConfirmation === 'delete' && (
              <div role="alert" className="balance-widget-data-confirmation">
                <span>Deletion freezes this session and queues removal of stored project data. Provider copies and backups have separate retention controls.</span>
                <button type="button" className="balance-widget-inline-action balance-widget-inline-action-danger" onClick={() => void runDataAction('delete', onRequestDeletion)}>Confirm deletion request</button>
                <button type="button" className="balance-widget-inline-action" onClick={() => setDataConfirmation(null)}>Cancel</button>
              </div>
            )}
            {pendingDataAction && <div role="status" className="balance-widget-data-status">Updating project data...</div>}
            {dataStatus && <div role="status" className="balance-widget-data-status">{dataStatus}</div>}
          </div>
        </details>
      )}

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
              Sends this brief and its reference links to Balance. Approved copies may be retained in the services Balance uses to respond and manage enquiries.
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
        </div>
      )}
    </div>
  );
}
