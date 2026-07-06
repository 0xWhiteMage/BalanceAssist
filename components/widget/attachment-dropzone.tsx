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
      setError('Failed to add link.');
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
    <div style={{ display: 'grid', gap: 8 }}>
      <form onSubmit={handleUrlSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          type="url"
          placeholder="Paste a reference link..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ flex: 1, padding: '8px 10px', borderRadius: 6, border: `1px solid ${brandTokens.colors.border}`, background: 'transparent', color: brandTokens.colors.lightText }}
        />
        <button type="submit" style={{ padding: '8px 12px', borderRadius: 6, border: 'none', background: brandTokens.colors.warmGold, color: brandTokens.colors.baseBlack, fontWeight: 600 }}>
          Add link
        </button>
      </form>
      <label
        htmlFor="attachment-drop"
        style={{ padding: 14, borderRadius: 8, border: `1px dashed ${brandTokens.colors.border}`, textAlign: 'center', cursor: 'pointer', color: brandTokens.colors.mutedText }}
      >
        Drop files here (PDF, PPTX, DOCX up to 50 MB)
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
