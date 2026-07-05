'use client';

import { useEffect, useRef, useState } from 'react';
import { brandTokens } from '@/lib/brand-tokens';

type CalendlyEmbedProps = {
  url: string;
  onBack: () => void;
  onScheduled?: () => void;
};

declare global {
  interface Window {
    Calendly?: {
      initInlineWidget: (options: { url: string; parentElement: HTMLElement }) => void;
    };
  }
}

export function CalendlyEmbed({ url, onBack, onScheduled }: CalendlyEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const initWidget = () => {
      if (containerRef.current && window.Calendly) {
        containerRef.current.innerHTML = '';
        window.Calendly.initInlineWidget({
          url: `${url}?hide_gdpr_banner=1&primary_color=${brandTokens.colors.warmGold.replace('#', '')}`,
          parentElement: containerRef.current
        });
        setLoaded(true);
      }
    };

    if (window.Calendly) {
      initWidget();
    } else {
      const existing = document.querySelector('script[src*="calendly"]');

      if (!existing) {
        const script = document.createElement('script');
        script.src = 'https://assets.calendly.com/assets/external/widget.js';
        script.async = true;
        script.onload = () => setTimeout(initWidget, 100);
        document.head.appendChild(script);
      } else {
        existing.addEventListener('load', () => setTimeout(initWidget, 100));
      }
    }

    const timer = setTimeout(() => {
      if (!loaded) setLoaded(true);
    }, 3000);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (typeof event.data?.event !== 'string') {
        return;
      }

      if (event.data.event === 'calendly.event_scheduled') {
        onScheduled?.();
      }
    };

    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [onScheduled]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        background: brandTokens.gradients.panel,
        borderRadius: '16px',
        overflow: 'hidden'
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '14px 18px',
          borderBottom: `1px solid ${brandTokens.colors.subtleBorder}`,
          flexShrink: 0,
          background: 'rgba(16, 16, 16, 0.8)'
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: 'none',
            border: 'none',
            color: brandTokens.colors.warmGold,
            cursor: 'pointer',
            fontSize: '20px',
            padding: 0,
            lineHeight: 1
          }}
          aria-label="Back to chat"
        >
          &#8249;
        </button>
        <div>
          <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: brandTokens.colors.lightText }}>
            Book a Discovery Call
          </p>
          <p style={{ margin: 0, fontSize: '11px', color: brandTokens.colors.mutedText }}>
            30 min · Video call
          </p>
        </div>
      </header>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {!loaded && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: brandTokens.colors.mutedText,
              fontSize: '13px'
            }}
          >
            Loading calendar...
          </div>
        )}
        <div
          ref={containerRef}
          className="calendly-inline-widget"
          style={{ minWidth: '320px', height: '100%', width: '100%' }}
        />
      </div>
    </div>
  );
}
