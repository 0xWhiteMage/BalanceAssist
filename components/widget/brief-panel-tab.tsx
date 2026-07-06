'use client';
import { useEffect, useRef, useState } from 'react';
import { brandTokens } from '@/lib/brand-tokens';

export function BriefPanelTab({
  open,
  pulse,
  onToggle,
  onFirstReady
}: {
  open: boolean;
  pulse?: boolean;
  onToggle: () => void;
  onFirstReady?: () => void;
}) {
  const firedRef = useRef(false);
  const [pulseActive, setPulseActive] = useState(false);

  useEffect(() => {
    if (pulse && !firedRef.current) {
      firedRef.current = true;
      setPulseActive(true);
      onFirstReady?.();
      const t = window.setTimeout(() => setPulseActive(false), 1200);
      return () => window.clearTimeout(t);
    }
  }, [pulse, onFirstReady]);

  return (
    <>
      <button
        type="button"
        role="button"
        aria-label={open ? 'Close project brief' : 'Open project brief'}
        aria-expanded={open}
        onClick={onToggle}
        data-open={open}
        data-pulse-active={pulseActive}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: 14,
          height: '100%',
          boxSizing: 'border-box',
          padding: 0,
          borderTop: 'none',
          borderRight: 'none',
          borderBottom: 'none',
          borderLeft: `2px solid ${brandTokens.colors.warmGold}`,
          background: pulseActive ? brandTokens.colors.warmGold : brandTokens.colors.charcoal,
          color: brandTokens.colors.lightText,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 200ms ease',
          zIndex: 50
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            fontSize: 12,
            lineHeight: 1,
            fontFamily: brandTokens.typography.ui
          }}
        >
          {open ? '›' : '‹'}
        </span>
        <svg
          aria-hidden="true"
          width="8"
          height="10"
          viewBox="0 0 8 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none' }}
        >
          {open ? <path d="M2 2 L6 5 L2 8" /> : <path d="M6 2 L2 5 L6 8" />}
        </svg>
      </button>
      {pulseActive && (
        <div
          role="tooltip"
          aria-hidden={!pulseActive}
          data-brief-tab-tooltip
          style={{
            position: 'absolute',
            right: 22,
            top: '50%',
            transform: 'translateY(-50%)',
            background: brandTokens.colors.warmGold,
            color: brandTokens.colors.charcoal,
            fontFamily: brandTokens.typography.ui,
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '0.02em',
            padding: '5px 10px',
            borderRadius: 999,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 50,
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)'
          }}
        >
          Review brief
        </div>
      )}
      {pulseActive && (
        <style>{`[data-pulse-active="true"] { animation: brief-tab-pulse 1.2s ease-out; }
          @keyframes brief-tab-pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.18); box-shadow: 0 0 18px ${brandTokens.colors.warmGold}; }
            100% { transform: scale(1); }
          }
          [data-brief-tab-tooltip] {
            animation: brief-tab-tooltip 1.2s ease-out forwards;
          }
          @keyframes brief-tab-tooltip {
            0% { opacity: 0; transform: translateY(calc(-50% + 4px)); }
            15% { opacity: 1; transform: translateY(-50%); }
            80% { opacity: 1; transform: translateY(-50%); }
            100% { opacity: 0; transform: translateY(calc(-50% - 4px)); }
          }`}</style>
      )}
    </>
  );
}
