import type { EventPayload } from '@/lib/api/contracts';

export type SessionResponse = {
  sessionId: string;
  status: string;
  sourceUrl: string;
  createdAt?: string;
  capability?: string;
  expiresAt?: string;
  persisted?: boolean;
};

export type EventResponse = {
  ok: boolean;
  eventName: string;
};

export type FinalizeLeadResponse =
  | {
      ok: true;
      sessionId: string;
      qualificationStatus: string | null;
      persisted: true;
      queued: boolean;
      delivered: boolean;
      retryable: boolean;
      handoffId?: string;
      score?: number | null;
      recommendedNextStep?: string | null;
      crmRecordId?: string;
      crmQueued: boolean;
      crmRevision?: number;
      approvedDraftVersion: number;
      approvalInputHash: string;
      approvedReferenceSetHash: string;
    }
  | { ok: true; sessionId: string; persisted: false; reason: string };

const REQUEST_TIMEOUT_MS = 10000;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      credentials: 'include',
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function sanitizeSourceUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    return `${url.origin}${url.pathname}`;
  } catch {
    return sourceUrl;
  }
}

function sanitizeReferrer(referrer?: string): string | undefined {
  if (!referrer) return undefined;

  try {
    return new URL(referrer).origin;
  } catch {
    return undefined;
  }
}

export async function createSession(payload: {
  sourceUrl: string;
  referrer?: string;
  utm?: Record<string, string>;
  consentVersion?: string;
  consentedAt?: string;
}): Promise<SessionResponse | null> {
  return postJson<SessionResponse>('/api/sessions', {
    ...payload,
    sourceUrl: sanitizeSourceUrl(payload.sourceUrl),
    referrer: sanitizeReferrer(payload.referrer)
  });
}

export async function getCurrentSession(): Promise<SessionResponse | null> {
  try {
    const response = await fetchWithTimeout('/api/sessions/inspect', { cache: 'no-store' });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      exists?: boolean;
      session?: {
        id?: string;
        status?: string;
        source_url?: string;
        created_at?: string;
        expires_at?: string;
      };
    };

    if (data.exists !== true || !data.session?.id || !data.session.status || !data.session.source_url) {
      return null;
    }

    return {
      sessionId: data.session.id,
      status: data.session.status,
      sourceUrl: data.session.source_url,
      createdAt: data.session.created_at,
      expiresAt: data.session.expires_at
    };
  } catch {
    return null;
  }
}

export async function logEvent(payload: EventPayload): Promise<EventResponse | null> {
  return postJson<EventResponse>('/api/events', payload);
}

export async function finalizeLead(payload: { sessionId: string }): Promise<FinalizeLeadResponse | null> {
  try {
    const response = await fetchWithTimeout('/api/leads/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    });
    if (!response.ok) return null;
    const parsed = finalizeLeadResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function recordProducerTransferConsent(sessionId: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`/api/projects/${encodeURIComponent(sessionId)}/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'producer_transfer', granted: true, noticeVersion: CONSENT_VERSION })
    });
    if (!response.ok) return false;

    const data = await response.json() as { ok?: boolean; consent?: { producerTransfer?: boolean } };
    return data.ok === true && data.consent?.producerTransfer === true;
  } catch {
    return false;
  }
}

export async function withdrawProducerTransferConsent(sessionId: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`/api/projects/${encodeURIComponent(sessionId)}/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'producer_transfer', granted: false, noticeVersion: CONSENT_VERSION })
    });
    if (!response.ok) return false;
    const data = await response.json() as { ok?: boolean; consent?: { producerTransfer?: boolean } };
    return data.ok === true && data.consent?.producerTransfer === false;
  } catch {
    return false;
  }
}

