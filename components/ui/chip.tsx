import type { HTMLAttributes, ReactNode } from 'react';
import { brandTokens } from '@/lib/brand-tokens';

type ChipProps = {
  children: ReactNode;
  active?: boolean;
} & HTMLAttributes<HTMLSpanElement>;

export function Chip({ children, active = false, className = '', style, ...props }: ChipProps) {
  return (
    <span
      className={`inline-flex items-center border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${className}`.trim()}
      style={{
        fontFamily: brandTokens.typography.condensed,
        borderColor: active ? brandTokens.colors.warmGold : brandTokens.colors.border,
        backgroundColor: active ? brandTokens.colors.warmGold : 'transparent',
        color: active ? brandTokens.colors.charcoal : brandTokens.colors.lightText,
        ...style
      }}
      {...props}
    >
      {children}
    </span>
  );
}
