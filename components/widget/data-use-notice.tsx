'use client';

import { brandTokens } from '@/lib/brand-tokens';
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
    <div
      data-testid="data-use-notice"
      style={{
        padding: '16px',
        borderBottom: `1px solid ${brandTokens.colors.subtleBorder}`
      }}
    >
      <h3
        style={{
          margin: '0 0 8px',
          fontSize: '14px',
          fontWeight: 600,
          color: brandTokens.colors.lightText,
          fontFamily: brandTokens.typography.ui
        }}
      >
        {DATA_USE_NOTICE_COPY.title}
      </h3>
      <p
        style={{
          margin: '0 0 12px',
          fontSize: '12px',
          lineHeight: '1.5',
          color: brandTokens.colors.mutedText,
          fontFamily: brandTokens.typography.ui
        }}
      >
        {DATA_USE_NOTICE_COPY.summary}
      </p>
      <details style={{ marginBottom: 12, color: brandTokens.colors.mutedText, fontSize: 11, lineHeight: 1.5 }}>
        <summary style={{ minHeight: 32, padding: '7px 0', cursor: 'pointer', color: brandTokens.colors.lightText }}>
          How your data is handled
        </summary>
        <p style={{ margin: '4px 0 0' }}>{DATA_USE_NOTICE_COPY.body}</p>
      </details>
      <a
        href={DATA_USE_NOTICE_COPY.privacyLink}
        style={{
          display: 'inline-block',
          marginBottom: '12px',
          fontSize: '12px',
          color: brandTokens.colors.warmGold,
          fontFamily: brandTokens.typography.ui,
          textDecoration: 'underline',
          textUnderlineOffset: '2px'
        }}
      >
        {DATA_USE_NOTICE_COPY.privacyLinkLabel}
      </a>
      <p style={{ margin: '0 0 10px', fontSize: 11, lineHeight: 1.5, color: brandTokens.colors.mutedText }}>
        Choosing AI accepts this use for the temporary brief. You will review it before anything is sent to Balance.
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        <button type="button" className="balance-entry-action balance-entry-action--primary" onClick={handleAcknowledge} style={entryActionStyle}>Build a brief with AI</button>
        <button type="button" className="balance-entry-action" onClick={onHuman} style={entryActionStyle}>Talk to the team without AI</button>
        <button type="button" className="balance-entry-action balance-entry-action--tertiary" onClick={onLeave} style={entryActionStyle}>Leave</button>
      </div>
    </div>
  );
}

const entryActionStyle = {
  width: '100%',
  minHeight: '44px',
  padding: '10px 16px',
  borderRadius: '20px',
  border: `1px solid ${brandTokens.colors.warmGold}`,
  background: 'transparent',
  color: brandTokens.colors.lightText,
  fontSize: '12px',
  fontWeight: 600,
  fontFamily: brandTokens.typography.ui,
  cursor: 'pointer'
};
