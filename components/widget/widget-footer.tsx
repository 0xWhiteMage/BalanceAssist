import { brandTokens } from '@/lib/brand-tokens';
import { Button } from '@/components/ui/button';

export function WidgetFooter() {
  return (
    <footer className="mt-auto border-t px-5 py-4" style={{ borderColor: brandTokens.colors.border }}>
      <Button fullWidth variant="secondary">
        {brandTokens.copy.humanCta}
      </Button>
    </footer>
  );
}
