import Link from 'next/link';
import { brandTokens } from '@/lib/brand-tokens';

export default function HomePage() {
  return (
    <main
      className="flex min-h-screen items-center justify-center p-6"
      style={{
        backgroundColor: brandTokens.colors.baseBlack,
        color: brandTokens.colors.lightText,
        fontFamily: brandTokens.typography.ui
      }}
    >
      <section className="flex w-full max-w-3xl flex-col items-center gap-10 text-center">
        <div>
          <p className="text-sm uppercase tracking-[0.34em]" style={{ color: brandTokens.colors.warmGold }}>
            Balance Studio
          </p>
          <h1 className="mt-4 text-5xl font-semibold uppercase tracking-[0.12em]">
            {brandTokens.copy.name}
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-8" style={{ color: brandTokens.colors.mutedText }}>
            {brandTokens.copy.tagline}
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <Link
            href="/preview"
            className="rounded-lg px-8 py-4 text-center text-sm font-semibold uppercase tracking-[0.12em] transition-transform hover:scale-105"
            style={{
              background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
              color: brandTokens.colors.baseBlack,
              fontFamily: brandTokens.typography.condensed
            }}
          >
            Try it on the live site
          </Link>
          <Link
            href="/widget"
            className="rounded-lg border px-8 py-4 text-center text-sm font-semibold uppercase tracking-[0.12em] transition-colors hover:border-white/40"
            style={{
              borderColor: brandTokens.colors.border,
              color: brandTokens.colors.lightText,
              fontFamily: brandTokens.typography.condensed
            }}
          >
            View reference board
          </Link>
        </div>
      </section>
    </main>
  );
}
