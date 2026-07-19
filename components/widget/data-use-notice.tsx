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
          <span className="balance-entry-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M12 3l1.35 4.1L17.5 8.5l-4.15 1.4L12 14l-1.35-4.1L6.5 8.5l4.15-1.4L12 3zM18.5 14l.75 2.25L21.5 17l-2.25.75L18.5 20l-.75-2.25L15.5 17l2.25-.75L18.5 14z" /></svg>
          </span>
          <span className="balance-entry-copy"><strong>Build a brief with AI</strong><small>Create a non-confidential project brief</small></span>
          <span className="balance-entry-arrow" aria-hidden="true">&rarr;</span>
        </button>
        <button type="button" className="balance-entry-action" aria-label="Talk to the team without AI" onClick={onHuman}>
          <span className="balance-entry-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 17l-2 4 5-2h8a5 5 0 005-5V8a5 5 0 00-5-5H8a5 5 0 00-5 5v6a5 5 0 002 3z" /></svg>
          </span>
          <span className="balance-entry-copy"><strong>Talk to the team without AI</strong><small>Send a message directly to Balance</small></span>
          <span className="balance-entry-arrow" aria-hidden="true">&rarr;</span>
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
