# Truthful Relay Status Recovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep human-contact recovery persistently usable, give all entry choices equal accessible weight, and report relay delivery only from sanitized durable evidence.

**Architecture:** Keep the existing Next.js routes, `handoff_outbox`, `human_messages`, authenticated `/api/telegram/messages` poll, and widget controller. Project the newest session-scoped relay outbox to `queued` or `delivered` without returning its payload; `sent` or a persisted provider receipt proves delivery, while every other durable outbox state remains queued. No migration or new endpoint is needed because the dispatcher already persists both forms of evidence.

**Tech Stack:** Next.js 15 route handlers, React 19, TypeScript, Supabase/PostgreSQL, Zod, Vitest/Testing Library, Playwright, CSS.

---

Use `@superpowers:test-driven-development` for every behavior change and `@superpowers:verification-before-completion` before the final implementation commit. Keep each RED/GREEN cycle limited to the files named in its task. Do not add a relay status table, endpoint, provider-facing state, or compatibility parser.

### Task 1: Sanitize The Persisted Relay Status Contract

**Files:**
- Create: `tests/api/telegram-messages-status.test.ts`
- Modify: `tests/api/telegram-relay-events.test.ts`
- Modify: `app/api/telegram/messages/route.ts:34-75`
- Modify: `app/api/telegram/relay/route.ts:29-44`

**Step 1: Write the failing polling contract tests**

Create route-level tests with a chainable Supabase stub and mocked `requireSession`. Cover these cases separately:

- The newest authenticated session outbox with `payload.type === 'relay'` and `state: 'pending'` returns `outgoingStatus: 'queued'`.
- `claiming`, `sending`, `failed`, and `escalated` also remain `queued`; elapsed `created_at`/`updated_at` time never changes the result.
- `state: 'sent'` returns `outgoingStatus: 'delivered'`.
- A durable receipt in the persisted payload (`telegramMessageId` and `telegramThreadId`) returns `delivered` even if the state is still `pending` after receipt-completion deferral.
- A partial or absent receipt remains `queued`.
- No relay outbox returns `outgoingStatus: null`.
- The outbox query is constrained by authenticated `session_id`, `payload.type: relay`, newest `created_at`, and one row, so another session's receipt cannot affect the result.
- A stored team reply is normalized by removing control characters, collapsing whitespace, trimming, and bounding it to 4,000 characters before response.
- Success JSON contains only the existing sanitized coordination fields, sanitized reply fields, and `outgoingStatus`; recursively assert it does not contain `telegram`, `thread`, `handoff`, `provider`, `token`, `capability`, `payload`, `last_error`, or `routing` keys.
- A message, outbox, or session-state query error returns HTTP 503 with only `{ error: 'relay_status_unavailable' }`, never a raw database/provider error.
- `requireSession` still rejects an unrelated or unauthenticated session before any status query.

Use this public success fixture in the tests; this replaces stale fixtures which implied that polling had no outgoing delivery state:

```ts
const queuedPollFixture = {
  outgoingStatus: 'queued' as const,
  fileRequestOpen: false,
  fileRequestNote: null,
  scheduleRequestOpen: false,
  messages: [{
    id: 17,
    sender: 'team' as const,
    text: 'Avery: We can help.',
    createdAt: '2026-07-17T10:00:00.000Z'
  }]
};
```

Keep the existing file/schedule booleans because `/api/telegram/messages` already carries those sanitized team requests. They are not delivery evidence and must not influence `outgoingStatus`.

**Step 2: Tighten the relay POST contract test**

In `tests/api/telegram-relay-events.test.ts`, replace the response assertion that expects `messageId` and `handoffId` with an exact assertion:

```ts
await expect(response.json()).resolves.toEqual({
  ok: true,
  persisted: true,
  queued: true
});
```

Add an RPC-error assertion for exact HTTP 500 JSON `{ ok: false, error: 'relay_persist_failed' }`. This proves the POST response does not leak the RPC's message, handoff, thread, or provider identifiers on either path.

**Step 3: Run the focused tests to verify RED**

