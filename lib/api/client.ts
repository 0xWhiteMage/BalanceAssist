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

export type FinalizeLeadResponse = {
  ok: boolean;
  code?: string;
  sessionId: string;
  qualificationStatus: string;
  persisted?: boolean;
  queued?: boolean;
  delivered?: boolean;
  retryable?: boolean;
  handoffId?: string;
  score?: number | null;
  recommendedNextStep?: string | null;
  crmRecordId?: string;
  crmQueued?: boolean;
  crmRevision?: number;
  approvedDraftVersion?: number;
};

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

export async function logEvent(payload: {
  sessionId: string;
  eventName: string;
  properties?: Record<string, unknown>;
}): Promise<EventResponse | null> {
  return postJson<EventResponse>('/api/events', payload);
}

export async function finalizeLead(payload: { sessionId: string }): Promise<FinalizeLeadResponse | null> {
  return postJson<FinalizeLeadResponse>('/api/leads/finalize', payload);
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
    for (const file of files) {
      form.append('files', file, file.name);
    }

    const response = await fetchWithTimeout('/api/telegram/upload', {
      method: 'POST',
      headers: { 'x-session-id': sessionId },
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

export async function resetProject(sessionId: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`/api/projects/${sessionId}/reset`, {
      method: 'POST'
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { ok?: boolean; reset?: boolean };
    return data.ok === true && data.reset === true;
  } catch {
    return false;
  }
}

export async function requestProjectDeletion(sessionId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const response = await fetchWithTimeout(`/api/projects/${sessionId}/delete`, {
      method: 'POST'
    });

    const data = (await response.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
    if (!response.ok || !data) {
      return { ok: false };
    }

    return { ok: data.ok === true, message: data.message };
  } catch {
    return { ok: false };
  }
}

export type ProjectDraftResponse = {
  draft: Record<string, string>;
  draftVersion: number;
  fieldCount: number;
  referenceLinks?: ReferenceLink[];
  approvedDraftVersion?: number;
  approvalInputHash?: string;
  canonicalReferenceSetHash?: string;
  approvedReferenceSetHash?: string;
  crmRevision?: number;
};

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

export async function fetchProjectDraft(sessionId: string): Promise<ProjectDraftResponse | null> {
  try {
    const response = await fetchWithTimeout(`/api/projects/${sessionId}/draft`, { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as ProjectDraftResponse & { draft?: unknown; draftVersion?: number; fieldCount?: number };
    return {
      draft: flattenDraftValues(data.draft),
      draftVersion: typeof data.draftVersion === 'number' ? data.draftVersion : 0,
      fieldCount: typeof data.fieldCount === 'number' ? data.fieldCount : Object.keys(flattenDraftValues(data.draft)).length,
      referenceLinks: Array.isArray(data.referenceLinks) ? data.referenceLinks : [],
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

    const data = (await response.json().catch(() => null)) as
      | { draft?: unknown; draftVersion?: number; fieldCount?: number }
      | null;

    if (response.status === 409 && data) {
      return {
        ok: false,
        conflict: true,
        draft: flattenDraftValues(data.draft),
        draftVersion: typeof data.draftVersion === 'number' ? data.draftVersion : 0,
        fieldCount: typeof data.fieldCount === 'number' ? data.fieldCount : Object.keys(flattenDraftValues(data.draft)).length,
        referenceLinks: []
      };
    }

    if (!response.ok || !data) {
      return { ok: false, conflict: false };
    }

    return {
      ok: true,
      draft: flattenDraftValues(data.draft),
      draftVersion: typeof data.draftVersion === 'number' ? data.draftVersion : 0,
      fieldCount: typeof data.fieldCount === 'number' ? data.fieldCount : Object.keys(flattenDraftValues(data.draft)).length,
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

export type ChatResponse = {
  replies: ChatReplyItem[];
  draftUpdates: Record<string, string | boolean>;
  briefReady: boolean;
  sharedWork: ChatSharedWork | null;
};

const chatResponseSchema = z.object({
  message: z.string().optional(),
  messages: z.array(z.string()).optional(),
  draftUpdates: z.record(z.union([z.string(), z.boolean()])).optional(),
  briefReady: z.boolean().optional(),
  sharedWork: z.object({ entries: z.array(z.object({
    title: z.string(), url: z.string(), description: z.string().optional(), image_url: z.string().optional(),
    category: z.enum(['reference', 'mood', 'pitch']).optional(), slug: z.string(), clients: z.string().optional(), year: z.number().nullable().optional()
  })) }).optional()
});

export async function chatRequest(payload: ChatRequestPayload): Promise<ChatResponse | null> {
  const sanitizedPayload = {
    ...payload,
    messages: payload.messages.filter(
      (message): message is { role: 'user'; content: string } => message.role === 'user'
    )
  };

  const response = await postJson<unknown>('/api/chat', sanitizedPayload);
  const parsed = chatResponseSchema.safeParse(response);
  if (!parsed.success) return null;
  const data = parsed.data;

  const textChunks: string[] = (() => {
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      return data.messages;
    }
    if (typeof data.message === 'string' && data.message.trim().length > 0) {
      return [data.message];
    }
    return [];
  })();

  return {
    replies: textChunks.map((text) => ({ text })),
    draftUpdates: data.draftUpdates ?? {},
    briefReady: Boolean(data.briefReady),
    sharedWork: data.sharedWork ?? null
  };
}
import { z } from 'zod';
import { CONSENT_VERSION } from '@/lib/privacy/notice';
