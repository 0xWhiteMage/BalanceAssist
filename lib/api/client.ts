export type SessionResponse = {
  sessionId: string;
  status: string;
  sourceUrl: string;
  createdAt?: string;
  persisted?: boolean;
};

export type EventResponse = {
  ok: boolean;
  eventName: string;
};

export type FinalizeLeadResponse = {
  ok: boolean;
  sessionId: string;
  qualificationStatus: string;
};

const REQUEST_TIMEOUT_MS = 10000;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
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

export async function createSession(payload: {
  sourceUrl: string;
  referrer?: string;
  utm?: Record<string, string>;
}): Promise<SessionResponse | null> {
  return postJson<SessionResponse>('/api/sessions', payload);
}

export async function verifySession(sessionId: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(
      `/api/sessions/inspect?id=${encodeURIComponent(sessionId)}`,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { exists?: boolean };
    return data.exists === true;
  } catch {
    return false;
  }
}

export async function logEvent(payload: {
  sessionId: string;
  eventName: string;
  properties?: Record<string, unknown>;
}): Promise<EventResponse | null> {
  return postJson<EventResponse>('/api/events', payload);
}

export async function finalizeLead(payload: {
  sessionId: string;
  qualificationStatus: 'qualified' | 'needs_review' | 'misfit' | 'unqualified';
  score?: number;
  recommendedNextStep?: string;
  leadDraft?: Record<string, string | undefined>;
}): Promise<FinalizeLeadResponse | null> {
  return postJson<FinalizeLeadResponse>('/api/leads/finalize', payload);
}

export type TeamMessage = {
  id: number;
  sender: 'user' | 'team';
  text: string;
  createdAt: string;
};

export type TeamPollState = {
  messages: TeamMessage[];
  fileRequestOpen: boolean;
  fileRequestNote: string | null;
};

export async function relayUserMessage(sessionId: string, text: string): Promise<boolean> {
  const result = await postJson<{ ok: boolean }>('/api/telegram/relay', { sessionId, text });
  return Boolean(result?.ok);
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
      return { messages: [], fileRequestOpen: false, fileRequestNote: null };
    }

    const data = (await response.json()) as TeamPollState;
    return {
      messages: data.messages ?? [],
      fileRequestOpen: Boolean(data.fileRequestOpen),
      fileRequestNote: data.fileRequestNote ?? null
    };
  } catch {
    return { messages: [], fileRequestOpen: false, fileRequestNote: null };
  }
}

export async function uploadRequestedFile(sessionId: string, file: File): Promise<boolean> {
  try {
    const form = new FormData();
    form.set('sessionId', sessionId);
    form.set('file', file, file.name);

    const response = await fetchWithTimeout('/api/telegram/upload', {
      method: 'POST',
      body: form
    });

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { ok?: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}