Run:

```powershell
npx vitest run tests/api/telegram-messages-status.test.ts tests/api/telegram-relay-events.test.ts tests/api/session-scoped-routes.test.ts
```

Expected: FAIL because polling has no `outgoingStatus`, query failures return an empty 200 response, reply text is not normalized, and relay POST still exposes internal IDs.

**Step 4: Implement the minimal server projection**

In `app/api/telegram/messages/route.ts`, retain `requireSession` and the current team-message/session queries. Add one query for the newest relay outbox owned by `sessionId`:

```ts
const { data: relayOutbox, error: relayOutboxError } = await supabase
  .from('handoff_outbox')
  .select('state, payload')
  .eq('session_id', sessionId)
  .contains('payload', { type: 'relay' })
  .order('created_at', { ascending: false })
  .limit(1)
  .maybeSingle();
```

Keep `state` and `payload` local. Derive exactly one public value:

```ts
type RelayOutboxProjection = {
  state?: string;
  payload?: Record<string, unknown> | null;
};

const persistedRelay = relayOutbox as RelayOutboxProjection | null;
const hasPersistedReceipt =
  typeof persistedRelay?.payload?.telegramMessageId === 'number' &&
  typeof persistedRelay.payload.telegramThreadId === 'number';
const outgoingStatus = !persistedRelay
  ? null
  : persistedRelay.state === 'sent' || hasPersistedReceipt
    ? 'delivered' as const
    : 'queued' as const;
```

Do not infer from age, poll success, `attempts`, or transient states. Do not serialize `relayOutbox`, its payload, provider IDs, `last_error`, or exceptions.

Normalize reply text at the response boundary with a local function rather than adding a new abstraction:

```ts
function sanitizeReply(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 4000)
    : '';
}
```

If any of the three persisted reads fails, return only the stable 503 error. Keep team rows scoped by `session_id` and `sender = 'team'`, then return `outgoingStatus` alongside the existing sanitized coordination fields and mapped replies.

In `app/api/telegram/relay/route.ts`, keep the RPC and persistence checks but return only:

```ts
return jsonWithCors({
  ok: result.persisted === true,
  persisted: result.persisted === true,
  queued: Boolean(result.handoff_id)
}, undefined, request);
```

The server may inspect `handoff_id` to prove queue persistence, but it must not expose it.

**Step 5: Run the focused tests to verify GREEN**

Run:

```powershell
npx vitest run tests/api/telegram-messages-status.test.ts tests/api/telegram-relay-events.test.ts tests/api/session-scoped-routes.test.ts
```

Expected: PASS. Confirm the response-key absence assertion runs for both queued and delivered fixtures.

**Step 6: Commit the server contract**

```powershell
git add app/api/telegram/messages/route.ts app/api/telegram/relay/route.ts tests/api/telegram-messages-status.test.ts tests/api/telegram-relay-events.test.ts
git commit -m "fix: project durable relay delivery status"
```

### Task 2: Drive Widget Status Only From Polling Evidence

**Files:**
- Modify: `lib/api/client.ts:178-246`
- Modify: `components/widget/use-team-relay.ts:27-50,75-95`
- Modify: `tests/widget/widget-state-controllers.test.tsx:100-189`
- Modify: `tests/widget/widget-overlay-approve-idempotency.test.tsx:18`

**Step 1: Replace stale poll fixtures and write failing controller tests**

Make `outgoingStatus` required on every successful `TeamPollState` fixture. Update existing empty poll fixtures in both named test files with `outgoingStatus: null`.

In `tests/widget/widget-state-controllers.test.tsx`, replace the test that obtains `delivered` from the POST result. Assert this sequence instead:

1. `send()` receives `{ persisted: true, queued: true, delivered: false }` and shows `queued`.
2. A poll fixture with `outgoingStatus: 'queued'` leaves the status queued.
3. A later poll fixture with `outgoingStatus: 'delivered'` promotes it to delivered.
4. A later team reply promotes it to replied.

Add focused tests proving:

