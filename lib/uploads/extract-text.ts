import zlib from 'node:zlib';
import { PRIVATE_ANALYSIS_UPLOAD_POLICY } from '@/lib/uploads/quarantine';

const MAX_PDF_COMPRESSED_STREAM_BYTES = 256 * 1024;
const MAX_PDF_INFLATED_BYTES = 512 * 1024;
const MAX_PDF_TOTAL_INFLATED_BYTES = 1024 * 1024;
const MAX_PDF_STREAMS = 16;

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  dataOffset: number;
};

function getExtension(filename: string): string {
  const trimmed = filename.trim();
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot < 0 || lastDot === trimmed.length - 1) return '';
  return trimmed.slice(lastDot + 1).toLowerCase();
}

// Minimal central-directory-based ZIP reader. OOXML files (.pptx/.docx) are ZIP
// archives of XML parts; we walk the End-of-Central-Directory record to find each
// entry's compressed bytes without pulling in a dependency.
function readZipEntries(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  if (buffer.length < 22) return entries;

  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]); // EOCD
  let eocdOffset = -1;
  const scanFloor = Math.max(0, buffer.length - (65557 + 22));
  for (let i = buffer.length - 22; i >= scanFloor; i--) {
    if (
      buffer[i] === signature[0] &&
      buffer[i + 1] === signature[1] &&
      buffer[i + 2] === signature[2] &&
      buffer[i + 3] === signature[3]
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return entries;

  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  let pos = cdOffset;
  while (pos + 46 <= buffer.length) {
    if (
      buffer[pos] !== 0x50 ||
      buffer[pos + 1] !== 0x4b ||
      buffer[pos + 2] !== 0x01 ||
      buffer[pos + 3] !== 0x02
    ) {
      break;
    }
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const filenameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.slice(pos + 46, pos + 46 + filenameLength).toString('utf8');

    let dataOffset = 0;
    if (localHeaderOffset + 30 <= buffer.length) {
      const localFilenameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      dataOffset = localHeaderOffset + 30 + localFilenameLength + localExtraLength;
    }

    entries.push({ name, method, compressedSize, dataOffset });
    pos += 46 + filenameLength + extraLength + commentLength;
  }
  return entries;
}

function decompressEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  const compressed = buffer.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  if (entry.method === 0) return compressed; // stored, no compression
  if (entry.method === 8) {
    try {
      return zlib.inflateRawSync(compressed);
    } catch {
      return Buffer.alloc(0);
    }
  }
  return Buffer.alloc(0);
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractTagText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    parts.push(decodeXmlEntities(match[1]));
  }
  return parts.join(' ');
}

function extractFromPptx(buffer: Buffer): string {
  const entries = readZipEntries(buffer);
  const slideEntries = entries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.name))
    .sort((a, b) => {
      const na = Number(a.name.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      const nb = Number(b.name.match(/slide(\d+)\.xml/i)?.[1] ?? 0);
      return na - nb;
    });
  const parts: string[] = [];
  for (const entry of slideEntries) {
    const xml = decompressEntry(buffer, entry).toString('utf8');
    const text = extractTagText(xml, 'a:t');
    if (text.trim()) parts.push(text.trim());
  }
  return parts.join('\n');
}

function extractFromDocx(buffer: Buffer): string {
  const entries = readZipEntries(buffer);
  for (const entry of entries) {
    if (/^word\/document\.xml$/i.test(entry.name)) {
      const xml = decompressEntry(buffer, entry).toString('utf8');
      return extractTagText(xml, 'w:t');
    }
  }
  return '';
}

function decodePdfLiteralString(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\(\d{1,3})/g, (_match, octal: string) => {
      const code = parseInt(octal, 8);
      return Number.isFinite(code) ? String.fromCharCode(code & 0xff) : '';
    });
}

function collectPdfOperators(content: string): string[] {
  const parts: string[] = [];
  const literal = /\(([^()\\]*(?:\\.[^()\\]*)*)\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = literal.exec(content)) !== null) {
    parts.push(decodePdfLiteralString(match[1]));
  }
  const arrayForm = /\[((?:\([^()\\]*(?:\\.[^()\\]*)*\)|-?\d+(?:\.\d+)?|\s)*)\]\s*TJ/g;
  while ((match = arrayForm.exec(content)) !== null) {
    const inner = match[1];
    const str = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let sub: RegExpExecArray | null;
    const segments: string[] = [];
    while ((sub = str.exec(inner)) !== null) {
      segments.push(decodePdfLiteralString(sub[1]));
    }
    // Numbers inside a TJ array are kerning adjustments, not word breaks, so the
    // adjacent string fragments belong together (e.g. [(Pr)-10(oject)] -> "Project").
    if (segments.length > 0) {
      parts.push(segments.join(''));
    }
  }
  return parts;
}

function extractFromPdf(buffer: Buffer): string {
  const latin = buffer.toString('latin1');
  // Inflate FlateDecode streams so text in compressed content streams is reachable.
  const inflated: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch: RegExpExecArray | null;
  let totalInflated = 0;
  let streams = 0;
  while ((streamMatch = streamRe.exec(latin)) !== null) {
    if (++streams > MAX_PDF_STREAMS || Buffer.byteLength(streamMatch[1], 'latin1') > MAX_PDF_COMPRESSED_STREAM_BYTES) return '';
    try {
      const output = zlib.inflateSync(Buffer.from(streamMatch[1], 'latin1'), { maxOutputLength: MAX_PDF_INFLATED_BYTES });
      totalInflated += output.byteLength;
      if (totalInflated > MAX_PDF_TOTAL_INFLATED_BYTES) return '';
      inflated.push(output.toString('latin1'));
    } catch (error) {
      if (error instanceof RangeError || (error as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return '';
      // A PDF can contain an uncompressed stream; it is still available through
      // the bounded original buffer fallback below.
    }
  }
  const combined = inflated.length > 0 ? `${inflated.join('\n')}\n${latin}` : latin;
  const operators = collectPdfOperators(combined);
  if (operators.length > 0) {
    return operators.join(' ');
  }
  // Last-resort fallback: keep printable ASCII runs.
  return combined.replace(/[^\x20-\x7E]+/g, ' ');
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractTextFromBuffer(buffer: Buffer, filename: string): string {
  const ext = getExtension(filename);
  let text = '';
  if (ext === 'txt') {
    text = buffer.toString('utf8');
  } else if (ext === 'pdf') {
    text = extractFromPdf(buffer);
  } else if (ext === 'pptx') {
    text = extractFromPptx(buffer);
  } else if (ext === 'docx') {
    text = extractFromDocx(buffer);
  }
  return normalizeWhitespace(text).slice(0, PRIVATE_ANALYSIS_UPLOAD_POLICY.maxExtractedCharacters);
}
