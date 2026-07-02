import { Card } from '@/components/ui/card';

export function UploadDropzone() {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white">Share files to help us understand your project</p>
      <div className="mt-4 border border-dashed border-white/20 px-6 py-10 text-center text-sm text-white/70">
        Drop files here or add a Google Drive link
      </div>
    </Card>
  );
}
