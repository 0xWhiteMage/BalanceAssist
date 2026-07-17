'use client';

import { useEffect, useRef, useState } from 'react';
import { brandTokens } from '@/lib/brand-tokens';
import { useDialogFocus } from '@/components/widget/use-dialog-focus';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fallbackFrameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [fallback, setFallback] = useState(false);
  useDialogFocus({ active: true, dialogRef, onDismiss: onBack });

  useEffect(() => {
    setLoaded(false);
    setFallback(false);

    let scriptLoadStarted = false;
    let inlineLoaded = false;

    const initWidget = () => {
      if (containerRef.current && window.Calendly && !inlineLoaded) {
        containerRef.current.innerHTML = '';
        window.Calendly.initInlineWidget({
          url,
          parentElement: containerRef.current
        });
        inlineLoaded = true;
        setLoaded(true);
      }
    };

    if (window.Calendly) {
      initWidget();
    } else {
      const existing = document.querySelector('script[src*="calendly"]');

      if (!existing) {
        scriptLoadStarted = true;
        const script = document.createElement('script');
        script.src = 'https://assets.calendly.com/assets/external/widget.js';
        script.async = true;
        script.onload = () => setTimeout(initWidget, 100);
        script.onerror = () => {
          if (!inlineLoaded) {
            inlineLoaded = true;
            setLoaded(true);
            setFallback(true);
          }
        };
        document.head.appendChild(script);
      } else {
        existing.addEventListener('load', () => setTimeout(initWidget, 100));
      }
    }

    const fallbackTimer = window.setTimeout(() => {
      if (!inlineLoaded) {
        inlineLoaded = true;
        setLoaded(true);
        setFallback(true);
      }
    }, 1500);

    return () => {
      clearTimeout(fallbackTimer);
      if (scriptLoadStarted) {
        // intentionally keep the script tag for subsequent mounts; nothing to clean up
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const ALLOWED_ORIGINS = ['https://calendly.com', 'https://assets.calendly.com'];

    const listener = (event: MessageEvent) => {
      if (!ALLOWED_ORIGINS.includes(event.origin)) {
        return;
      }

      const inlineFrame = containerRef.current?.querySelector('iframe');
      const expectedSource = fallbackFrameRef.current?.contentWindow ?? inlineFrame?.contentWindow ?? null;
      if (!expectedSource || event.source !== expectedSource) {
        return;
      }

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
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendly-dialog-title"
      tabIndex={-1}
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
          className="balance-widget-action"
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
          <p id="calendly-dialog-title" style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: brandTokens.colors.lightText }}>
            Book a Discovery Call
          </p>
          <p style={{ margin: 0, fontSize: '11px', color: brandTokens.colors.mutedText }}>
            15 min · Video call
          </p>
        </div>
      </header>

        <div style={{ flex: 1, position: 'relative', overflow: 'auto', minWidth: 0 }}>
        {!loaded && (
          <div
            role="status"
            aria-live="polite"
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
        {fallback ? (
          <iframe
            ref={fallbackFrameRef}
            data-testid="calendly-fallback-iframe"
            src={url}
            title="Book a Discovery Call"
            tabIndex={0}
            style={{ minWidth: 0, height: '100%', width: '100%', border: 'none' }}
          />
        ) : (
          <div
            ref={containerRef}
            className="calendly-inline-widget"
            style={{ minWidth: 0, height: '100%', width: '100%' }}
          />
        )}
      </div>
    </div>
  );
}