- A rejected poll preserves the last `queued` or `delivered` status and remains retryable on the next timer tick.
- A later `queued` fixture cannot demote an already delivered status.
- Empty/inconclusive successful polling cannot fabricate delivered.
- A reply still wins over outgoing delivery status.

**Step 2: Run the controller tests to verify RED**

Run:

```powershell
npx vitest run tests/widget/widget-state-controllers.test.tsx tests/widget/widget-overlay-approve-idempotency.test.tsx
```

Expected: FAIL because the client has no `outgoingStatus`, swallows polling failures into an indistinguishable empty response, and the hook ignores persisted delivery evidence from polling.

**Step 3: Implement the strict client contract**

Change `TeamPollState` to:

```ts
export type TeamPollState = {
  outgoingStatus: 'queued' | 'delivered' | null;
  messages: TeamMessage[];
  fileRequestOpen: boolean;
  fileRequestNote: string | null;
  scheduleRequestOpen: boolean;
};
```

Keep `RelayMessageResult` for the immediate persistence/queue acknowledgement, but never parse `telegramSent`. On a successful relay POST return `delivered: false` unconditionally. In `fetchTeamMessages`, accept only `queued`, `delivered`, or `null` and throw `new Error('relay_status_unavailable')` for HTTP/network failure or an invalid status. Do not create a new public state for errors.

**Step 4: Apply poll evidence monotonically in the hook**

After a successful poll, update status from `next.outgoingStatus` only while no reply has won:

```ts
setStatus((current) => {
  if (current === 'replied') return current;
  if (next.outgoingStatus === 'delivered') return 'delivered';
  if (next.outgoingStatus === 'queued' && current !== 'delivered') return 'queued';
  return current;
});
```

Keep the existing scheduled `.catch(() => undefined)` so a failed poll retains the last factual status and the timer schedules another attempt. The immediate POST may show queued because the server just proved a durable outbox exists; only polling may promote it to delivered.

**Step 5: Run the controller tests to verify GREEN**

Run:

```powershell
npx vitest run tests/widget/widget-state-controllers.test.tsx tests/widget/widget-overlay-approve-idempotency.test.tsx
```

Expected: PASS with all fixtures using the current contract.

**Step 6: Commit the client status flow**

```powershell
git add lib/api/client.ts components/widget/use-team-relay.ts tests/widget/widget-state-controllers.test.tsx tests/widget/widget-overlay-approve-idempotency.test.tsx
git commit -m "fix: render relay status from persisted polling"
```

### Task 3: Keep Human Recovery Persistent When Session Creation Fails

**Files:**
- Modify: `components/widget/widget-overlay.tsx:539-566,1068,1329-1331,1586-1594`
- Modify: `tests/widget/widget-overlay-session.test.tsx:375-390`
- Modify: `tests/e2e/widget.spec.ts`

**Step 1: Strengthen the failing component test**

Expand the existing session-creation failure test to assert all of the following after choosing the human path:

- The widget remains in the human path and displays `The private relay could not start`.
- The relay composer is absent/disabled rather than implying availability.
- `Email the team` retains `mailto:hello@balancestudio.tv`.
- `Book a call` retains the configured Calendly URL.
- AI/entry choices do not replace the human recovery view.
- Clicking either fallback does not remove the other fallback or the unavailable notice.
- A rerender leaves both links present; no retry timer or failed session request clears them.

Use event prevention for link clicks in jsdom so the test verifies persistence without navigation.

**Step 2: Add the failing browser recovery journey**

In `tests/e2e/widget.spec.ts`, route `/api/sessions/inspect` to `exists: false` and session POST to HTTP 503. At a mobile viewport, choose `Talk to the team without AI`, then assert the unavailable notice and both fallback links remain visible after focus/click interaction and a short polling interval. Assert no `/api/chat`, `/api/telegram/relay`, or `/api/telegram/messages` request occurs.

**Step 3: Run focused tests to verify RED**

Run:

```powershell
npx vitest run tests/widget/widget-overlay-session.test.tsx
npx playwright test tests/e2e/widget.spec.ts --grep "session creation fails"
```

