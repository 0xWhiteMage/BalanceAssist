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
type ReferenceMutationOutcome = { status: 'saved' } | { status: 'failed'; message: string };

type FileStatus = 'queued' | 'validating' | 'stored' | 'stored-no-text' | 'unsupported' | 'analysis-failed' | 'failed' | 'retryable';

type QueuedFile = {
  id: string;
  file: File;
  status: FileStatus;
  error?: string;
  extractedText?: string;
};

const STORAGE_AVAILABILITY_TTL_MS = 30_000;
const storageAvailabilityCache = new Map<string, { available: boolean; expiresAt: number }>();
const storageAvailabilityProbes = new Map<string, Promise<boolean>>();

function probePrivateStorage(sessionId: string): Promise<boolean> {
  const cached = storageAvailabilityCache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.available);
  if (cached) storageAvailabilityCache.delete(sessionId);
  const pending = storageAvailabilityProbes.get(sessionId);
  if (pending) return pending;
  const probe = fetch('/api/telegram/upload', { credentials: 'include' })
    .then(async (response) => response.ok && (await response.json()).available === true)
    .catch(() => false)
    .then((available) => {
      storageAvailabilityCache.set(sessionId, { available, expiresAt: Date.now() + STORAGE_AVAILABILITY_TTL_MS });
      return available;
    })
    .finally(() => storageAvailabilityProbes.delete(sessionId));
  storageAvailabilityProbes.set(sessionId, probe);
  return probe;
}

async function readFileBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer();
  }

  return new Response(file).arrayBuffer();
}

function uploadErrorDetails(code: unknown, status: number): { message: string; retryable: boolean } {
  switch (code) {
    case 'confidential_file_not_allowed':
      return { message: CONFIDENTIAL_INTAKE_RESPONSE, retryable: false };
    case 'session_id_required':
      return { message: 'Your secure session is not ready. Please wait before selecting a file.', retryable: false };
    case 'analysis_consent_required':
      return { message: 'File analysis requires your AI brief consent. Please re-confirm it before uploading.', retryable: false };
    case 'file_validation_failed':
      return { message: 'The selected file could not be verified. Check its format and size, then select it again.', retryable: false };
    case 'file_uploads_unavailable':
      return status === 413
        ? { message: 'The upload request is too large. Choose fewer or smaller files.', retryable: false }
        : { message: 'File sharing is temporarily unavailable. Try again in a moment.', retryable: true };
    case 'private_storage_upload_failed':
      return { message: 'Private storage could not accept the file. Try the upload again.', retryable: true };
    case 'private_storage_metadata_failed':
      return { message: 'The file could not be registered safely after upload. Try again in a moment.', retryable: true };
    case 'private_storage_recovery_unavailable':
      return { message: 'The upload could not be completed safely. Try again later.', retryable: true };
    case 'private_storage_unavailable':
      return { message: 'Private file storage is temporarily unavailable. Try again later.', retryable: true };
    case 'upload_mode_required':
    case 'invalid_upload_mode':
    case 'upload_mode_mismatch':
      return { message: 'The upload request was invalid. Please select the file again.', retryable: false };
    case 'invalid_form_data':
      return { message: 'The file upload could not be read. Select the file once more.', retryable: false };
    case 'files_required':
      return { message: 'No file reached the upload service. Select the file once more.', retryable: false };
    default:
      if (status === 401 || status === 403) {
        return { message: 'Your secure session or consent could not be verified. Refresh before uploading again.', retryable: false };
      }
      if (status === 413) return { message: 'The upload request is too large. Choose fewer or smaller files.', retryable: false };
      if (status >= 500) return { message: `The upload service is temporarily unavailable (${status}). Try again in a moment.`, retryable: true };
      return { message: `The upload request failed (${status}). Select the file again.`, retryable: false };
  }
}

