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
          border: 'none',
          background: pulseActive ? brandTokens.colors.warmGold : brandTokens.colors.charcoal,
          color: brandTokens.colors.lightText,
          cursor: 'pointer',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background 200ms ease',
          zIndex: 20
        }}
      >
        {open ? '›' : '‹'}
      </button>
      {pulseActive && (
        <style>{`[data-pulse-active="true"] { animation: brief-tab-pulse 1.2s ease-out; } @keyframes brief-tab-pulse { 0% { transform: scale(1); } 50% { transform: scale(1.18); box-shadow: 0 0 18px ${brandTokens.colors.warmGold}; } 100% { transform: scale(1); } }`}</style>
      )}
    </>
  );
}
