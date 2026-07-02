export type UploadStatus = 'uploaded' | 'reading' | 'parsed' | 'needs_human_review';

export type UploadItem = {
  id: string;
  name: string;
  status: UploadStatus;
  meta?: string;
};
