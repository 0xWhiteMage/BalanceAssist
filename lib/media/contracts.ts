import { z } from 'zod';

export const MEDIA_OCR_MAX_BYTES = 10 * 1024 * 1024;
export const MEDIA_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const MEDIA_MAX_IMAGE_PIXELS = 25_000_000;
export const MEDIA_MAX_PDF_PAGES = 20;
export const MEDIA_MAX_VIDEO_SECONDS = 10 * 60;
export const MEDIA_MAX_THUMBNAIL_BYTES = 250 * 1024;
export const MEDIA_MAX_THUMBNAIL_EDGE = 512;
export const MEDIA_MAX_ATTEMPTS = 3;
export const MEDIA_API_BODY_MAX_BYTES = 8 * 1024;
export const MEDIA_THUMBNAIL_URL_SECONDS = 60;

export const mediaOperationSchema = z.enum(['ocr', 'image_visual', 'video_visual']);
export const mediaJobStateSchema = z.enum([
  'awaiting_upload',
  'queued',
  'claimed',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
  'expired'
]);

const supportedImageMimeSchema = z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/tiff']);
const supportedVideoMimeSchema = z.enum(['video/mp4', 'video/quicktime', 'video/webm']);

export const mediaUploadIntentSchema = z.object({
  operation: mediaOperationSchema,
  mimeType: z.string().trim().toLowerCase(),
  sizeBytes: z.number().int().positive().max(MEDIA_VIDEO_MAX_BYTES)
}).superRefine((value, context) => {
  const isImage = supportedImageMimeSchema.safeParse(value.mimeType).success;
  const isVideo = supportedVideoMimeSchema.safeParse(value.mimeType).success;
  const validType = value.operation === 'video_visual'
    ? isVideo
    : isImage || (value.operation === 'ocr' && value.mimeType === 'application/pdf');
  const maxBytes = value.operation === 'video_visual' ? MEDIA_VIDEO_MAX_BYTES : MEDIA_OCR_MAX_BYTES;
  if (!validType) context.addIssue({ code: 'custom', message: 'Unsupported media type for operation' });
  if (value.sizeBytes > maxBytes) context.addIssue({ code: 'too_big', maximum: maxBytes, inclusive: true, type: 'number' });
});

export const mediaUploadCompleteSchema = z.object({
  jobId: z.string().uuid()
});

export const mediaJobIdSchema = z.string().uuid();

export type MediaOperation = z.infer<typeof mediaOperationSchema>;
export type MediaJobState = z.infer<typeof mediaJobStateSchema>;
export type MediaUploadIntent = z.infer<typeof mediaUploadIntentSchema>;

export function mediaObjectKey(): string {
  const id = crypto.randomUUID();
  return `media/${id.slice(0, 2)}/${id}`;
}
