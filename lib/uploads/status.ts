import type { UploadStatus } from '@/lib/uploads/types';

const statusCopy: Record<UploadStatus, { label: string; tone: 'neutral' | 'success' | 'warning' }> = {
  uploaded: { label: 'Uploaded', tone: 'neutral' },
  reading: { label: 'Reading', tone: 'warning' },
  parsed: { label: 'Parsed', tone: 'success' },
  needs_human_review: { label: 'Needs human review', tone: 'warning' }
};

export function getUploadStatusCopy(status: UploadStatus) {
  return statusCopy[status];
}
