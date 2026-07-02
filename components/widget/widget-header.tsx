import { brandTokens } from '@/lib/brand-tokens';

export function WidgetHeader() {
  return (
    <header className="border-b px-5 py-4" style={{ borderColor: brandTokens.colors.subtleBorder }}>
      <p className="text-[11px] font-medium uppercase tracking-[0.32em]" style={{ color: brandTokens.colors.warmGold }}>
        Back
      </p>
      <h1
        className="mt-3 text-xl font-semibold uppercase tracking-[0.12em]"
        style={{ color: brandTokens.colors.lightText, fontFamily: brandTokens.typography.ui }}
      >
        {brandTokens.copy.name}
      </h1>
      <p className="mt-2 max-w-xs text-sm leading-6" style={{ color: brandTokens.colors.mutedText }}>
        {brandTokens.copy.description}
      </p>
    </header>
  );
}
