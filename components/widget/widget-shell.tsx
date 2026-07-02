import type { ReactNode } from 'react';
import { brandTokens } from '@/lib/brand-tokens';
import { WidgetFooter } from '@/components/widget/widget-footer';
import { WidgetHeader } from '@/components/widget/widget-header';

type WidgetShellProps = {
  children: ReactNode;
};

export function WidgetShell({ children }: WidgetShellProps) {
  return (
    <section
      className="flex min-h-[640px] w-full max-w-[420px] flex-col border"
      style={{
        fontFamily: brandTokens.typography.ui,
        borderColor: brandTokens.colors.border,
        background: brandTokens.gradients.panel,
        color: brandTokens.colors.lightText,
        boxShadow: brandTokens.shadows.panel
      }}
    >
      <WidgetHeader />
      <div className="flex-1 px-5 py-4">{children}</div>
      <WidgetFooter />
    </section>
  );
}
