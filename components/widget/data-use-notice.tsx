'use client';

import { useState } from 'react';
import { brandTokens } from '@/lib/brand-tokens';
import { DATA_USE_NOTICE_COPY, CONSENT_VERSION, type ConsentRecord } from '@/lib/privacy/notice';

export function DataUseNotice({ onConsent }: { onConsent: (record: ConsentRecord) => void }) {
  const [agreed, setAgreed] = useState(false);

  function handleAcknowledge() {
    setAgreed(true);
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
      {!agreed && (
        <button
          type="button"
          data-testid="consent-button"
          onClick={handleAcknowledge}
          style={{
            padding: '8px 16px',
            borderRadius: '20px',
            border: 'none',
            background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
            color: '#101010',
            fontSize: '12px',
            fontWeight: 600,
            fontFamily: brandTokens.typography.ui,
            cursor: 'pointer'
          }}
        >
          {DATA_USE_NOTICE_COPY.acknowledgeButton}
        </button>
      )}
    </div>
  );
}
