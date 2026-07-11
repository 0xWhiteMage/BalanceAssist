'use client';
import { useState } from 'react';
import { classifyUrl } from '@/lib/uploads/url-detect';
import { brandTokens } from '@/lib/brand-tokens';
import { hasRequiredConsent, type AttachmentConsent } from '@/lib/uploads/consent';
import { validateFile, validateFileBatch } from '@/lib/uploads/quarantine';

export type ReferenceLink = { kind: 'youtube' | 'vimeo' | 'figma' | 'loom' | 'gdrive' | 'other'; url: string };
export type ReferenceFile = { name: string; sizeBytes: number; mime: string; telegramFileId: string };

type FileStatus = 'queued' | 'validating' | 'analysing' | 'ready-to-share' | 'sent' | 'failed' | 'retryable';

type QueuedFile = {
  file: File;
  status: FileStatus;
  error?: string;
  extractedText?: string;
};

export function AttachmentDropzone({
  onAddLink,
  onAddFile,
  onFileAnalyzed,
  sessionId,
  consent
}: {
  onAddLink: (link: ReferenceLink) => void;
  onAddFile: (file: ReferenceFile) => void;
  onFileAnalyzed?: (fileName: string, extractedText: string) => void;
  sessionId?: string | null;
  consent?: AttachmentConsent | null;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);

  function updateFileStatus(fileName: string, status: FileStatus, error?: string) {
    setQueuedFiles((prev) =>
      prev.map((qf) => (qf.file.name === fileName ? { ...qf, status, error } : qf))
    );
  }

  async function handleUrlSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const kind = classifyUrl(url);
    if (!kind) {
      setError('Not a valid URL.');
      return;
    }
    const res = await fetch('/api/attachments/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, kind, sessionId: sessionId ?? undefined })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? 'Failed to add link.');
      return;
    }
    onAddLink({ kind, url });
    setUrl('');
    setError(null);
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;

    if (!hasRequiredConsent(consent ?? null)) {
      setError('Please consent to file analysis and sharing before uploading.');
      return;
    }

    const fileArray = Array.from(files);
    const buffers = await Promise.all(fileArray.map((f) => f.arrayBuffer()));
    const batchResult = validateFileBatch(fileArray.map((file, i) => ({ file, buffer: buffers[i] })));
    if (!batchResult.ok) {
      setError(batchResult.reason ?? 'Files failed validation.');
      return;
    }

    const newQueued: QueuedFile[] = fileArray.map((file) => ({ file, status: 'queued' as FileStatus }));
    setQueuedFiles((prev) => [...prev, ...newQueued]);
    setError(null);

    for (const file of fileArray) {
      updateFileStatus(file.name, 'validating');

      const buffer = await file.arrayBuffer();
      const result = validateFile(file, buffer);
      if (!result.ok) {
        updateFileStatus(file.name, 'failed', result.reason);
        continue;
      }

      updateFileStatus(file.name, 'analysing');

      const fd = new FormData();
      fd.append('files', file, file.name);
      fd.append('kind', 'reference');
      if (sessionId) {
        fd.append('sessionId', sessionId);
      }
      fd.append('consent', JSON.stringify(consent));

      const res = await fetch('/api/telegram/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        updateFileStatus(file.name, 'retryable', body?.error ?? `Failed to upload ${file.name}.`);
        continue;
      }

      const data = await res.json();
      updateFileStatus(file.name, 'sent');

      onAddFile({
        name: file.name,
        sizeBytes: file.size,
        mime: result.mime,
        telegramFileId: data.telegramFileId ?? ''
      });

      if (typeof data.extractedText === 'string' && data.extractedText.trim()) {
        updateFileStatus(file.name, 'ready-to-share');
        onFileAnalyzed?.(file.name, data.extractedText);
      }
    }
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'grid', gap: 3 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: brandTokens.colors.warmGold,
            textTransform: 'uppercase',
            letterSpacing: '0.16em'
          }}
        >
          Share files to help us understand your project
        </div>
        <div style={{ fontSize: 11, color: brandTokens.colors.mutedText }}>
          Upload a PDF or deck, or share a Google Drive link.
        </div>
      </div>

      <form onSubmit={handleUrlSubmit} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="url"
          placeholder="Paste a reference link..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '8px 10px',
            borderRadius: 999,
            border: `1px solid ${brandTokens.colors.border}`,
            background: 'transparent',
            color: brandTokens.colors.lightText,
            fontSize: 12
          }}
        />
        <button
          type="submit"
          style={{
            padding: '8px 14px',
            borderRadius: 999,
            border: 'none',
            background: `linear-gradient(135deg, ${brandTokens.colors.warmGold} 0%, ${brandTokens.colors.lightGold} 100%)`,
            color: brandTokens.colors.baseBlack,
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            textTransform: 'uppercase',
            letterSpacing: '0.16em',
            flexShrink: 0
          }}
        >
          Add link
        </button>
      </form>

      <label
        htmlFor="attachment-drop"
        style={{
          padding: 14,
          borderRadius: 10,
          border: `1px dashed ${brandTokens.colors.border}`,
          textAlign: 'center',
          cursor: 'pointer',
          color: brandTokens.colors.mutedText,
          display: 'grid',
          justifyItems: 'center',
          gap: 6
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke={brandTokens.colors.warmGold} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: brandTokens.colors.lightText,
            textTransform: 'uppercase',
            letterSpacing: '0.16em'
          }}
        >
          Drop files here
        </span>
        <span style={{ fontSize: 10, color: brandTokens.colors.mutedText }}>
          (PDF, images, text, CSV up to 10 MB each)
        </span>
        <input
          id="attachment-drop"
          type="file"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: 'none' }}
        />
      </label>

      {queuedFiles.length > 0 && (
        <div style={{ display: 'grid', gap: 4, fontSize: 11, color: brandTokens.colors.mutedText }}>
          {queuedFiles.map((qf) => (
            <div key={qf.file.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: qf.status === 'failed' ? 'tomato' : brandTokens.colors.lightText }}>
                {qf.file.name}
              </span>
              <span style={{ fontSize: 10 }}>
                {qf.status === 'queued' && 'Queued'}
                {qf.status === 'validating' && 'Validating...'}
                {qf.status === 'analysing' && 'Analysing...'}
                {qf.status === 'ready-to-share' && 'Ready to share'}
                {qf.status === 'sent' && 'Sent'}
                {qf.status === 'failed' && `Failed: ${qf.error}`}
                {qf.status === 'retryable' && `Retry: ${qf.error}`}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <div role="alert" style={{ color: 'tomato', fontSize: 12 }}>{error}</div>}
    </div>
  );
}
