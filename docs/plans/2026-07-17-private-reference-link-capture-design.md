# Private Reference-Link Capture Design

**Goal:** Allow an authenticated AI session to store its own reference URL privately without granting producer-transfer consent.

**Boundary:** `POST /api/attachments/link` continues to require an authenticated, matching session and a policy-valid URL, then stores the URL under that session. Link deletion remains scoped to the authenticated session. Producer transfer is not part of private draft capture and remains required by the separate brief approval/finalization flow.

**Widget flow:** The references intake step saves the classified URL directly, then persists canonical `referencesStatus: "added"`. It must not call the producer-transfer consent endpoint during capture. Approval continues to record producer-transfer consent before calling finalization.

**Testing:** API coverage proves storage succeeds with no producer-transfer grant and no consent-ledger access. Widget coverage proves the link and `referencesStatus` persist without a producer-transfer request. Existing approval coverage proves finalization remains blocked when producer-transfer consent cannot be recorded.
