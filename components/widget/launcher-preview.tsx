import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { brandTokens } from '@/lib/brand-tokens';

export function LauncherPreview() {
  return (
    <Card className="w-full max-w-[320px] p-4" style={{ color: brandTokens.colors.lightText }}>
      <p className="text-[11px] font-medium uppercase tracking-[0.32em]" style={{ color: brandTokens.colors.warmGold }}>
        {brandTokens.copy.name}
      </p>
      <p className="mt-3 text-sm leading-6" style={{ color: brandTokens.colors.mutedText }}>
        {brandTokens.copy.tagline}
      </p>
      <div className="mt-4 space-y-3">
        <Button fullWidth>{brandTokens.copy.primaryCta}</Button>
        <Button fullWidth variant="secondary">
          {brandTokens.copy.humanCta}
        </Button>
      </div>
    </Card>
  );
}
