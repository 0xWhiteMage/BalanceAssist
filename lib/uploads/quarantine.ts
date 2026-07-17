export type FileQuarantineResult = { ok: true; mime: string } | { ok: false; reason: string };

export const PRIVATE_ANALYSIS_UPLOAD_POLICY = {
  acceptedFormats: ['PNG', 'JPEG', 'GIF', 'WebP', 'PDF', 'TXT', 'CSV'],
  accept: 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,.txt,.csv',
  maxFiles: 5,
  maxFileSizeBytes: 10 * 1024 * 1024,
  maxTotalSizeBytes: 25 * 1024 * 1024,
  maxExtractedCharacters: 4000
} as const;

const {
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  maxTotalSizeBytes: MAX_TOTAL_SIZE_BYTES,
  maxFiles: MAX_FILES
} = PRIVATE_ANALYSIS_UPLOAD_POLICY;

const ALLOWED_MIMES = PRIVATE_ANALYSIS_UPLOAD_POLICY.accept.split(',').filter((value) => !value.startsWith('.'));
const COMMON_TEXT_MIMES = ['', 'application/octet-stream'] as const;

const MAGIC_BYTES: Array<{ mime: string; bytes: number[] }> = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
];

function detectMimeFromBytes(buffer: ArrayBuffer): string | null {
  const bytes = new Uint8Array(buffer.slice(0, 16));

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  for (const { mime, bytes: magic } of MAGIC_BYTES) {
    if (magic.length > bytes.length) continue;
    let match = true;
    for (let i = 0; i < magic.length; i++) {
      if (bytes[i] !== magic[i]) {
        match = false;
        break;
      }
    }
    if (match) return mime;
  }
  return null;
}

function sniffPlainText(buffer: ArrayBuffer): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer));
  } catch {
    return false;
  }
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(text);
}

function getExtension(filename: string): string {
  const lastDot = filename.trim().lastIndexOf('.');
  return lastDot < 0 ? '' : filename.trim().slice(lastDot + 1).toLowerCase();
}

export function validateFile(file: File, buffer: ArrayBuffer): FileQuarantineResult {
  if (file.size === 0) {
    return { ok: false, reason: 'File is empty.' };
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, reason: `File is too large. Maximum size is 10 MB.` };
  }

  const detectedMime = detectMimeFromBytes(buffer);
  const declaredMime = file.type || '';
  const extension = getExtension(file.name);

  if (detectedMime) {
    if (!ALLOWED_MIMES.includes(detectedMime)) {
      return { ok: false, reason: 'File type not allowed.' };
    }
    return { ok: true, mime: detectedMime };
  }

  if (
    extension === 'txt' &&
    (declaredMime === 'text/plain' || COMMON_TEXT_MIMES.includes(declaredMime as (typeof COMMON_TEXT_MIMES)[number])) &&
    sniffPlainText(buffer)
  ) {
    return { ok: true, mime: 'text/plain' };
  }

  if (
    extension === 'csv' &&
    ['text/csv', 'application/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', ...COMMON_TEXT_MIMES].includes(declaredMime) &&
    sniffPlainText(buffer)
  ) {
    return { ok: true, mime: 'text/csv' };
  }

  return { ok: false, reason: 'Could not verify file type. Please re-export the file.' };
}

export function validateFileBatch(
  files: Array<{ file: File; buffer: ArrayBuffer }>
): { ok: boolean; reason?: string } {
  if (files.length === 0) {
    return { ok: false, reason: 'No files provided.' };
  }

  if (files.length > MAX_FILES) {
    return { ok: false, reason: `Too many files. Maximum is ${MAX_FILES}.` };
  }

  let totalSize = 0;
  for (const { buffer } of files) {
    totalSize += buffer.byteLength;
  }

  if (totalSize > MAX_TOTAL_SIZE_BYTES) {
    return { ok: false, reason: `Total file size exceeds 25 MB limit.` };
  }

  return { ok: true };
}
