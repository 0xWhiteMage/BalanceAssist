import {
  ALLOWED_UPLOAD_EXTENSIONS,
  HUMAN_UPLOAD_GUIDANCE,
  HUMAN_UPLOAD_POLICY,
  HUMAN_UPLOAD_SUMMARY,
  MAX_UPLOAD_SIZE_BYTES,
  UPLOAD_ACCEPT_ATTRIBUTE,
  safeHumanUploadMime,
  validateHumanUploadBatch,
  validateUploadFile
} from '@/lib/uploads/file-policy';

test('exports bounded human upload policy facts', () => {
  expect(HUMAN_UPLOAD_POLICY).toEqual({
    allowedExtensions: ALLOWED_UPLOAD_EXTENSIONS,
    maxFiles: 5,
    maxFileSizeBytes: 50 * 1024 * 1024,
    maxTotalSizeBytes: 50 * 1024 * 1024,
    accept: UPLOAD_ACCEPT_ATTRIBUTE
  });
});

test('accepts common creative production files', () => {
  expect(validateUploadFile({ name: 'brief.pdf', size: 1024 }).ok).toBe(true);
  expect(validateUploadFile({ name: 'deck.pptx', size: 1024 }).ok).toBe(true);
  expect(validateUploadFile({ name: 'edit.mov', size: 1024 }).ok).toBe(true);
  expect(validateUploadFile({ name: 'track.wav', size: 1024 }).ok).toBe(true);
  expect(validateUploadFile({ name: 'comp.aep', size: 1024 }).ok).toBe(true);
});

test('rejects executables and scripts', () => {
  expect(validateUploadFile({ name: 'malware.exe', size: 1024 }).ok).toBe(false);
  expect(validateUploadFile({ name: 'run.ps1', size: 1024 }).ok).toBe(false);
  expect(validateUploadFile({ name: 'brief.pdf.exe', size: 1024 }).ok).toBe(false);
});

test('rejects files over 50 MB', () => {
  expect(validateUploadFile({ name: 'large.mov', size: MAX_UPLOAD_SIZE_BYTES }).ok).toBe(true);
  expect(validateUploadFile({ name: 'big.mov', size: MAX_UPLOAD_SIZE_BYTES + 1 }).ok).toBe(false);
});

test('bounds human batches to five files and 50 MB total without reading bytes', () => {
  expect(validateHumanUploadBatch([{ name: 'large.mov', size: 50 * 1024 * 1024 }])).toEqual({ ok: true });
  expect(validateHumanUploadBatch(Array.from({ length: 6 }, (_, index) => ({ name: `${index}.pdf`, size: 1 })))).toMatchObject({ ok: false });
  expect(validateHumanUploadBatch([
    { name: 'one.mov', size: 26 * 1024 * 1024 },
    { name: 'two.mov', size: 26 * 1024 * 1024 }
  ])).toMatchObject({ ok: false });
});

test('uses only bounded safe human MIME values', () => {
  expect(safeHumanUploadMime('video/quicktime')).toBe('video/quicktime');
  expect(safeHumanUploadMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe(
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  expect(safeHumanUploadMime('text/plain\r\nx-injected: yes')).toBe('application/octet-stream');
  expect(safeHumanUploadMime('x'.repeat(200))).toBe('application/octet-stream');
  expect(safeHumanUploadMime('')).toBe('application/octet-stream');
});

test('human upload copy states the batch limits', () => {
  expect(HUMAN_UPLOAD_GUIDANCE).toMatch(/up to 5 files.*50 MB each.*50 MB total/i);
  expect(HUMAN_UPLOAD_SUMMARY).toMatch(/5 files.*50 MB each.*50 MB total/i);
});

test('accept attribute includes common extensions', () => {
  expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.pdf');
  expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.pptx');
  expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.key');
  expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.mov');
  expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.mp3');
});
