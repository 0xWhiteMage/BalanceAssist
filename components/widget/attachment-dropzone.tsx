'use client';
import { useEffect, useRef, useState } from 'react';
import { classifyUrl } from '@/lib/uploads/url-detect';
import { brandTokens } from '@/lib/brand-tokens';
import { hasAnalysisConsent, type AttachmentConsent } from '@/lib/uploads/consent';
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
type ReferenceMutationOutcome = { status: 'saved' } | { status: 'failed'; message: string };

type FileStatus = 'queued' | 'validating' | 'stored' | 'stored-no-text' | 'analysis-failed' | 'failed' | 'retryable';

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

function uploadErrorMessage(code: unknown, status: number): string {
  switch (code) {
    case 'confidential_file_not_allowed':
      return CONFIDENTIAL_INTAKE_RESPONSE;
    case 'session_id_required':
      return 'Your secure session is not ready. Please wait before selecting a file.';
    case 'analysis_consent_required':
      return 'File analysis requires your AI brief consent. Please re-confirm it and retry.';
    case 'file_validation_failed':
      return 'The selected file could not be verified. Check its format and size, then retry.';
    case 'file_uploads_unavailable':
      return 'File sharing is unavailable, or the selection exceeds the current upload limits.';
    case 'private_storage_recovery_unavailable':
      return 'The upload could not be completed safely. Please retry later.';
    case 'private_storage_unavailable':
      return 'Private file storage is temporarily unavailable. Please retry later.';
    case 'upload_mode_required':
    case 'invalid_upload_mode':
    case 'upload_mode_mismatch':
      return 'The upload request was invalid. Please select the file again.';
    default:
      if (status === 401 || status === 403) {
        return 'Your secure session or consent could not be verified. Please refresh and retry.';
      }
      return 'The file could not be uploaded. Please retry.';
  }
}

