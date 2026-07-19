// @vitest-environment node
import { describe, expect, test } from 'vitest';
import {
  MEDIA_MAX_ATTEMPTS,
  MEDIA_MAX_IMAGE_PIXELS,
  MEDIA_MAX_PDF_PAGES,
  MEDIA_MAX_THUMBNAIL_BYTES,
  MEDIA_MAX_VIDEO_SECONDS,
  MEDIA_OCR_MAX_BYTES,
  MEDIA_VIDEO_MAX_BYTES,
  mediaJobStateSchema,
  mediaObjectKey,
  mediaUploadCompleteSchema,
  mediaUploadIntentSchema
} from '@/lib/media/contracts';

describe('media web contracts', () => {
  test('accepts only bounded operation and MIME combinations', () => {
    expect(mediaUploadIntentSchema.safeParse({ operation: 'ocr', mimeType: 'application/pdf', sizeBytes: MEDIA_OCR_MAX_BYTES }).success).toBe(true);
    expect(mediaUploadIntentSchema.safeParse({ operation: 'image_visual', mimeType: 'image/png', sizeBytes: 1024 }).success).toBe(true);
    expect(mediaUploadIntentSchema.safeParse({ operation: 'video_visual', mimeType: 'video/mp4', sizeBytes: MEDIA_VIDEO_MAX_BYTES }).success).toBe(true);
    expect(mediaUploadIntentSchema.safeParse({ operation: 'video_visual', mimeType: 'video/mp4', sizeBytes: MEDIA_VIDEO_MAX_BYTES + 1 }).success).toBe(false);
    expect(mediaUploadIntentSchema.safeParse({ operation: 'ocr', mimeType: 'image/png', sizeBytes: MEDIA_OCR_MAX_BYTES + 1 }).success).toBe(false);
    expect(mediaUploadIntentSchema.safeParse({ operation: 'image_visual', mimeType: 'video/mp4', sizeBytes: 1024 }).success).toBe(false);
  });

  test('uses UUID-only completion IDs and opaque object keys', () => {
    expect(mediaUploadCompleteSchema.safeParse({ jobId: '11111111-2222-4333-8444-555555555555' }).success).toBe(true);
    expect(mediaUploadCompleteSchema.safeParse({ jobId: '../source.mov' }).success).toBe(false);
    expect(mediaObjectKey()).toMatch(/^media\/[0-9a-f]{2}\/[0-9a-f-]{36}$/);
  });

  test('publishes the initial worker limits and bounded states', () => {
    expect({ MEDIA_MAX_ATTEMPTS, MEDIA_MAX_IMAGE_PIXELS, MEDIA_MAX_PDF_PAGES, MEDIA_MAX_THUMBNAIL_BYTES, MEDIA_MAX_VIDEO_SECONDS }).toEqual({
      MEDIA_MAX_ATTEMPTS: 3,
      MEDIA_MAX_IMAGE_PIXELS: 25_000_000,
      MEDIA_MAX_PDF_PAGES: 20,
      MEDIA_MAX_THUMBNAIL_BYTES: 250 * 1024,
      MEDIA_MAX_VIDEO_SECONDS: 600
    });
    expect(mediaJobStateSchema.safeParse('succeeded').success).toBe(true);
    expect(mediaJobStateSchema.safeParse('running_forever').success).toBe(false);
  });
});
