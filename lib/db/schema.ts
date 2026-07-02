export type SessionRecord = {
  id: string;
  sourceUrl: string;
  status: 'open' | 'completed' | 'escalated' | 'abandoned';
  createdAt: string;
};

export type EventRecord = {
  sessionId: string;
  eventName: string;
  properties?: Record<string, unknown>;
};
