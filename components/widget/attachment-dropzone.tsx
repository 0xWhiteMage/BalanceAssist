'use client';
import { useState } from 'react';
import { classifyUrl } from '@/lib/uploads/url-detect';
import { brandTokens } from '@/lib/brand-tokens';

export type ReferenceLink = { kind: 'youtube' | 'vimeo' | 'figma' | 'loom' | 'gdrive' | 'other'; url: string };
export type ReferenceFile = { name: string; sizeBytes: number; mime: string; telegramFileId: string };

export function AttachmentDropzone({
  onAddLink,
  onAddFile
}: {
  onAddLink: (link: ReferenceLink) => void;
  onAddFile: (file: ReferenceFile) => void;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

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
      body: JSON.stringify({ url, kind })
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
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('files', file, file.name);
      fd.append('kind', 'reference');
      const res = await fetch('/api/telegram/upload', { method: 'POST', body: fd });
      if (!res.ok) continue;
      const data = await res.json();
      onAddFile({
        name: file.name,
        sizeBytes: file.size,
        mime: file.type,
        telegramFileId: data.telegramFileId ?? ''
      });
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
          (PDF, PPTX, DOCX up to 50 MB)
        </span>
        <input
          id="attachment-drop"
          type="file"
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          style={{ display: 'none' }}
        />
      </label>

      {error && <div role="alert" style={{ color: 'tomato', fontSize: 12 }}>{error}</div>}
    </div>
  );
}