export async function recordHumanContactConsent(sessionId: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`/api/projects/${encodeURIComponent(sessionId)}/consent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'human_contact', granted: true, noticeVersion: CONSENT_VERSION })
    });
    if (!response.ok) return false;
    const data = await response.json() as { ok?: boolean; consent?: { humanContact?: boolean } };
    return data.ok === true && data.consent?.humanContact === true;
  } catch { return false; }
}

export type TeamMessage = {
  id: number;
  sender: 'user' | 'team';
  text: string;
  createdAt: string;
};

export type TeamPollState = {
  outgoingStatus: 'queued' | 'delivered' | 'unavailable' | null;
  messages: TeamMessage[];
  fileRequestOpen: boolean;
  fileRequestNote: string | null;
  scheduleRequestOpen: boolean;
};

const teamPollStateSchema = z.object({
  outgoingStatus: z.enum(['queued', 'delivered', 'unavailable']).nullable(),
  messages: z.array(z.object({
    id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sender: z.enum(['user', 'team']),
    text: z.string(),
    createdAt: z.string()
  })),
  fileRequestOpen: z.boolean(),
  fileRequestNote: z.string().nullable(),
  scheduleRequestOpen: z.boolean()
});

export type RelayMessageResult = {
  persisted: boolean;
  queued: boolean;
  delivered: boolean;
};

export async function relayUserMessage(sessionId: string, text: string, requestId: string): Promise<RelayMessageResult> {
  try {
    const response = await fetchWithTimeout('/api/telegram/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-request-id': requestId },
      body: JSON.stringify({ sessionId, text }),
      keepalive: true
    });
    if (!response.ok) return { persisted: false, queued: false, delivered: false };
    const data = await response.json() as { ok?: boolean; persisted?: boolean; queued?: boolean };
    return {
      persisted: data.ok === true && data.persisted === true,
      queued: data.queued === true,
      delivered: false
    };
  } catch {
    return { persisted: false, queued: false, delivered: false };
  }
}

export async function fetchTeamMessages(
  sessionId: string,
  sinceId?: number
): Promise<TeamPollState> {
  try {
    const params = new URLSearchParams({ sessionId });
    if (sinceId !== undefined) {
      params.set('sinceId', String(sinceId));
    }

    const response = await fetchWithTimeout(`/api/telegram/messages?${params.toString()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('relay_status_unavailable');
    }

    const parsed = teamPollStateSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error('relay_status_unavailable');
    }
    return parsed.data;
  } catch {
    throw new Error('relay_status_unavailable');
  }
}

export async function uploadRequestedFiles(
  sessionId: string,
  files: File[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    const form = new FormData();
    form.set('mode', 'human');
    for (const file of files) {
      form.append('files', file, file.name);
    }

    const response = await fetchWithTimeout('/api/telegram/upload', {
      method: 'POST',
      headers: { 'x-session-id': sessionId, 'x-upload-mode': 'human' },
      body: form
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: data.error };
    }

    const data = (await response.json()) as { ok?: boolean };
    return { ok: data.ok === true };
  } catch {
    return { ok: false, error: 'Upload failed due to a network issue.' };
  }
}

export type ReferenceLinkPayload = {
  sessionId: string;
  url: string;
  kind: 'youtube' | 'vimeo' | 'figma' | 'loom' | 'gdrive' | 'other';
};

export type ReferenceLink = ReferenceLinkPayload & { id: string };

export async function addReferenceLink(payload: ReferenceLinkPayload): Promise<ReferenceLink | null> {
  const result = await postJson<{ ok?: boolean; persisted?: boolean; link?: ReferenceLink }>('/api/attachments/link', payload);
  return result?.ok === true && result.link ? result.link : null;
}

export async function deleteReferenceLink(linkId: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`/api/attachments/link/${encodeURIComponent(linkId)}`, {
      method: 'DELETE'
    });
    return response.ok && (await response.json() as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

export type ResetProjectResult = { ok: boolean; draftVersion?: number; message?: string };

export async function resetProject(sessionId: string): Promise<ResetProjectResult> {
  try {
    const response = await fetchWithTimeout(`/api/projects/${sessionId}/reset`, {
      method: 'POST'
    });

    if (!response.ok) {
      return { ok: false };
    }

    const data = (await response.json()) as { ok?: boolean; reset?: boolean; draftVersion?: number; message?: string };
    return { ok: data.ok === true && data.reset === true, draftVersion: data.draftVersion, message: data.message };
  } catch {
    return { ok: false };
  }
}

export type DeletionStatus = 'requested' | 'claimed' | 'processing' | 'completed' | 'failed';
export type DeletionReceiptStatus = {
  ok: boolean;
  receipt?: string;
  receiptId?: string;
  status?: DeletionStatus;
  message?: string;
  requestedAt?: string;
  updatedAt?: string;
  completedAt?: string | null;
  failedAt?: string | null;
  invalidReceipt?: boolean;
};

export async function requestProjectDeletion(sessionId: string): Promise<DeletionReceiptStatus> {
  try {
    const response = await fetchWithTimeout(`/api/projects/${sessionId}/delete`, {
      method: 'POST'
    });

    const data = (await response.json().catch(() => null)) as DeletionReceiptStatus | null;
    if (!response.ok || !data) {
      return { ok: false };
    }

    return { ...data, ok: data.ok === true };
  } catch {
    return { ok: false };
  }
}

export async function fetchProjectDeletionStatus(receipt: string): Promise<DeletionReceiptStatus> {
  try {
    const response = await fetchWithTimeout('/api/deletions/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receipt }),
      cache: 'no-store'
    });
    if (!response.ok) return { ok: false, invalidReceipt: response.status === 404 };
    const data = await response.json() as DeletionReceiptStatus;
    return { ...data, receipt, ok: data.ok === true };
  } catch {
    return { ok: false };
  }
}

