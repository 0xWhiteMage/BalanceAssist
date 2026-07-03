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

async function postJson<T>(url: string, body: unknown): Promise<T | null> {
  try {
    const response = await fetch(url, {
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

export async function relayUserMessage(sessionId: string, text: string): Promise<boolean> {
  const result = await postJson<{ ok: boolean }>('/api/telegram/relay', { sessionId, text });
  return Boolean(result?.ok);
}

export async function fetchTeamMessages(
  sessionId: string,
  sinceId?: number
): Promise<TeamMessage[]> {
  try {
    const params = new URLSearchParams({ sessionId });
    if (sinceId !== undefined) {
      params.set('sinceId', String(sinceId));
    }

    const response = await fetch(`/api/telegram/messages?${params.toString()}`, {
      cache: 'no-store'
    });

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as { messages: TeamMessage[] };
    return data.messages ?? [];
  } catch {
    return [];
  }
}