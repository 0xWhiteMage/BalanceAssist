export type FileQuarantineResult = { ok: true; mime: string } | { ok: false; reason: string };

export const PRIVATE_ANALYSIS_UPLOAD_POLICY = {
  acceptedFormats: ['PNG', 'JPEG', 'GIF', 'WebP', 'PDF', 'TXT', 'CSV'],
  accept: 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv',
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

const ALLOWED_MIMES = PRIVATE_ANALYSIS_UPLOAD_POLICY.accept.split(',');

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
  const bytes = new Uint8Array(buffer);
  const sample = bytes.slice(0, 512);
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0x00) return false;
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b < 0x20 || b > 0x7e) return false;
  }
  return true;
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

  if (detectedMime) {
    if (!ALLOWED_MIMES.includes(detectedMime)) {
      return { ok: false, reason: 'File type not allowed.' };
    }
    return { ok: true, mime: detectedMime };
  }

  if (declaredMime === 'text/plain' && sniffPlainText(buffer)) {
    return { ok: true, mime: 'text/plain' };
  }

  if (declaredMime === 'text/csv' && sniffPlainText(buffer)) {
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
