import { brandTokens } from '@/lib/brand-tokens';

export function TypingDots() {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '12px 16px',
        borderRadius: '16px 16px 16px 4px',
        background: 'rgba(255, 255, 255, 0.06)',
        border: `1px solid ${brandTokens.colors.subtleBorder}`
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: '7px',
            height: '7px',
            borderRadius: '50%',
            background: brandTokens.colors.warmGold,
            opacity: 0.4,
            animation: `balance-assist-typing 1.2s ease-in-out ${i * 0.2}s infinite`
          }}
        />
      ))}
      <style>{`
        @keyframes balance-assist-typing {
          0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-3px); }
        }
      `}</style>
    </div>
  );
}
