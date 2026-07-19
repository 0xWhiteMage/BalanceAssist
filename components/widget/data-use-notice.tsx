'use client';

import { DATA_USE_NOTICE_COPY, CONSENT_VERSION, type ConsentRecord } from '@/lib/privacy/notice';

export function DataUseNotice({
  onConsent,
  onHuman,
  onLeave
}: {
  onConsent: (record: ConsentRecord) => void;
  onHuman: () => void;
  onLeave: () => void;
}) {
  function handleAcknowledge() {
    onConsent({
      consentedAt: new Date().toISOString(),
      consentVersion: CONSENT_VERSION
    });
  }

  return (
    <div data-testid="data-use-notice" className="balance-consent-card">
      <div className="balance-consent-kicker">Balance Assist</div>
      <h3 className="balance-consent-title">
        {DATA_USE_NOTICE_COPY.title}
      </h3>
      <p className="balance-consent-summary">
        {DATA_USE_NOTICE_COPY.summary}
      </p>
      <div className="balance-consent-actions">
        <button type="button" className="balance-entry-action balance-entry-action--primary" aria-label="Build a brief with AI" onClick={handleAcknowledge}>
          <span>Build a brief with AI</span><small>Create a non-confidential project brief</small>
        </button>
        <button type="button" className="balance-entry-action" aria-label="Talk to the team without AI" onClick={onHuman}>
          <span>Talk to the team without AI</span><small>Send a message directly to Balance</small>
        </button>
        <button type="button" className="balance-entry-action balance-entry-action--tertiary" onClick={onLeave}>Leave</button>
      </div>
      <details className="balance-consent-details">
        <summary>
          How your data is handled
        </summary>
        <p>{DATA_USE_NOTICE_COPY.body}</p>
      </details>
      <details className="balance-consent-details">
        <summary>Privacy policy</summary>
        <p>{DATA_USE_NOTICE_COPY.privacy}</p>
        <a href={DATA_USE_NOTICE_COPY.privacyLink}>Read the full privacy policy</a>
      </details>
    </div>
  );
}
