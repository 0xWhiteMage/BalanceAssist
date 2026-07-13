export const SESSION_CONSENT_SCOPES = ['analysis', 'producer_transfer'] as const;

export type SessionConsentScope = (typeof SESSION_CONSENT_SCOPES)[number];

export type SessionConsentState = {
  analysis: boolean;
  producerTransfer: boolean;
};

type ConsentLedgerClient = {
  from(table: 'session_consents'): {
    select(columns: string): {
      eq(column: string, value: string): {
        order(column: string, options: { ascending: boolean }): Promise<{
          data: Array<{ scope: SessionConsentScope; granted: boolean }> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

export async function getSessionConsent(client: ConsentLedgerClient, sessionId: string): Promise<SessionConsentState> {
  const { data, error } = await client
    .from('session_consents')
    .select('scope, granted')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  const state: SessionConsentState = { analysis: false, producerTransfer: false };
  for (const transition of data ?? []) {
    if (transition.scope === 'analysis') state.analysis = transition.granted;
    if (transition.scope === 'producer_transfer') state.producerTransfer = transition.granted;
  }
  return state;
}
