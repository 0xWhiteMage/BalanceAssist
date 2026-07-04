export const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024;
export const UPLOAD_BUCKET_NAME = 'balance-assist-uploads';

export const ALLOWED_UPLOAD_EXTENSIONS = [
  'pdf',
  'ppt',
  'pptx',
  'key',
  'doc',
  'docx',
  'pages',
  'xls',
  'xlsx',
  'numbers',
  'txt',
  'rtf',
  'csv',
  'odp',
  'ods',
  'odt',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'svg',
  'tif',
  'tiff',
  'bmp',
  'webp',
  'heic',
  'heif',
  'psd',
  'ai',
  'eps',
  'ico',
  'indd',
  'idml',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'wmv',
  'flv',
  'webm',
  'm4v',
  'mpg',
  'mpeg',
  'm2ts',
  'vob',
  '3gp',
  'mts',
  'mp3',
  'wav',
  'aac',
  'flac',
  'ogg',
  'm4a',
  'aiff',
  'aif',
  'wma',
  'mid',
  'midi',
  'opus',
  'aep',
  'prproj',
  'drp',
  'drpx',
  'fcpxml',
  'sketch',
  'fig',
  'xd',
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  'ttf',
  'otf',
  'woff',
  'woff2'
] as const;

export const UPLOAD_ACCEPT_ATTRIBUTE = ALLOWED_UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(',');

export const HUMAN_UPLOAD_GUIDANCE =
  'Accepted: documents, presentations, images, video, audio, design/project files, and archives up to 50 MB. Executables and scripts are blocked.';

export const HUMAN_UPLOAD_SUMMARY = 'Accepted: docs, decks, images, video, audio, design files, archives · max 50 MB · no executables or scripts.';

function getExtension(filename: string): string {
  const trimmed = filename.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot < 0 || lastDot === trimmed.length - 1) {
    return '';
  }
  return trimmed.slice(lastDot + 1).toLowerCase();
}

export function validateUploadFile(file: { name: string; size: number }): {
  ok: boolean;
  reason?: string;
} {
  const ext = getExtension(file.name);

  if (!ext || !ALLOWED_UPLOAD_EXTENSIONS.includes(ext as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number])) {
    return {
      ok: false,
      reason:
        'That file type is not supported. Please upload a document, presentation, image, video, audio, design file, or archive.'
    };
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      ok: false,
      reason: 'That file is too large. Please keep uploads under 50 MB.'
    };
  }

  return { ok: true };
}
