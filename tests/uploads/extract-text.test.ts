// @vitest-environment node
import { describe, expect, test } from 'vitest';
import zlib from 'node:zlib';
import { extractTextFromBuffer } from '@/lib/uploads/extract-text';

// Standard CRC32 (polynomial 0xEDB88320) so the test fixtures are well-formed ZIPs.
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Build a minimal but well-formed ZIP from a filename -> content map. Each entry
// is raw-deflate compressed, which is what real OOXML files use.
function buildMinimalZip(files: Record<string, string>): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  const names = Object.keys(files);

  for (const name of names) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(files[name], 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // compression method = deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x0021, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localChunks.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(8, 10); // method
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0x0021, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const localData = Buffer.concat(localChunks);
  const centralData = Buffer.concat(centralChunks);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with cd
  eocd.writeUInt16LE(names.length, 8); // entries on this disk
  eocd.writeUInt16LE(names.length, 10); // total entries
  eocd.writeUInt32LE(centralData.length, 12); // central directory size
  eocd.writeUInt32LE(localData.length, 16); // central directory offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localData, centralData, eocd]);
}

describe('extractTextFromBuffer', () => {
  test('extracts plain text from a .txt file', () => {
    const buffer = Buffer.from('Project: 30s animation\nBudget: $5,000 SGD');
    const text = extractTextFromBuffer(buffer, 'text/plain');
    expect(text).toContain('30s animation');
    expect(text).toContain('$5,000 SGD');
  });

  test('does not dispatch dormant presentation extraction by MIME', () => {
    const pptx = buildMinimalZip({
      '[Content_Types].xml': '<?xml version="1.0"?><Types></Types>',
      'ppt/slides/slide1.xml':
        '<?xml version="1.0"?><sld><cSld><spTree><p><r><t>Slide Title</t></r><r><t>Key deliverable</t></r></p></spTree></cSld></sld>'
        .replace(/<t>/g, '<a:t>')
        .replace(/<\/t>/g, '</a:t>'),
      'ppt/slides/slide2.xml':
        '<?xml version="1.0"?><sld><a:t>Second slide note</a:t></sld>'
    });
    expect(extractTextFromBuffer(pptx, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('');
  });

  test('does not dispatch dormant document extraction by MIME', () => {
    const docx = buildMinimalZip({
      '[Content_Types].xml': '<?xml version="1.0"?><Types></Types>',
      'word/document.xml':
        '<?xml version="1.0"?><document><body><p><r><w:t>Project brief: launch film</w:t></r><r><w:t>Budget $50,000 SGD</w:t></r></p></body></document>'
    });
    expect(extractTextFromBuffer(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('');
  });

  test('extracts text from (…) Tj operators in a .pdf content stream', () => {
    const pdf = Buffer.from(
      [
        '%PDF-1.4',
        '1 0 obj',
        '<< /Type /Catalog /Pages 2 0 R >>',
        'endobj',
        '4 0 obj',
        '<< /Length 92 >>',
        'stream',
        'BT /F1 12 Tf 100 700 Td (Hello PDF Brief) Tj 0 -20 Td [(Pr) -10 (oject)] TJ ET',
        'endstream',
        'endobj',
        'trailer',
        '<< /Root 1 0 R >>',
        '%%EOF'
      ].join('\n')
    );
    const text = extractTextFromBuffer(pdf, 'application/pdf');
    expect(text).toContain('Hello PDF Brief');
    expect(text).toContain('Project');
  });

  test('returns empty string for unsupported extensions', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const text = extractTextFromBuffer(buffer, 'image/png');
    expect(text).toBe('');
  });

  test('caps extracted output to a bounded length', () => {
    const longBody = 'x'.repeat(8000);
    const text = extractTextFromBuffer(Buffer.from(longBody), 'text/plain');
    expect(text.length).toBeLessThanOrEqual(4000);
  });

  test('rejects a compressed PDF stream whose inflated output exceeds the extraction budget', () => {
    const bomb = zlib.deflateSync(Buffer.alloc(2 * 1024 * 1024, 0x41));
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\nstream\n', 'latin1'), bomb, Buffer.from('\nendstream\n%%EOF', 'latin1')]);

    expect(extractTextFromBuffer(pdf, 'application/pdf')).toBe('');
  });
});
