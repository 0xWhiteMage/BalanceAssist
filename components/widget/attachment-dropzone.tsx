'use client';
import { useEffect, useRef, useState } from 'react';
import { classifyUrl } from '@/lib/uploads/url-detect';
import { brandTokens } from '@/lib/brand-tokens';
import {
  createAttachmentConsent,
  hasAnalysisConsent,
  type AttachmentConsent
} from '@/lib/uploads/consent';
import {
  PRIVATE_ANALYSIS_UPLOAD_POLICY,
  validateFile,
  validateFileBatch
} from '@/lib/uploads/quarantine';
import { CONSENT_VERSION } from '@/lib/privacy/notice';
import {
  classifyConfidentialFilename,
  classifyConfidentialIntent,
  CONFIDENTIAL_INTAKE_RESPONSE
} from '@/lib/privacy/confidential-intent';

export type ReferenceLink = { id?: string; sessionId?: string; kind: 'youtube' | 'vimeo' | 'figma' | 'loom' | 'gdrive' | 'other'; url: string };
export type ReferenceFile = { name: string; sizeBytes: number; mime: string; telegramFileId: string };

type FileStatus = 'queued' | 'validating' | 'stored' | 'failed' | 'retryable';

type QueuedFile = {
  file: File;
  status: FileStatus;
  error?: string;
  extractedText?: string;
};

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }

  return new Response(file).arrayBuffer();
}

