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
  'Accepted: documents, presentations, images, video, audio, design/project files, and archives; up to 5 files, 50 MB each, and 50 MB total. Known executable and script file types and signatures are blocked. Archives are not malware-scanned; send only trusted files.';

export const HUMAN_UPLOAD_SUMMARY = 'Accepted: docs, decks, images, video, audio, design files, archives · 5 files max · 50 MB each · 50 MB total · known executable/script types and signatures blocked · archives not malware-scanned; send only trusted files.';

const HUMAN_PREFLIGHT_PREFIX_BYTES = 4096;
const BLOCKED_HUMAN_UPLOAD_MIMES = new Set([
  'application/java-vm',
  'application/javascript',
  'application/vnd.microsoft.portable-executable',
  'application/x-dosexec',
  'application/x-elf',
  'application/x-executable',
  'application/x-java-applet',
  'application/x-mach-binary',
  'application/x-msdownload',
  'application/x-pie-executable',
  'application/x-powershell',
  'application/x-sh',
  'application/x-sharedlib',
  'application/x-shellscript',
  'application/x-python',
  'text/javascript',
  'text/x-python',
  'text/x-shellscript'
]);

const BLOCKED_HUMAN_UPLOAD_MAGICS = [
  [0x4d, 0x5a],
  [0x7f, 0x45, 0x4c, 0x46],
  [0xfe, 0xed, 0xfa, 0xce],
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe],
  [0xbe, 0xba, 0xfe, 0xca],
  [0xca, 0xfe, 0xba, 0xbf],
  [0xbf, 0xba, 0xfe, 0xca]
] as const;

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

export function hasBlockedHumanUploadContent(declaredMime: string, buffer: ArrayBuffer): boolean {
  const mime = declaredMime.split(';', 1)[0].trim().toLowerCase();
  if (BLOCKED_HUMAN_UPLOAD_MIMES.has(mime)) return true;

  const prefix = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, HUMAN_PREFLIGHT_PREFIX_BYTES));
  const startsWith = (magic: readonly number[]) =>
    magic.length <= prefix.length && magic.every((byte, index) => prefix[index] === byte);

  if (BLOCKED_HUMAN_UPLOAD_MAGICS.some(startsWith)) return true;
  return startsWith([0x23, 0x21]) || startsWith([0xef, 0xbb, 0xbf, 0x23, 0x21]);
}
