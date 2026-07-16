'use client';

import { useState } from 'react';
import { brandTokens } from '@/lib/brand-tokens';
import { DATA_USE_NOTICE_COPY, CONSENT_VERSION, type ConsentRecord } from '@/lib/privacy/notice';

export function DataUseNotice({
  onConsent,
  onHuman,
  onLeave
}: {
  onConsent: (record: ConsentRecord) => void;
  onHuman?: () => void;
  onLeave?: () => void;
}) {
  const [showAiDisclosure, setShowAiDisclosure] = useState(false);

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
        {DATA_USE_NOTICE_COPY.body}
      </p>
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
      {showAiDisclosure ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: brandTokens.colors.lightText }}>
            {DATA_USE_NOTICE_COPY.aiDisclosure}
          </p>
          <button type="button" onClick={handleAcknowledge} style={primaryButtonStyle}>
            Continue with AI
          </button>
          <button type="button" onClick={onHuman} style={secondaryButtonStyle}>
            Talk to the team without AI
          </button>
          <button type="button" onClick={onLeave} style={secondaryButtonStyle}>Leave</button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <button type="button" onClick={() => setShowAiDisclosure(true)} style={primaryButtonStyle}>Build a brief with AI</button>
          <button type="button" onClick={onHuman} style={secondaryButtonStyle}>Talk to the team without AI</button>
          <button type="button" onClick={onLeave} style={secondaryButtonStyle}>Leave</button>
        </div>
      )}
    </div>
  );
}

const primaryButtonStyle = {
  padding: '8px 16px', borderRadius: '20px', border: 'none',
  background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
  color: '#101010', fontSize: '12px', fontWeight: 600, fontFamily: brandTokens.typography.ui, cursor: 'pointer'
};

const secondaryButtonStyle = {
  ...primaryButtonStyle,
  background: 'transparent', border: `1px solid ${brandTokens.colors.border}`, color: brandTokens.colors.lightText
};