export function AttachmentDropzone({
  onAddLink,
  onAddFile,
  onFileAnalyzed,
  sessionId,
  consent,
  messageContext = ''
}: {
  onAddLink: (link: ReferenceLink) => void;
  onAddFile: (file: ReferenceFile) => void;
  onFileAnalyzed?: (fileName: string, extractedText: string) => void;
  sessionId?: string | null;
  consent?: AttachmentConsent | null;
  messageContext?: string;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [localConsent, setLocalConsent] = useState<AttachmentConsent | null>(consent ?? null);
  const [privateStorageAvailable, setPrivateStorageAvailable] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLocalConsent(consent ?? null);
  }, [consent]);

  useEffect(() => {
    let active = true;
    void fetch('/api/telegram/upload', { credentials: 'include' })
      .then(async (response) => response.ok && (await response.json()).available === true)
      .then((available) => { if (active) setPrivateStorageAvailable(available); })
      .catch(() => { if (active) setPrivateStorageAvailable(false); });
    return () => { active = false; };
  }, []);

  const effectiveConsent = consent ?? localConsent;
  const acceptedFormats = `${PRIVATE_ANALYSIS_UPLOAD_POLICY.acceptedFormats.slice(0, -1).join(', ')}, and ${PRIVATE_ANALYSIS_UPLOAD_POLICY.acceptedFormats.at(-1)}`;
  const maxFileSizeMb = PRIVATE_ANALYSIS_UPLOAD_POLICY.maxFileSizeBytes / (1024 * 1024);
  const maxTotalSizeMb = PRIVATE_ANALYSIS_UPLOAD_POLICY.maxTotalSizeBytes / (1024 * 1024);

  function shouldDivertMessage(value: string): boolean {
    try {
      return classifyConfidentialIntent(value) !== 'allow';
    } catch {
      return true;
    }
  }

  function shouldDivertFilename(value: string): boolean {
    try {
      return classifyConfidentialFilename(value) !== 'allow';
    } catch {
      return true;
    }
  }

  function openFileSelector() {
    if (shouldDivertMessage(messageContext)) {
      setError(CONFIDENTIAL_INTAKE_RESPONSE);
      return;
    }
    setError(null);
    fileInputRef.current?.click();
  }

  function updateConsent(nextValues: { aiAnalysis: boolean; producerShare: boolean }) {
    if (consent !== undefined) {
      return;
    }

    setLocalConsent(createAttachmentConsent(nextValues.aiAnalysis, nextValues.producerShare));
    setError(null);
  }

  function setAiAnalysis(nextChecked: boolean) {
    updateConsent({
      aiAnalysis: nextChecked,
      producerShare: effectiveConsent?.producerShare === true
    });
  }

  function updateFileStatus(fileName: string, status: FileStatus, error?: string) {
    setQueuedFiles((prev) =>
      prev.map((qf) => (qf.file.name === fileName ? { ...qf, status, error } : qf))
    );
  }

  async function persistConsent(scope: 'analysis' | 'producer_transfer'): Promise<boolean> {
    if (!sessionId) {
      return true;
    }
    const res = await fetch(`/api/projects/${encodeURIComponent(sessionId)}/consent`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, granted: true, noticeVersion: CONSENT_VERSION })
    });
    if (!res.ok) {
      setError('Unable to save your consent. Please try again before continuing.');
      return false;
    }
    return true;
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
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        kind,
        sessionId: sessionId ?? undefined
      })
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.error ?? 'Failed to add link.');
      return;
    }
    const saved = body?.link;
    if (!saved || typeof saved.id !== 'string' || typeof saved.url !== 'string') {
      setError('Failed to add link.');
      return;
    }
    onAddLink({ id: saved.id, sessionId: saved.sessionId, kind, url: saved.url });
    setUrl('');
    setError(null);
  }

  async function handleFiles(input: HTMLInputElement) {
    const files = input.files;
    if (!files) return;

    const fileArray = Array.from(files);
    if (fileArray.some((file) => shouldDivertFilename(file.name))) {
      input.value = '';
      setError(CONFIDENTIAL_INTAKE_RESPONSE);
      return;
    }

    const consentToUse = effectiveConsent ?? null;

    if (!hasAnalysisConsent(consentToUse)) {
      setError('Please confirm that Balance Assist may analyse these files before uploading.');
      return;
    }

    if (!consentToUse) {
      setError('Consent details are missing. Please re-confirm your upload permissions.');
      return;
    }

    if (!await persistConsent('analysis')) return;

    const buffers = await Promise.all(fileArray.map((f) => readFileBuffer(f)));
    const batchResult = validateFileBatch(fileArray.map((file, i) => ({ file, buffer: buffers[i] })));
    if (!batchResult.ok) {
      setError(batchResult.reason ?? 'Files failed validation.');
      return;
    }
    for (const [index, file] of fileArray.entries()) {
      const validation = validateFile(file, buffers[index]);
      if (!validation.ok) {
        setError(validation.reason);
        return;
      }
    }

    const newQueued: QueuedFile[] = fileArray.map((file) => ({ file, status: 'queued' as FileStatus }));
    setQueuedFiles((prev) => [...prev, ...newQueued]);
    setError(null);

    const fd = new FormData();
    fd.set('mode', 'analysis');
    for (const file of fileArray) {
      updateFileStatus(file.name, 'validating');
      fd.append('files', file, file.name);
    }
    const res = await fetch('/api/telegram/upload', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'x-upload-mode': 'analysis',
        ...(sessionId ? { 'x-session-id': sessionId } : {})
      },
      body: fd
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const uploadError = body?.code === 'confidential_file_not_allowed'
        ? CONFIDENTIAL_INTAKE_RESPONSE
        : body?.error ?? 'Failed to upload file.';
      setError(uploadError);
      for (const file of fileArray) updateFileStatus(file.name, 'retryable', uploadError);
      return;
    }
    const body = await res.json() as { analyses?: Array<{ extractedText?: unknown }> };
    for (const [index, file] of fileArray.entries()) {
      const extractedText = body.analyses?.[index]?.extractedText;
      if (typeof extractedText === 'string') onFileAnalyzed?.(file.name, extractedText);
      updateFileStatus(file.name, 'stored');
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
          {privateStorageAvailable
            ? 'Files are retained privately only to analyse this draft, for up to 24 hours, and are never sent to the Balance team.'
            : 'File sharing is temporarily unavailable. Add a reference link instead.'}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 8,
          padding: 10,
          borderRadius: 10,
          border: `1px solid ${brandTokens.colors.subtleBorder}`,
          background: 'rgba(255, 255, 255, 0.03)'
        }}
      >
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 11, color: brandTokens.colors.lightText }}>
          <input
            type="checkbox"
            checked={effectiveConsent?.aiAnalysis === true}
            onChange={(event) => setAiAnalysis(event.target.checked)}
            disabled={consent !== undefined}
          />
          <span>Balance Assist may analyse these files to help draft my project brief.</span>
        </label>
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
            fontSize: 16
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

      <div
        id="private-analysis-upload-disclosure"
        data-testid="private-analysis-upload-disclosure"
        style={{ fontSize: 11, color: brandTokens.colors.mutedText, lineHeight: 1.5 }}
      >
        Use non-confidential files only. Accepted: {acceptedFormats}; up to{' '}
        {PRIVATE_ANALYSIS_UPLOAD_POLICY.maxFiles} files, {maxFileSizeMb} MB each, and{' '}
        {maxTotalSizeMb} MB total. Files are validated and stored privately for the temporary
        retention period. TXT and PDF may yield up to{' '}
        {PRIVATE_ANALYSIS_UPLOAD_POLICY.maxExtractedCharacters.toLocaleString('en-US')} characters
        of server-extracted text; accepted images and CSV may yield no extracted text. Any extracted
        text used in AI mode is processed by DeepSeek. Consent, filename checks, private storage, and
        extraction do not prove a file is non-confidential. Use the human-only path for protected material.
      </div>

      <button
        type="button"
        aria-describedby="private-analysis-upload-disclosure attachment-private-note"
        disabled={!privateStorageAvailable}
        onClick={openFileSelector}
        style={{
          width: '100%',
          padding: 14,
          borderRadius: 10,
          border: `1px dashed ${brandTokens.colors.border}`,
          textAlign: 'center',
          cursor: privateStorageAvailable ? 'pointer' : 'not-allowed',
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
          {privateStorageAvailable ? 'Store file privately' : 'File sharing unavailable'}
        </span>
        <span id="attachment-private-note" style={{ fontSize: 10, color: brandTokens.colors.mutedText }}>
          {privateStorageAvailable ? 'Temporarily retained only to analyse this draft. Never sent to the team.' : 'Add a reference link above instead.'}
        </span>
      </button>
      <input
        id="attachment-drop"
        ref={fileInputRef}
        type="file"
        multiple
        accept={PRIVATE_ANALYSIS_UPLOAD_POLICY.accept}
        disabled={!privateStorageAvailable}
        onChange={(event) => { void handleFiles(event.currentTarget); }}
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      {queuedFiles.length > 0 && (
        <div role="status" aria-live="polite" style={{ display: 'grid', gap: 4, fontSize: 11, color: brandTokens.colors.mutedText }}>
          {queuedFiles.map((qf) => (
            <div key={qf.file.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: qf.status === 'failed' ? 'tomato' : brandTokens.colors.lightText }}>
                {qf.file.name}
              </span>
              <span style={{ fontSize: 10 }}>
                {qf.status === 'queued' && 'Queued'}
                {qf.status === 'validating' && 'Validating...'}
                {qf.status === 'stored' && 'Stored privately'}
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
