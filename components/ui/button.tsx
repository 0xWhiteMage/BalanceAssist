import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { brandTokens } from '@/lib/brand-tokens';

type ButtonVariant = 'primary' | 'secondary';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
  fullWidth?: boolean;
};

const baseClassName =
  'inline-flex items-center justify-center gap-2 border px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] transition-colors';

export function Button({
  children,
  className = '',
  fullWidth = false,
  style,
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  const palette =
    variant === 'primary'
      ? {
          borderColor: brandTokens.colors.warmGold,
          backgroundColor: brandTokens.colors.warmGold,
          color: brandTokens.colors.charcoal
        }
      : {
          borderColor: brandTokens.colors.border,
          backgroundColor: 'transparent',
          color: brandTokens.colors.lightText
        };

  const mergedStyle = {
    fontFamily: brandTokens.typography.condensed,
    ...palette,
    ...style
  };

  return (
    <button
      className={`${baseClassName} ${fullWidth ? 'w-full' : ''} ${className}`.trim()}
      style={mergedStyle}
      type={type}
      {...props}
    >
      {children}
    </button>
  );
}