export type ProjectDraftResponse = {
  draft: Record<string, string>;
  provenance?: Record<string, 'user-stated' | 'inferred' | 'confirmed' | 'cleared'>;
  draftVersion: number;
  fieldCount: number;
  referenceLinks?: ReferenceLink[];
  approvedDraftVersion?: number;
  approvalInputHash?: string;
  canonicalReferenceSetHash?: string;
  approvedReferenceSetHash?: string;
  crmRevision?: number;
};

const versionedDraftFieldSchema = z.object({
  value: z.string(),
  provenance: z.enum(['user-stated', 'inferred', 'confirmed', 'cleared']),
  updatedAt: z.string()
}).strict();
const versionedDraftSchema = z.record(versionedDraftFieldSchema);
const projectReferenceLinkSchema = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  url: z.string(),
  kind: z.enum(['youtube', 'vimeo', 'figma', 'loom', 'gdrive', 'other'])
}).strict();
const projectDraftBaseFields = {
  draft: versionedDraftSchema,
  draftVersion: z.number().int().nonnegative(),
  fieldCount: z.number().int().nonnegative()
};
const projectDraftGetResponseSchema = z.object({
  sessionId: z.string(),
  ...projectDraftBaseFields,
  referenceLinks: z.array(projectReferenceLinkSchema).optional(),
  approvedDraftVersion: z.number().int().nonnegative().optional(),
  approvalInputHash: z.string().optional(),
  canonicalReferenceSetHash: z.string().optional(),
  approvedReferenceSetHash: z.string().optional(),
  crmRevision: z.number().int().nonnegative().optional()
}).strict();
const projectDraftUpdateResponseSchema = z.object({
  sessionId: z.string(),
  ...projectDraftBaseFields
}).strict();
const projectDraftConflictResponseSchema = z.object({
  error: z.string(),
  ...projectDraftBaseFields
}).strict();

function flattenDraftValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const values: Record<string, string> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (!field || typeof field !== 'object') {
      continue;
    }

    const row = field as { value?: unknown };
    if (typeof row.value === 'string') {
      values[key] = row.value;
    }
  }

  return values;
}

function flattenDraftProvenance(value: unknown): NonNullable<ProjectDraftResponse['provenance']> {
  if (!value || typeof value !== 'object') return {};
  const provenance: NonNullable<ProjectDraftResponse['provenance']> = {};
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    if (!field || typeof field !== 'object') continue;
    const fieldProvenance = (field as { provenance?: unknown }).provenance;
    if (fieldProvenance === 'user-stated' || fieldProvenance === 'inferred' || fieldProvenance === 'confirmed' || fieldProvenance === 'cleared') {
      provenance[key] = fieldProvenance;
    }
  }
  return provenance;
}

export async function fetchProjectDraft(sessionId: string): Promise<ProjectDraftResponse | null> {
  try {
    const response = await fetchWithTimeout(`/api/projects/${sessionId}/draft`, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }

    const parsed = projectDraftGetResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.sessionId !== sessionId) return null;
    const data = parsed.data;
    return {
      draft: flattenDraftValues(data.draft),
      provenance: flattenDraftProvenance(data.draft),
      draftVersion: data.draftVersion,
      fieldCount: data.fieldCount,
      referenceLinks: (data.referenceLinks ?? []).map((link) => ({ ...link, sessionId: link.sessionId ?? sessionId })),
      approvedDraftVersion: data.approvedDraftVersion,
      approvalInputHash: data.approvalInputHash,
      canonicalReferenceSetHash: data.canonicalReferenceSetHash,
      approvedReferenceSetHash: data.approvedReferenceSetHash,
      crmRevision: data.crmRevision
    };
  } catch {
    return null;
  }
}

