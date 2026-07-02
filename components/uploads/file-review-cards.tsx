import { Card } from '@/components/ui/card';

type FileReviewCardsProps = {
  sourceSummary: string;
  inferredSummary: string;
};

export function FileReviewCards({ sourceSummary, inferredSummary }: FileReviewCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white">From your file</p>
        <p className="mt-3 text-sm leading-6 text-white/70">{sourceSummary}</p>
      </Card>
      <Card className="p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white">My inference</p>
        <p className="mt-3 text-sm leading-6 text-white/70">{inferredSummary}</p>
      </Card>
    </div>
  );
}