export function AttachmentDropzone({
  onAddLink,
  onAddFile,
  onFileAnalyzed,
  sessionId,
  consent,
  messageContext = ''
}: {
  onAddLink: (url: string) => Promise<ReferenceMutationOutcome>;
  onAddFile: (file: ReferenceFile) => void;
  onFileAnalyzed?: (fileName: string, extractedText: string) => Promise<void> | void;
  sessionId?: string | null;
  consent?: AttachmentConsent | null;
  messageContext?: string;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [privateStorageAvailable, setPrivateStorageAvailable] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void fetch('/api/telegram/upload', { credentials: 'include' })
      .then(async (response) => response.ok && (await response.json()).available === true)
      .then((available) => { if (active) setPrivateStorageAvailable(available); })
      .catch(() => { if (active) setPrivateStorageAvailable(false); });
    return () => { active = false; };
  }, []);

  const effectiveConsent = consent ?? null;
  const acceptedFormats = `${PRIVATE_ANALYSIS_UPLOAD_POLICY.acceptedFormats.slice(0, -1).join(', ')}, and ${PRIVATE_ANALYSIS_UPLOAD_POLICY.acceptedFormats.at(-1)}`;
  const maxFileSizeMb = PRIVATE_ANALYSIS_UPLOAD_POLICY.maxFileSizeBytes / (1024 * 1024);
  const maxTotalSizeMb = PRIVATE_ANALYSIS_UPLOAD_POLICY.maxTotalSizeBytes / (1024 * 1024);
  const filesEnabled = privateStorageAvailable && Boolean(sessionId);

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
    if (!sessionId) {
      setError('Your secure session is still starting. Please wait before selecting a file.');
      return;
    }
    if (shouldDivertMessage(messageContext)) {
      setError(CONFIDENTIAL_INTAKE_RESPONSE);
      return;
    }
    setError(null);
    fileInputRef.current?.click();
  }

  function updateFileStatus(fileName: string, status: FileStatus, error?: string) {
    setQueuedFiles((prev) =>
      prev.map((qf) => (qf.file.name === fileName ? { ...qf, status, error } : qf))
    );
  }

  async function persistConsent(scope: 'analysis' | 'producer_transfer'): Promise<boolean> {
    if (!sessionId) {
      setError('Your secure session is still starting. Please wait before selecting a file.');
      return false;
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
      setError('Enter a valid public HTTPS reference URL.');
      return;
    }
    try {
      const outcome = await onAddLink(url.trim());
      if (outcome.status !== 'saved') {
        setError(outcome.message);
        return;
      }
      setUrl('');
      setError(null);
    } catch {
      setError('The HTTPS reference link could not be saved. Please retry.');
    }
  }

  async function handleFiles(input: HTMLInputElement) {
    const files = input.files;
    const selectedFiles = files ? Array.from(files) : [];
    try {
      if (!files) return;

      const fileArray = selectedFiles;
      if (!sessionId) {
        setError('Your secure session is still starting. Please wait before selecting a file.');
        return;
      }
      if (fileArray.some((file) => shouldDivertFilename(file.name))) {
        setError(CONFIDENTIAL_INTAKE_RESPONSE);
        return;
      }

      const consentToUse = effectiveConsent ?? null;
      if (!hasAnalysisConsent(consentToUse)) {
        setError('File analysis is available after you choose the AI brief path.');
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
        headers: { 'x-upload-mode': 'analysis', 'x-session-id': sessionId },
        body: fd
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { code?: unknown } | null;
        const uploadError = uploadErrorMessage(body?.code, res.status);
        setError(uploadError);
        for (const file of fileArray) updateFileStatus(file.name, 'retryable', uploadError);
        return;
      }
      const body = await res.json() as { analyses?: Array<{ extractedText?: unknown }> };
      for (const [index, file] of fileArray.entries()) {
        const extractedText = body.analyses?.[index]?.extractedText;
        if (typeof extractedText !== 'string' || !extractedText.trim()) {
          updateFileStatus(file.name, 'stored-no-text');
          continue;
        }
        try {
          await onFileAnalyzed?.(file.name, extractedText);
          updateFileStatus(file.name, 'stored');
        } catch {
          const analysisError = 'Stored privately, but its text could not be added to the AI draft.';
          updateFileStatus(file.name, 'analysis-failed', analysisError);
          setError(analysisError);
        }
      }
    } catch {
      const processingError = 'The file could not be processed. Please retry.';
      setError(processingError);
      for (const file of selectedFiles) updateFileStatus(file.name, 'retryable', processingError);
    } finally {
      input.value = '';
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
          {!sessionId
            ? 'File sharing will be ready when your secure session starts. You can add a reference link now.'
            : privateStorageAvailable
              ? 'Files stay private for up to 24 hours. Supported text is processed by an AI processing service for this draft and never sent to the Balance team. Use the human-only path for protected material.'
              : 'File sharing is temporarily unavailable. Add a reference link instead.'}
        </div>
      </div>

      <form onSubmit={handleUrlSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <label htmlFor="attachment-reference-url" style={{ width: '100%', fontSize: 11, color: brandTokens.colors.lightText }}>
          Reference link
        </label>
        <input
          id="attachment-reference-url"
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
          className="balance-widget-action"
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

      <details
        id="private-analysis-upload-disclosure"
        data-testid="private-analysis-upload-disclosure"
        style={{ fontSize: 11, color: brandTokens.colors.mutedText, lineHeight: 1.5 }}
      >
        <summary style={{ minHeight: 32, padding: '7px 0', cursor: 'pointer', color: brandTokens.colors.lightText }}>
          File limits and privacy
        </summary>
        <div>
          Use non-confidential files only. Accepted: {acceptedFormats}; up to{' '}
          {PRIVATE_ANALYSIS_UPLOAD_POLICY.maxFiles} files, {maxFileSizeMb} MB each, and{' '}
          {maxTotalSizeMb} MB total. Files are validated and stored privately for the temporary
          retention period. TXT and PDF may yield up to{' '}
          {PRIVATE_ANALYSIS_UPLOAD_POLICY.maxExtractedCharacters.toLocaleString('en-US')} characters
          of server-extracted text; accepted images and CSV may yield no extracted text. Any extracted
          text used in AI mode is processed by an AI processing service. Files with no readable text remain
          stored privately but cannot inform the AI draft. Consent, filename checks, private storage, and
          extraction do not prove a file is non-confidential. Use the human-only path for protected material.
        </div>
      </details>

      <button
        type="button"
        aria-describedby="private-analysis-upload-disclosure attachment-private-note"
        disabled={!filesEnabled}
        onClick={openFileSelector}
        style={{
          width: '100%',
          padding: 14,
          borderRadius: 10,
          border: `1px dashed ${brandTokens.colors.border}`,
          textAlign: 'center',
          cursor: filesEnabled ? 'pointer' : 'not-allowed',
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
          {filesEnabled ? 'Store file privately' : !sessionId ? 'Secure session starting' : 'File sharing unavailable'}
        </span>
        <span id="attachment-private-note" style={{ fontSize: 10, color: brandTokens.colors.mutedText }}>
          {filesEnabled
            ? 'Temporarily retained only to analyse this draft. Never sent to the team.'
            : !sessionId ? 'Please wait before selecting a file.' : 'Add a reference link above instead.'}
        </span>
      </button>
      <input
        id="attachment-drop"
        ref={fileInputRef}
        type="file"
        multiple
        accept={PRIVATE_ANALYSIS_UPLOAD_POLICY.accept}
        disabled={!filesEnabled}
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
                {qf.status === 'stored-no-text' && 'Stored privately; no readable text was found for AI analysis'}
                {qf.status === 'analysis-failed' && qf.error}
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
