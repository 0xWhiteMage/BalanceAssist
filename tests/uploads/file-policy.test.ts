import { MAX_UPLOAD_SIZE_BYTES, UPLOAD_ACCEPT_ATTRIBUTE, validateUploadFile } from '@/lib/uploads/file-policy';

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
  expect(validateUploadFile({ name: 'big.mov', size: MAX_UPLOAD_SIZE_BYTES + 1 }).ok).toBe(false);
});

test('accept attribute includes common extensions', () => {
  expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.pdf');
  expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.pptx');
  expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.key');
  expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.mov');
  expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain('.mp3');
});