export function AttachmentDropzone({
  onAddLink,
  onFileAnalyzed,
  sessionId,
  consent,
  messageContext = ''
}: {
  onAddLink: (url: string) => Promise<ReferenceMutationOutcome>;
  onFileAnalyzed?: (fileName: string, extractedText: string) => Promise<void> | void;
  sessionId?: string | null;
  consent?: AttachmentConsent | null;
  messageContext?: string;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<QueuedFile[]>([]);
  const [privateStorageAvailable, setPrivateStorageAvailable] = useState(false);
  const [uploadInProgress, setUploadInProgress] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSessionRef = useRef(sessionId);
  const uploadGenerationRef = useRef(0);

  useEffect(() => {
    if (activeSessionRef.current === sessionId) return;
    activeSessionRef.current = sessionId;
    uploadGenerationRef.current += 1;
    setQueuedFiles([]);
    setError(null);
    setUploadInProgress(false);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) {
      setPrivateStorageAvailable(false);
      return;
    }
    let active = true;
    void probePrivateStorage(sessionId)
      .then((available) => { if (active) setPrivateStorageAvailable(available); })
    return () => { active = false; };
  }, [sessionId]);

  const effectiveConsent = consent ?? null;
  const acceptedFormats = `${PRIVATE_ANALYSIS_UPLOAD_POLICY.acceptedFormats.slice(0, -1).join(', ')}, and ${PRIVATE_ANALYSIS_UPLOAD_POLICY.acceptedFormats.at(-1)}`;
  const maxFileSizeMb = PRIVATE_ANALYSIS_UPLOAD_POLICY.maxFileSizeBytes / (1024 * 1024);
  const maxTotalSizeMb = PRIVATE_ANALYSIS_UPLOAD_POLICY.maxTotalSizeBytes / (1024 * 1024);
  const filesEnabled = privateStorageAvailable && Boolean(sessionId) && !uploadInProgress;

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

  function updateFileStatus(id: string, status: FileStatus, error?: string) {
    setQueuedFiles((prev) =>
      prev.map((qf) => (qf.id === id ? { ...qf, status, error } : qf))
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

  async function uploadFiles(queued: QueuedFile[], uploadSessionId: string, generation: number) {
    const isCurrent = () => generation === uploadGenerationRef.current && activeSessionRef.current === uploadSessionId;
    setUploadInProgress(true);
    try {
      const fd = new FormData();
      fd.set('mode', 'analysis');
      for (const item of queued) {
        updateFileStatus(item.id, 'validating');
        fd.append('files', item.file, item.file.name);
      }
      const res = await fetch('/api/telegram/upload', {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-upload-mode': 'analysis', 'x-session-id': uploadSessionId },
        body: fd
      });
      if (!isCurrent()) return;
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { code?: unknown } | null;
        const details = uploadErrorDetails(body?.code, res.status);
        setError(details.message);
        for (const item of queued) updateFileStatus(item.id, details.retryable ? 'retryable' : 'failed', details.message);
        return;
      }
      const body = await res.json() as { analyses?: Array<{ extractedText?: unknown; extractionStatus?: unknown }> };
      if (!isCurrent()) return;
      setError(null);
      if (!Array.isArray(body.analyses) || body.analyses.length !== queued.length) {
        const analysisError = 'Stored privately, but the analysis result could not be confirmed.';
        for (const item of queued) updateFileStatus(item.id, 'analysis-failed', analysisError);
        setError(analysisError);
        return;
      }
      for (const [index, item] of queued.entries()) {
        const file = item.file;
        const analysis = body.analyses[index];
        const extractedText = analysis.extractedText;
        if (analysis.extractionStatus === 'unsupported') {
          updateFileStatus(item.id, 'unsupported');
          continue;
        }
        if (analysis.extractionStatus === 'no_text' && extractedText === '') {
          updateFileStatus(item.id, 'stored-no-text');
          continue;
        }
        if (analysis.extractionStatus !== 'extracted' || typeof extractedText !== 'string' || !extractedText.trim()) {
          const analysisError = 'Stored privately, but text extraction failed.';
          updateFileStatus(item.id, 'analysis-failed', analysisError);
          setError(analysisError);
          continue;
        }
        try {
          if (!isCurrent()) return;
          await onFileAnalyzed?.(file.name, extractedText);
          if (!isCurrent()) return;
          updateFileStatus(item.id, 'stored');
        } catch {
          const analysisError = 'Stored privately, but its text could not be added to the AI draft.';
          updateFileStatus(item.id, 'analysis-failed', analysisError);
          setError(analysisError);
        }
      }
    } catch {
      if (!isCurrent()) return;
      const uploadError = 'The upload result could not be confirmed. Check your connection, then select the file again.';
      setError(uploadError);
      for (const item of queued) updateFileStatus(item.id, 'failed', uploadError);
    } finally {
      if (isCurrent()) setUploadInProgress(false);
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
      const uploadSessionId = sessionId;
      const generation = uploadGenerationRef.current + 1;
      uploadGenerationRef.current = generation;
      const isCurrent = () => generation === uploadGenerationRef.current && activeSessionRef.current === uploadSessionId;
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
      if (!await persistConsent('analysis') || !isCurrent()) return;

      const buffers = await Promise.all(fileArray.map((f) => readFileBuffer(f)));
      if (!isCurrent()) return;
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

      const newQueued: QueuedFile[] = fileArray.map((file) => ({ id: crypto.randomUUID(), file, status: 'queued' as FileStatus }));
      setQueuedFiles(newQueued);
      setError(null);

      await uploadFiles(newQueued, uploadSessionId, generation);
    } catch {
      const processingError = 'The file could not be processed. Please retry.';
      setError(processingError);
      setQueuedFiles((current) => current.map((item) => selectedFiles.includes(item.file)
        ? { ...item, status: 'retryable', error: processingError }
        : item));
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
          Add project files
        </div>
        <div style={{ fontSize: 11, color: brandTokens.colors.mutedText }}>
          {!sessionId
            ? 'File sharing will be ready when your secure session starts. You can add a reference link now.'
            : privateStorageAvailable
              ? 'Private for 24 hours. Used only for this AI draft.'
              : 'File sharing is temporarily unavailable. Add a reference link instead.'}
        </div>
      </div>

      <form onSubmit={handleUrlSubmit} className="balance-widget-reference-form">
        <label htmlFor="attachment-reference-url" style={{ width: '100%', fontSize: 11, color: brandTokens.colors.lightText }}>
          Reference link
        </label>
        <input
          id="attachment-reference-url"
          type="url"
          placeholder="Paste a reference link..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="balance-widget-reference-input"
        />
        <button
          type="submit"
          className="balance-widget-reference-button"
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
          retention period. TXT, CSV, and text-based PDF files may yield up to{' '}
          {PRIVATE_ANALYSIS_UPLOAD_POLICY.maxExtractedCharacters.toLocaleString('en-US')} characters
          of server-extracted text. Image text analysis is not supported, and scanned PDFs need a text layer. Any extracted
          text used in AI mode is processed by an AI processing service. Files with no readable text remain
          stored privately but cannot inform the AI draft. Consent, filename checks, private storage, and
          extraction do not prove a file is non-confidential. Files and extracted text are never sent to
          the Balance team through this AI path. Use the human-only path for protected material.
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
            ? 'Private for 24 hours.'
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
            <div key={qf.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: qf.status === 'failed' || qf.status === 'retryable' ? 'tomato' : brandTokens.colors.lightText }}>
                {qf.file.name}
              </span>
              <span style={{ fontSize: 10 }}>
                {qf.status === 'queued' && 'Queued'}
                {qf.status === 'validating' && 'Validating...'}
                {qf.status === 'stored' && 'Stored privately'}
                {qf.status === 'stored-no-text' && 'Stored privately; this file contains no extractable text'}
                {qf.status === 'unsupported' && 'Stored privately; image text analysis is not supported'}
                {qf.status === 'analysis-failed' && qf.error}
                {qf.status === 'failed' && `Failed: ${qf.error}`}
                {qf.status === 'retryable' && qf.error}
              </span>
              {qf.status === 'retryable' && (
                <button type="button" className="balance-widget-inline-action" onClick={() => {
                  if (!sessionId) return;
                  const generation = uploadGenerationRef.current + 1;
                  uploadGenerationRef.current = generation;
                  void uploadFiles([qf], sessionId, generation);
                }}>
                  Retry upload
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {error && queuedFiles.at(-1)?.error !== error && <div role="alert" style={{ color: 'tomato', fontSize: 12 }}>{error}</div>}
    </div>
  );
}