Expected: FAIL because `handleTeamConnect` resets `entryPath` to `null`, allowing the entry UI to replace persistent human recovery.

**Step 4: Preserve the human path with minimal state changes**

In `handleTeamConnect`, replace the failed-session reset with `setEntryPath('human')` (or simply retain the already-selected human path). Let `sessionUnavailable` select the existing `HumanFallbacks` view. Do not request AI consent, call chat, fabricate a session, or auto-retry relay delivery.

Keep the stable copy:

```text
The private relay could not start. You can still contact the team directly.
```

Keep direct `mailto:` and configured Calendly anchors rendered for the full lifetime of this human-mode view. Relay input may remain absent because no authenticated session exists.

**Step 5: Run focused tests to verify GREEN**

Run:

```powershell
npx vitest run tests/widget/widget-overlay-session.test.tsx
npx playwright test tests/e2e/widget.spec.ts --grep "session creation fails"
```

Expected: PASS; the E2E request log contains no AI, relay-send, or poll request.

**Step 6: Commit persistent recovery**

```powershell
git add components/widget/widget-overlay.tsx tests/widget/widget-overlay-session.test.tsx tests/e2e/widget.spec.ts
git commit -m "fix: persist direct human recovery options"
```

### Task 4: Give Entry Actions Equal Accessible Hierarchy

**Files:**
- Modify: `components/widget/data-use-notice.tsx:69-102`
- Modify: `app/globals.css`
- Modify: `tests/widget/data-use-notice.test.tsx:17-24`
- Modify: `tests/widget/widget-overlay-a11y.test.tsx`
- Modify: `tests/e2e/widget.spec.ts`

**Step 1: Write failing equal-hierarchy unit tests**

For `Build a brief with AI`, `Talk to the team without AI`, and `Leave`, assert:

- All three use the same class and style contract; no action has a filled/primary treatment.
- Each has `minHeight: '44px'`, full width, the same border, background, font weight, and padding.
- All are native enabled buttons and work with keyboard activation.
- The same assertions hold after opening the AI disclosure for `Continue with AI`, human, and leave.

Avoid snapshots. Compare the exact style/class properties that encode hierarchy and target size.

**Step 2: Write the failing browser accessibility test**

At a mobile viewport (for example `390x844`), measure all three initial action bounding boxes and require both dimensions to be at least 44 CSS pixels. Tab through each action and assert the focused element has a visible nonzero outline (or equivalent box shadow) with at least 2px separation. Press Enter on the human action and verify it activates without a pointer.

**Step 3: Run focused tests to verify RED**

Run:

```powershell
npx vitest run tests/widget/data-use-notice.test.tsx tests/widget/widget-overlay-a11y.test.tsx
npx playwright test tests/e2e/widget.spec.ts --grep "equal entry actions"
```

Expected: FAIL because AI is visually primary, buttons are only 8px vertically padded, and there is no shared `:focus-visible` treatment.

**Step 4: Implement one shared action treatment**

Replace `primaryButtonStyle`/`secondaryButtonStyle` with one shared style used by every entry action in both disclosure states:

```ts
const entryActionStyle = {
  width: '100%',
  minHeight: '44px',
  padding: '10px 16px',
  borderRadius: '20px',
  border: `1px solid ${brandTokens.colors.border}`,
  background: 'transparent',
  color: brandTokens.colors.lightText,
  fontSize: '12px',
  fontWeight: 600,
  fontFamily: brandTokens.typography.ui,
  cursor: 'pointer'
};
```

Give each button the same `balance-entry-action` class. Add only the shared keyboard rule to `app/globals.css`:

```css
.balance-entry-action:focus-visible {
  outline: 2px solid #dbb580;
  outline-offset: 2px;
}
```

Do not add icons, preference copy, reordered placement, or a new component.

**Step 5: Run focused tests to verify GREEN**

Run:

```powershell
npx vitest run tests/widget/data-use-notice.test.tsx tests/widget/widget-overlay-a11y.test.tsx
npx playwright test tests/e2e/widget.spec.ts --grep "equal entry actions"
```

