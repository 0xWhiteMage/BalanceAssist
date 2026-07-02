import type { HTMLAttributes, ReactNode } from 'react';
import { brandTokens } from '@/lib/brand-tokens';

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function Card({ children, className = '', ...props }: CardProps) {
  const { style, ...restProps } = props;
  const mergedStyle = {
    color: brandTokens.colors.lightText,
    fontFamily: brandTokens.typography.ui,
    borderColor: brandTokens.colors.border,
    backgroundColor: brandTokens.colors.panelSurface,
    ...style
  };

  return (
    <div
      className={`border ${className}`.trim()}
      style={mergedStyle}
      {...restProps}
    >
      {children}
    </div>
  );
}
