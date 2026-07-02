import { Card } from '@/components/ui/card';
import { getUploadStatusCopy } from '@/lib/uploads/status';
import type { UploadItem } from '@/lib/uploads/types';

type UploadListProps = {
  uploads: UploadItem[];
};

export function UploadList({ uploads }: UploadListProps) {
  return (
    <Card className="p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white">Uploaded files</p>
      <div className="mt-4 space-y-3">
        {uploads.map((upload) => {
          const status = getUploadStatusCopy(upload.status);

          return (
            <div className="flex items-center justify-between border border-white/10 px-4 py-3" key={upload.id}>
              <div>
                <p className="text-sm font-medium text-white">{upload.name}</p>
                {upload.meta ? <p className="mt-1 text-xs text-white/60">{upload.meta}</p> : null}
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#dbb580]">{status.label}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
