import { ReferenceBoard } from '@/components/widget/reference-board';
import { brandTokens } from '@/lib/brand-tokens';

export default function WidgetPage() {
  return (
    <main
      className="min-h-screen px-6 py-10"
      style={{
        backgroundColor: brandTokens.colors.baseBlack,
        color: brandTokens.colors.lightText,
        fontFamily: brandTokens.typography.ui
      }}
    >
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <p className="text-sm uppercase tracking-[0.34em]" style={{ color: brandTokens.colors.warmGold }}>
            Balance Assist
          </p>
          <h1 className="mt-4 text-4xl font-semibold uppercase tracking-[0.12em]">Reference Widget</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8" style={{ color: brandTokens.colors.mutedText }}>
            A workflow-first proof of concept for project onboarding, file intake, qualification, and human handoff.
          </p>
        </div>
        <ReferenceBoard />
      </div>
    </main>
  );
}
