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

export const HUMAN_UPLOAD_POLICY = {
  allowedExtensions: ALLOWED_UPLOAD_EXTENSIONS,
  maxFiles: 5,
  maxFileSizeBytes: MAX_UPLOAD_SIZE_BYTES,
  maxTotalSizeBytes: 50 * 1024 * 1024,
  accept: UPLOAD_ACCEPT_ATTRIBUTE
} as const;

export const HUMAN_UPLOAD_GUIDANCE =
  'Accepted: documents, presentations, images, video, audio, design/project files, and archives; up to 5 files, 50 MB each, and 50 MB total. Executables and scripts are blocked.';

export const HUMAN_UPLOAD_SUMMARY = 'Accepted: docs, decks, images, video, audio, design files, archives · 5 files max · 50 MB each · 50 MB total · no executables or scripts.';

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

export function validateHumanUploadBatch(files: Array<{ name: string; size: number }>): {
  ok: boolean;
  reason?: string;
} {
  if (files.length === 0 || files.length > HUMAN_UPLOAD_POLICY.maxFiles) {
    return { ok: false, reason: `Please upload between 1 and ${HUMAN_UPLOAD_POLICY.maxFiles} files.` };
  }
  if (files.some((file) => !validateUploadFile(file).ok)) {
    return { ok: false, reason: 'One or more files are not supported.' };
  }
  if (files.reduce((total, file) => total + file.size, 0) > HUMAN_UPLOAD_POLICY.maxTotalSizeBytes) {
    return { ok: false, reason: 'Total file size exceeds the 50 MB limit.' };
  }
  return { ok: true };
}

export function safeHumanUploadMime(value: string): string {
  if (
    value.length <= 127 &&
    /^(?:application|audio|image|text|video)\/[a-z0-9][a-z0-9.+-]{0,99}$/i.test(value)
  ) {
    return value.toLowerCase();
  }
  return 'application/octet-stream';
}