Expected: PASS with all three mobile bounding boxes at least `44x44` and keyboard focus visibly styled.

**Step 6: Commit entry parity**

```powershell
git add components/widget/data-use-notice.tsx app/globals.css tests/widget/data-use-notice.test.tsx tests/widget/widget-overlay-a11y.test.tsx tests/e2e/widget.spec.ts
git commit -m "fix: equalize accessible widget entry actions"
```

### Task 5: Remove Stale Fixtures And Verify The Full Change

**Files:**
- Modify only if found stale: `tests/**/*.ts`
- Modify only if found stale: `tests/**/*.tsx`

**Step 1: Find stale contract assumptions**

Run:

```powershell
rg -n "fetchTeamMessages|TeamPollState|telegramSent|handoffId|threadId|scheduleRequestOpen" tests lib components app
```

Expected: every successful `fetchTeamMessages`/`TeamPollState` fixture includes `outgoingStatus`; public relay tests do not expect `telegramSent`, `handoffId`, `threadId`, `messageId`, payload, errors, tokens, capabilities, or routing metadata. Internal dispatcher tests may still use provider receipt fields because they verify private persistence and must not be rewritten.

If the search finds a stale public fixture, first make its owning test fail against the bounded contract, then update only that fixture. Do not mechanically remove private dispatcher assertions.

**Step 2: Run all focused regression files**

Run:

```powershell
npx vitest run tests/api/telegram-messages-status.test.ts tests/api/telegram-relay-events.test.ts tests/api/session-scoped-routes.test.ts tests/widget/widget-state-controllers.test.tsx tests/widget/widget-overlay-approve-idempotency.test.tsx tests/widget/widget-overlay-session.test.tsx tests/widget/data-use-notice.test.tsx tests/widget/widget-overlay-a11y.test.tsx
```

Expected: PASS with no skipped new test.

**Step 3: Run static and full unit verification**

Run each command independently:

```powershell
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Expected: all exit 0. `npm test` is the full Vitest suite, not only the focused relay tests.

**Step 4: Run browser verification**

Run:

```powershell
npx playwright test tests/e2e/widget.spec.ts
```

Expected: PASS, including mobile target sizing, visible keyboard focus, and persistent fallback after failed human-session creation.

**Step 5: Run database/release verification when prerequisites exist**

No migration is added by this change. The existing `054_human_contact_consent.sql` atomic outbox reservation and dispatcher receipt persistence remain the source of evidence.

When `TEST_DATABASE_URL` points to a disposable PostgreSQL database, run:

```powershell
npm run test:db:prepare
npm run test:db
```

When Docker and the pinned Supabase CLI are available, run:

```powershell
npm run test:supabase
```

Expected: exit 0. If either optional prerequisite is unavailable, record the exact skipped command and reason; do not claim that check passed.

**Step 6: Inspect the final diff for privacy and scope**

Run:

```powershell
git status --short
git diff --check
git diff -- app/api/telegram/messages/route.ts app/api/telegram/relay/route.ts lib/api/client.ts components/widget/use-team-relay.ts components/widget/widget-overlay.tsx components/widget/data-use-notice.tsx app/globals.css tests
```

Verify manually:

- Only durable outbox `sent` or a complete persisted provider receipt yields delivered.
- Missing, partial, failed, retrying, or stale evidence remains queued.
- Public success and error bodies contain no provider metadata or raw diagnostics.
- Poll failure preserves the last factual status and retries without promotion.
- Session failure stays in human mode with persistent email and Calendly actions.
- AI, human, and leave have identical visual treatment, keyboard behavior, visible focus, and at least `44x44` mobile targets.
- No schema migration, new endpoint, provider telemetry, or unrelated redesign was introduced.

Expected: `git diff --check` exits 0 and only intended implementation/test files are modified.

**Step 7: Commit any stale-fixture-only corrections**

Skip this commit if Step 1 required no additional changes. Otherwise:

```powershell
git add tests
git commit -m "test: align relay polling fixtures"
```