export async function updateProjectDraft(
  sessionId: string,
  fields: Array<{ field: string; value: string; provenance: 'user-stated' | 'inferred' | 'confirmed' | 'cleared' }>,
  expectedDraftVersion?: number
): Promise<
  | ({ ok: true } & ProjectDraftResponse)
  | ({ ok: false; conflict: true } & ProjectDraftResponse)
  | { ok: false; conflict: false }
> {
  try {
    const response = await fetchWithTimeout(`/api/projects/${sessionId}/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedDraftVersion, fields })
    });

    const data = await response.json().catch(() => null);

    if (response.status === 409 && data) {
      const parsed = projectDraftConflictResponseSchema.safeParse(data);
      if (!parsed.success) return { ok: false, conflict: false };
      return {
        ok: false,
        conflict: true,
        draft: flattenDraftValues(parsed.data.draft),
        provenance: flattenDraftProvenance(parsed.data.draft),
        draftVersion: parsed.data.draftVersion,
        fieldCount: parsed.data.fieldCount,
        referenceLinks: []
      };
    }

    if (!response.ok || !data) {
      return { ok: false, conflict: false };
    }
    const parsed = projectDraftUpdateResponseSchema.safeParse(data);
    if (!parsed.success || parsed.data.sessionId !== sessionId) return { ok: false, conflict: false };

    return {
      ok: true,
      draft: flattenDraftValues(parsed.data.draft),
      provenance: flattenDraftProvenance(parsed.data.draft),
      draftVersion: parsed.data.draftVersion,
      fieldCount: parsed.data.fieldCount,
      referenceLinks: []
    };
  } catch {
    return { ok: false, conflict: false };
  }
}

export type ChatSharedWorkEntry = {
  title: string;
  url: string;
  description?: string;
  image_url?: string;
  category?: 'reference' | 'mood' | 'pitch';
  slug: string;
  clients?: string;
  year?: number | null;
};

export type ChatSharedWork = {
  entries: ChatSharedWorkEntry[];
};

export type ChatReplyItem = {
  text: string;
};

export type ChatRequestPayload = {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  context?: {
    step?: string;
    isTeamConnected?: boolean;
    draft?: string;
    sessionId?: string;
    capturedFields?: string[];
  };
};

type ChatResponseBase = {
  replies: ChatReplyItem[];
  draftUpdates: Record<string, string | boolean>;
  briefReady: boolean;
  sharedWork: ChatSharedWork | null;
};

type CanonicalChatResponse = ChatResponseBase & {
  outcome: 'draft_persisted' | 'draft_conflict';
  canonicalDraft: Record<string, string>;
  canonicalProvenance?: Record<string, 'user-stated' | 'inferred' | 'confirmed' | 'cleared'>;
  draftVersion: number;
  currentStage: 'project' | 'audience' | 'planning' | 'references-contact';
  stageRecaps: string[];
};

export type ChatResponse =
  | CanonicalChatResponse
  | (ChatResponseBase & { outcome: 'non_persistence' })
  | (ChatResponseBase & { outcome: 'confidential_diversion' })
  | (ChatResponseBase & { outcome: 'draft_save_failed' })
  | (ChatResponseBase & {
      outcome: 'provider_unavailable';
      error: 'Chat service unavailable';
      detail: 'chat_provider_unavailable';
    });

const clientReplyFields = {
  message: z.string().min(1).optional(),
  messages: z.array(z.string().min(1)).min(1).optional()
};
const clientSharedWorkSchema = z.object({ entries: z.array(z.object({
    title: z.string(), url: z.string(), description: z.string().optional(), image_url: z.string().optional(),
    category: z.enum(['reference', 'mood', 'pitch']).optional(), slug: z.string(), clients: z.string().optional(), year: z.number().nullable().optional()
  })) });
const clientCanonicalFields = {
  canonicalDraft: z.record(z.string()),
  canonicalProvenance: z.record(z.enum(['user-stated', 'inferred', 'confirmed', 'cleared'])).optional(),
  draftVersion: z.number().int().nonnegative(),
  currentStage: z.enum(['project', 'audience', 'planning', 'references-contact']),
  stageRecaps: z.array(z.string()),
  briefReady: z.boolean()
};
const chatResponseSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('draft_persisted'), ...clientReplyFields, ...clientCanonicalFields,
    draftUpdates: z.record(z.union([z.string(), z.boolean()])).optional(), sharedWork: clientSharedWorkSchema.optional(),
    reviewPrompt: z.string().nullable().optional(), missingFields: z.array(z.string()).optional(), truncated: z.boolean().optional()
  }).strict(),
  z.object({ outcome: z.literal('draft_conflict'), ...clientReplyFields, ...clientCanonicalFields }).strict(),
  z.object({ outcome: z.literal('non_persistence'), ...clientReplyFields, sharedWork: clientSharedWorkSchema.optional() }).strict(),
  z.object({ outcome: z.literal('confidential_diversion'), ...clientReplyFields }).strict(),
  z.object({ outcome: z.literal('draft_save_failed'), ...clientReplyFields }).strict(),
  z.object({
    outcome: z.literal('provider_unavailable'), error: z.literal('Chat service unavailable'),
    detail: z.literal('chat_provider_unavailable')
  }).strict()
]).superRefine((value, context) => {
  if (value.outcome !== 'provider_unavailable' && !value.message && !value.messages) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Either message or messages must be provided' });
  }
});

export async function chatRequest(payload: ChatRequestPayload): Promise<ChatResponse | null> {
  const sanitizedPayload = {
    ...payload,
    messages: payload.messages.filter(
      (message): message is { role: 'user'; content: string } => message.role === 'user'
    )
  };

  let response: Response;
  let responseBody: unknown;
  try {
    response = await fetchWithTimeout('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitizedPayload),
      keepalive: true
    });
    responseBody = await response.json();
  } catch {
    return null;
  }

  const parsed = chatResponseSchema.safeParse(responseBody);
  if (!parsed.success) return null;
  const data = parsed.data;
  const validStatus =
    (response.status === 200 && ['draft_persisted', 'non_persistence', 'confidential_diversion'].includes(data.outcome)) ||
    (response.status === 409 && data.outcome === 'draft_conflict') ||
    (response.status === 500 && data.outcome === 'draft_save_failed') ||
    (response.status === 503 && data.outcome === 'provider_unavailable');
  if (!validStatus) return null;

  if (data.outcome === 'provider_unavailable') {
    return {
      outcome: 'provider_unavailable',
      error: data.error,
      detail: data.detail,
      replies: [],
      draftUpdates: {},
      briefReady: false,
      sharedWork: null
    };
  }

  const textChunks: string[] = (() => {
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      return data.messages;
    }
    if (typeof data.message === 'string' && data.message.trim().length > 0) {
      return [data.message];
    }
    return [];
  })();

  const base = {
    replies: textChunks.map((text) => ({ text })),
    outcome: data.outcome,
    draftUpdates: 'draftUpdates' in data ? data.draftUpdates ?? {} : {},
    briefReady: data.outcome === 'draft_persisted' || data.outcome === 'draft_conflict' ? data.briefReady : false,
    sharedWork: 'sharedWork' in data ? data.sharedWork ?? null : null
  };
  if (data.outcome === 'draft_persisted' || data.outcome === 'draft_conflict') {
    return {
      ...base,
      outcome: data.outcome,
      canonicalDraft: data.canonicalDraft,
      canonicalProvenance: data.canonicalProvenance,
      draftVersion: data.draftVersion,
      currentStage: data.currentStage,
      stageRecaps: data.stageRecaps
    };
  }
  return { ...base, outcome: data.outcome };
}
import { z } from 'zod';

const finalizeLeadResponseSchema = z.discriminatedUnion('persisted', [
  z.object({
    ok: z.literal(true),
    sessionId: z.string(),
    qualificationStatus: z.string().nullable(),
    persisted: z.literal(true),
    queued: z.boolean(),
    delivered: z.boolean(),
    retryable: z.boolean(),
    handoffId: z.string().optional(),
    score: z.number().nullable().optional(),
    recommendedNextStep: z.string().nullable().optional(),
    crmRecordId: z.string().optional(),
    crmQueued: z.boolean(),
    crmRevision: z.number().int().nonnegative().optional(),
    approvedDraftVersion: z.number().int().nonnegative(),
    approvalInputHash: z.string().min(1),
    approvedReferenceSetHash: z.string().min(1)
  }).strict(),
  z.object({
    ok: z.literal(true),
    sessionId: z.string(),
    persisted: z.literal(false),
    reason: z.string()
  }).strict()
]);
import { CONSENT_VERSION } from '@/lib/privacy/notice';
