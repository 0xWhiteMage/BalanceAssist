# Thesis-Aligned Intake Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the field-count intake with a four-stage, uncertainty-friendly canonical brief flow that preserves original wording, presents truthful review and transfer states, and works accessibly on desktop and mobile.

**Architecture:** Extend the existing versioned session draft with three editable fields and derive stage, recap, core readiness, and reapproval from the latest canonical draft/version through pure functions. Keep the current chat, draft, reference, consent, and finalization endpoints; make chat persistence return canonical values, keep only approval operation status transient in the shared widget controller, and render review/mobile copy from server facts rather than qualification or integration internals.

**Tech Stack:** Next.js 15 route handlers, React 19, TypeScript, Zod, Supabase RPC-backed versioned JSON drafts, Vitest/Testing Library, Playwright, CSS.

---

Use `@superpowers:test-driven-development` for every behavior change and `@superpowers:verification-before-completion` before claiming implementation complete. Run each RED command before changing production code, keep every GREEN implementation minimal, and make the commit at the end of each task. Do not add a database migration, a second workflow state machine, client-owned canonical draft state, a new reference store, or compatibility aliases for the old eight-field UI.

The committed design is `docs/plans/2026-07-17-thesis-aligned-intake-design.md`. Preserve these existing authorities:

- `sessions.draft` plus `draft_version` and `update_session_draft` remain the canonical draft/version path.
- `reference_links` and the existing attachment/reference components remain the canonical reference path.
- `/api/projects/[sessionId]/consent` remains the producer-transfer consent authority.
- `/api/leads/finalize` and its approved draft/reference metadata remain the approval authority.
- Internal qualification, Monday, Telegram, and provider contracts may retain their existing fields, but no client-visible component may render those internal names or statuses.

### Task 1: Add Canonical Fields And Four-Stage Progress

**Files:**
- Create: `lib/conversation/intake-stage.ts`
- Create: `tests/conversation/intake-stage.test.ts`
- Modify: `lib/onboarding/types.ts:14-25`
- Modify: `lib/onboarding/default-state.ts:3-15`
- Modify: `lib/conversation/types.ts:46-70`
- Modify: `lib/conversation/flow.ts:9-120`
- Modify: `lib/conversation/extract.ts:147-250`
- Modify: `lib/conversation/project-intent.ts:3-8`
- Modify: `tests/conversation/extract.test.ts`
- Modify: `tests/widget/widget-overlay-detect-intent.test.ts`

**Step 1: Write failing stage-model tests**

Create table-driven tests in `tests/conversation/intake-stage.test.ts` for the exact ordered labels and canonical stage derivation:

```ts
expect(INTAKE_STAGES.map(({ id, label }) => ({ id, label }))).toEqual([
  { id: 'project', label: 'Project and objective' },
  { id: 'audience', label: 'Audience and outputs' },
  { id: 'planning', label: 'Timeline and budget' },
  { id: 'references-contact', label: 'References and contact' }
]);

expect(getCurrentIntakeStage(createDefaultLeadDraft()).id).toBe('project');
expect(getCurrentIntakeStage({
  ...createDefaultLeadDraft(),
  projectScope: 'A launch film',
  projectObjective: 'Build awareness'
}).id).toBe('audience');
expect(getCurrentIntakeStage({
  ...createDefaultLeadDraft(),
  projectScope: 'A launch film',
  projectObjective: 'Build awareness',
  audience: 'Young adults',
  intendedOutputs: 'Hero film and cut-downs'
}).id).toBe('planning');
```

Also prove that literal `Not sure yet`, `Skip`, and `Prefer not to share` values count as answered for optional stage progression; timeline and budget do not gate core readiness; and stage 4 does not pretend references are captured merely because the user skipped them.

In `tests/conversation/extract.test.ts`, add expectations for the new order:

```ts
expect(getNextConversationStep({
  ...createDefaultLeadDraft(),
  projectScope: 'Launch film'
})).toBe('objective');
```

Add cases through `audience`, `outputs`, `timeline`, `budget`, `references`, `contact-name`, and `contact-email`. In `tests/widget/widget-overlay-detect-intent.test.ts`, prove `projectObjective`, `audience`, or `intendedOutputs` alone does not open the project rail; a project need (`projectScope`, `projectType`, or `service`) still does.

**Step 2: Run the focused tests to verify RED**

Run:

```powershell
npx vitest run tests/conversation/intake-stage.test.ts tests/conversation/extract.test.ts tests/widget/widget-overlay-detect-intent.test.ts
```

Expected: FAIL because the three fields, stage model, and four new conversation step IDs do not exist.

**Step 3: Extend the canonical TypeScript draft shape**

Add required string properties to `LeadDraft` so every client draft has one stable shape:

```ts
export type LeadDraft = {
  service: ServiceOptionId | '';
  projectType?: string;
  projectScope: string;
  projectObjective: string;
  audience: string;
  intendedOutputs: string;
  scopePolished?: string;
  timelineBand: string;
  budgetBand: string;
  contactName: string;
  contactEmail: string;
  contactCompany?: string;
  consentToShare?: boolean;
};
```

Initialize all three to `''` in `createDefaultLeadDraft()`. Do not introduce enums for user prose or change the persisted JSON format.

**Step 4: Implement the pure stage model**

In `lib/conversation/intake-stage.ts`, define the display contract and derive progress only from canonical values:

```ts
import type { LeadDraft } from '@/lib/onboarding/types';

export type IntakeStageId = 'project' | 'audience' | 'planning' | 'references-contact';

export const INTAKE_STAGES = [
  { id: 'project', label: 'Project and objective' },
  { id: 'audience', label: 'Audience and outputs' },
  { id: 'planning', label: 'Timeline and budget' },
  { id: 'references-contact', label: 'References and contact' }
] as const;

const hasValue = (value: string | undefined) => Boolean(value?.trim());

export function getCurrentIntakeStage(draft: Partial<LeadDraft>) {
  if (!(hasValue(draft.projectScope) || hasValue(draft.service)) || !hasValue(draft.projectObjective)) return INTAKE_STAGES[0];
  if (!hasValue(draft.audience) || !hasValue(draft.intendedOutputs)) return INTAKE_STAGES[1];
  if (!hasValue(draft.timelineBand) || !hasValue(draft.budgetBand)) return INTAKE_STAGES[2];
  return INTAKE_STAGES[3];
}
```

Export `getIntakeStageIndex()` and `getCompletedIntakeStages()` if the component tests need them; do not persist a separate stage field.

**Step 5: Align the scripted flow and next-step selector**

Add `objective`, `audience`, `outputs`, and `references` to `ConversationStepId`. Update `conversationSteps` and `getNextConversationStep()` to follow:

```text
intro -> scope -> objective -> service (only when still useful/missing)
      -> audience -> outputs -> timeline -> budget
      -> references -> contact-name -> contact-email -> consent
```

Use these stable prompts in `flow.ts`:

```ts
objective: {
  id: 'objective',
  botMessages: ['What should this project achieve? Not sure yet is a valid answer.'],
  freeText: true,
  field: 'projectObjective',
  next: 'audience'
},
audience: {
  id: 'audience',
  botMessages: ['Who is this for? You can choose Not sure yet or Skip.'],
  freeText: true,
  field: 'audience',
  next: 'outputs'
},
outputs: {
  id: 'outputs',
  botMessages: ['What outputs or deliverables do you expect? You can choose Not sure yet or Skip.'],
  freeText: true,
  field: 'intendedOutputs',
  next: 'timeline'
},
references: {
  id: 'references',
  botMessages: ['Would you like to add any references? You can add them now or Skip.'],
  freeText: true,
  next: 'contact-name'
}
```

Keep the timeline rationale about planning/feasibility and the budget rationale about realistic formats/scope. Remove the `qualification` step from the user journey and make consent/review lead to review or handoff without rendering `getQualificationMessages()`. Leave internal scoring modules untouched.

**Step 6: Run focused tests to verify GREEN**

Run:

```powershell
npx vitest run tests/conversation/intake-stage.test.ts tests/conversation/extract.test.ts tests/widget/widget-overlay-detect-intent.test.ts
```

Expected: PASS with four ordered stages and the new next-question sequence.

**Step 7: Commit the stage model**

```powershell
git add lib/conversation/intake-stage.ts lib/onboarding/types.ts lib/onboarding/default-state.ts lib/conversation/types.ts lib/conversation/flow.ts lib/conversation/extract.ts lib/conversation/project-intent.ts tests/conversation/intake-stage.test.ts tests/conversation/extract.test.ts tests/widget/widget-overlay-detect-intent.test.ts
git commit -m "feat: model thesis-aligned intake stages"
```

### Task 2: Enforce Prompt, Tool, Uncertainty, And Rationale Boundaries

**Files:**
- Modify: `lib/conversation/tool-schema.ts:6-24,121-160`
- Modify: `lib/conversation/draft-schema.ts:1-84`
- Modify: `lib/conversation/system-prompt.ts:29-86,117-235,237-267`
- Modify: `app/api/chat/route.ts:250-289,416-427`
- Modify: `components/widget/widget-overlay.tsx:121-141,509-625,803-889,899-1010`
- Modify: `tests/conversation/tool-schema.test.ts`
- Modify: `tests/conversation/draft-schema.test.ts`
- Modify: `tests/conversation/system-prompt.test.ts`
- Modify: `tests/api/chat-route.test.ts`
- Modify: `tests/widget/widget-overlay-intent.test.tsx`

**Step 1: Write failing schema and prompt tests**

Extend the positive and all-key-empty fixtures in `tests/conversation/tool-schema.test.ts` with:

```ts
projectObjective: 'Build launch awareness',
audience: 'Young adults',
intendedOutputs: 'Hero film and social cut-downs',
```

Assert the Zod and generated JSON schemas require those keys and still reject unknown keys. Add `draft-schema` cases proving the new fields are allowlisted, bounded, and preserve exact stable literals.

Add focused `system-prompt` tests asserting all of the following:

- The four stage labels occur in order.
- Exactly one contextual question is requested at a time.
- Timeline explains planning and feasibility; budget explains realistic formats and scope.
- `Not sure yet`, `Skip`, and `Prefer not to share` are valid literal values and are never converted to empty strings.
- Optional non-answers never block direct human contact, email, or scheduling.
- `projectScope` is the user's unchanged original wording; `scopePolished` is optional generated interpretation.
- The model may not combine audience and outputs into `projectScope` or overwrite a prior non-empty `projectScope`.
- No client reply contains score, qualified, unqualified, misfit, CRM, Telegram, or revision language.
- The stage supplied to the model is derived from the authenticated draft, not trusted from `context.step`.

In `tests/api/chat-route.test.ts`, add a case where browser context says `budget` but the authenticated draft is in stage 2. Assert the system prompt contains `CURRENT INTAKE STAGE: Audience and outputs`, and not a browser-owned stage override.

**Step 2: Run focused tests to verify RED**

Run:

```powershell
npx vitest run tests/conversation/tool-schema.test.ts tests/conversation/draft-schema.test.ts tests/conversation/system-prompt.test.ts tests/api/chat-route.test.ts tests/widget/widget-overlay-intent.test.tsx
```

Expected: FAIL because the schemas and prompt still describe the old eight-field sequence and accept the browser step as model context.

**Step 3: Extend and harden the tool boundary**

Add the three string fields to `recordBriefUpdatesSchema` and `ALLOWED_KEYS`. Keep empty string as the unknown tool sentinel, but document that a user-selected non-answer is non-empty and canonical.

In `guardAgainstFabricatedBriefFields`, preserve the first original project statement exactly:

```ts
const nextScope = typeof cleaned.projectScope === 'string' ? cleaned.projectScope.trim() : '';
if (nextScope && nextScope !== priorDraft.projectScope) {
  if (priorDraft.projectScope?.trim()) {
    cleaned.projectScope = priorDraft.projectScope;
  } else if (!textContains(userMessage, nextScope)) {
    cleaned.projectScope = userMessage.trim();
  }
}
```

Retain the contact fabrication guards. Add equivalent containment checks for new structured prose only when replacing a prior value; allow stable literals exactly. Do not let `scopePolished` become readiness evidence or original wording.

**Step 4: Replace old prompt flow rules**

Generate the next-question block from authenticated draft values and `getCurrentIntakeStage()`. The block must tell the model to ask only the first missing field in this order: project need, objective, audience, outputs, timeline, budget, references offer, contact route. Include exact rationale and non-answer policy. Delete the old instruction that folds audience into a growing `projectScope` and the `all 8 brief fields` wording.

Pass `currentStage` into `buildSystemPrompt()`:

```ts
const currentStage = getCurrentIntakeStage(priorDraft);
const systemPrompt = buildSystemPrompt({
  draft: Object.keys(promptDraft).length > 0 ? JSON.stringify(promptDraft) : undefined,
  briefReady,
  capturedFields,
  currentStage
});
```

Treat `context.step` only as a non-authoritative UI diagnostic or remove it from prompt construction. Do not add viewport or client readiness as trusted prompt context.

**Step 5: Recognize explicit non-answer actions in the widget**

Create a small constant local to `widget-overlay.tsx` for quick actions:

```ts
const OPTIONAL_ANSWER_ACTIONS = ['Not sure yet', 'Skip', 'Prefer not to share'] as const;
```

Render only actions relevant to the current optional field, and route clicks through `processFlowAnswer()` with the same literal value and display label. Include the new step IDs in the LLM intake-step checks and `CAPTURED_FIELD_KEYS_FOR_LLM`; never route these actions to qualification or human handoff.

**Step 6: Run focused tests to verify GREEN**

Run the command from Step 2. Expected: PASS; the route test proves authenticated stage ownership and schema tests prove exact uncertainty literals survive.

**Step 7: Commit prompt and tool boundaries**

```powershell
git add lib/conversation/tool-schema.ts lib/conversation/draft-schema.ts lib/conversation/system-prompt.ts app/api/chat/route.ts components/widget/widget-overlay.tsx tests/conversation/tool-schema.test.ts tests/conversation/draft-schema.test.ts tests/conversation/system-prompt.test.ts tests/api/chat-route.test.ts tests/widget/widget-overlay-intent.test.tsx
git commit -m "feat: enforce contextual intake prompt boundaries"
```

### Task 3: Return Canonical Draft Progress And Deterministic Stage Recaps

**Files:**
- Modify: `lib/conversation/intake-stage.ts`
- Modify: `lib/conversation/draft-versioning.ts:138-164`
- Modify: `app/api/chat/route.ts:291-427,504-593`
- Modify: `lib/api/contracts.ts:32-63`
- Modify: `lib/api/client.ts:347-448,480-565`
- Modify: `components/widget/use-widget-session-draft.ts:10-12,58-80,158-174`
- Modify: `components/widget/widget-overlay.tsx:61-90,509-625,676-727,803-889`
- Modify: `tests/conversation/intake-stage.test.ts`
- Modify: `tests/conversation/draft-versioning.test.ts`
- Modify: `tests/api/contracts.test.ts`
- Modify: `tests/api/chat-client.test.ts`
- Modify: `tests/api/chat-route.test.ts`
- Modify: `tests/widget/widget-state-controllers.test.tsx`
- Modify: `tests/widget/widget-overlay-intent.test.tsx`

**Step 1: Write failing recap and canonical-response tests**

In `tests/conversation/intake-stage.test.ts`, test a deterministic formatter with exact factual output and no inferred facts:

```ts
expect(formatIntakeStageRecap('project', {
  ...createDefaultLeadDraft(),
  projectScope: 'A launch film for the new chair',
  projectObjective: 'Build awareness'
})).toBe('So far: A launch film for the new chair; objective: Build awareness.');
```

Add audience/output and planning cases, omission cases, stable non-answer cases, and a test that `scopePolished` is never substituted for `projectScope`.

At the route boundary, test that a successful RPC response drives `canonicalDraft`, `draftVersion`, `currentStage`, and `stageRecaps`; readiness is computed from that saved result. Add a conflict fixture where RPC returns `conflict: true`; expect HTTP 409 (or the repository's existing conflict envelope) with the winning canonical draft/version and no optimistic update. Add an RPC-error fixture returning stable HTTP 500 without claiming a saved recap.

In the hook/controller tests, prove successful responses replace local draft/version, conflicts replace them and return a conflict outcome, and failures leave the previous canonical values visible.

**Step 2: Run focused tests to verify RED**

Run:

```powershell
npx vitest run tests/conversation/intake-stage.test.ts tests/conversation/draft-versioning.test.ts tests/api/contracts.test.ts tests/api/chat-client.test.ts tests/api/chat-route.test.ts tests/widget/widget-state-controllers.test.tsx tests/widget/widget-overlay-intent.test.tsx
```

Expected: FAIL because chat persistence discards RPC output, readiness uses the optimistic merge, and LLM-path stage recaps are not emitted.

**Step 3: Add deterministic recap formatting**

Implement `formatIntakeStageRecap(stageId, draft)` in `intake-stage.ts` with labelled canonical fields only. Return `null` for no factual fields and cap displayed values to their existing server limits. Add the new field labels in `FIELD_LABELS`:

```ts
projectObjective: 'Project objective',
audience: 'Audience',
intendedOutputs: 'Intended outputs',
scopePolished: 'AI-drafted summary'
```

Do not call the model for recaps. If formatting unexpectedly returns `null`, continue the flow without blocking intake or human access.

**Step 4: Make chat persistence return the saved canonical result**

Change `persistAuthenticatedDraftState()` to return a discriminated result:

```ts
type PersistDraftResult =
  | { ok: true; draft: VersionedDraft; draftVersion: number }
  | { ok: false; conflict: true; draft: VersionedDraft; draftVersion: number }
  | { ok: false; conflict: false };
```

Use the existing `p_expected_draft_version: state.draftVersion`. Normalize the RPC's returned `draft`, check `draft_version` and `conflict`, and never compute readiness or recap from `draftUpdates` alone. Persist `scopePolished` with `inferred` provenance and direct/user-extracted fields with `user-stated` provenance. No-change requests return the already loaded canonical draft/version after refreshing session activity.

On success, compare completed stage indexes before/after save and return one deterministic recap for each crossed boundary. Include this public response data:

```ts
{
  canonicalDraft: getVisibleDraftValues(saved.draft),
  draftVersion: saved.draftVersion,
  currentStage: getCurrentIntakeStage(savedValues).id,
  stageRecaps,
  briefReady: isBriefReadyForApproval(savedValues)
}
```

On conflict, return the winning canonical values/version and a stable conflict message; do not emit optimistic recap or claim the user's change was saved.

**Step 5: Parse and apply canonical chat responses**

Extend `chatResponsePayloadSchema`, the private client Zod schema, and `ChatResponse` with `canonicalDraft`, `draftVersion`, `currentStage`, `stageRecaps`, and conflict data. In `handleLLMResponse`, remove the local `applyTextToDraft` plus tool-update merge as authoritative state. Apply only server-returned canonical values/version through `applyCanonicalDraftState`; display returned stage recaps after the assistant reply. On conflict, replace state and say:

```text
This brief changed elsewhere, so I reloaded the latest saved version. Please reapply your change.
```

On save failure, retain the prior canonical state and say:

```text
I could not save that answer. Please try again, or talk to the team without AI.
```

Retire `getSectionSummary()` from `widget-overlay.tsx`; all periodic summaries now come from the deterministic server result. Keep `hydrateCanonicalDraft()` only for bootstrap/recovery, not as the normal post-chat source of truth.

**Step 6: Run focused tests to verify GREEN**

Run the command from Step 2. Expected: PASS with saved canonical values controlling stage, recap, and readiness.

**Step 7: Commit canonical progress and recaps**

```powershell
git add lib/conversation/intake-stage.ts lib/conversation/draft-versioning.ts app/api/chat/route.ts lib/api/contracts.ts lib/api/client.ts components/widget/use-widget-session-draft.ts components/widget/widget-overlay.tsx tests/conversation/intake-stage.test.ts tests/conversation/draft-versioning.test.ts tests/api/contracts.test.ts tests/api/chat-client.test.ts tests/api/chat-route.test.ts tests/widget/widget-state-controllers.test.tsx tests/widget/widget-overlay-intent.test.tsx
git commit -m "feat: derive intake recaps from canonical drafts"
```

### Task 4: Build Semantic Review With Original And AI-Drafted Wording

**Files:**
- Modify: `lib/conversation/review-state.ts:1-22`
- Modify: `components/widget/widget-overlay-parts.tsx:421-916`
- Modify: `components/widget/review-panel.tsx:1-380`
- Modify: `components/widget/widget-overlay.tsx:1289-1312`
- Modify: `tests/conversation/review-state.test.ts`
- Modify: `tests/widget/project-brief-card.test.tsx`
- Modify: `tests/widget/review-panel.test.tsx`

**Step 1: Write failing semantic-review tests**

Update `review-state.test.ts` to prove core readiness means one project need from `projectScope`, `projectObjective`, or `service`, plus one contact route from `contactName` or `contactEmail`. Keep timeline, budget, audience, outputs, company, and references optional. Include readiness with `projectObjective` alone and accepted uncertainty literals in optional fields.

Replace field-count assertions in `review-panel.test.tsx` with:

```ts
expect(screen.getByText('Core brief ready')).toBeInTheDocument();
expect(screen.getByText('Optional details')).toBeInTheDocument();
expect(screen.queryByText(/\d+ of \d+ captured/i)).not.toBeInTheDocument();
```

Add forbidden-copy assertions over the whole rendered panel:

```ts
expect(screen.getByTestId('review-panel').textContent).not.toMatch(
  /score|qualified|unqualified|misfit|crm|telegram|revision/i
);
```

In `project-brief-card.test.tsx`, use different `projectScope` and `scopePolished` values. Assert both `Original wording` and `AI-drafted summary` render, the original text is unchanged, and generated text never replaces it. Open editors and assert project scope, polished summary, objective, audience, and outputs use `<textarea>` with persistent labels; Enter adds a newline and does not call `onChange`; explicit `Save` commits. Keep short fields as single-line inputs if desired.

**Step 2: Run focused tests to verify RED**

Run:

```powershell
npx vitest run tests/conversation/review-state.test.ts tests/widget/project-brief-card.test.tsx tests/widget/review-panel.test.tsx
```

Expected: FAIL because readiness ignores objective, progress is numeric, polished scope substitutes for original, editors are one-line, and internal transfer names render.

**Step 3: Update semantic readiness and review prompt helpers**

Change readiness to:

```ts
const hasProjectNeed = Boolean(
  draft.projectScope?.trim() || draft.projectObjective?.trim() || draft.service?.trim()
);
const hasContactRoute = Boolean(draft.contactName?.trim() || draft.contactEmail?.trim());
return hasProjectNeed && hasContactRoute;
```

Export `getReviewPrompt(isMobile: boolean)`:

```ts
export function getReviewPrompt(isMobile: boolean): string {
  return isMobile
    ? 'Your core brief is ready. Review it in the Brief tab.'
    : 'Your core brief is ready. Review it in the brief panel.';
}
```

Do not let `scopePolished`, timeline, budget, references, or optional detail counts satisfy readiness.

**Step 4: Rebuild the brief rows without substitution**

In `ProjectBriefCard`, define separate rows in this order:

```ts
[
  { label: 'Original wording', key: 'projectScope', raw: draft.projectScope, multiline: true },
  ...(draft.scopePolished?.trim() && draft.scopePolished.trim() !== draft.projectScope.trim()
    ? [{ label: 'AI-drafted summary', key: 'scopePolished', raw: draft.scopePolished, multiline: true }]
    : []),
  { label: 'Project objective', key: 'projectObjective', raw: draft.projectObjective, multiline: true },
  { label: 'Audience', key: 'audience', raw: draft.audience, multiline: true },
  { label: 'Intended outputs', key: 'intendedOutputs', raw: draft.intendedOutputs, multiline: true },
  // existing service/type/planning/contact rows
]
```

Use `<textarea rows={3}>` for multiline rows and explicit `Save`/`Cancel` buttons. Make both controls at least 44 CSS pixels high. Blur must not double-commit after Save/Cancel. Preserve all text with normal wrapping (`whiteSpace: 'pre-wrap'`, `overflowWrap: 'anywhere'`) rather than ellipsis for long original/generated fields.

`handleDraftEdit()` already sends direct edits as `confirmed`; add the three new keys and `scopePolished` to its allowlist. A cleared editor sends `cleared` as before.

**Step 5: Replace numeric progress and internal confirmation copy**

Delete `TOTAL_FIELDS`, `ProgressStrip`, completed-count arithmetic, `telegramBroadcastStatus`, `crmQueued`, and `crmRevision` props from `ReviewPanel`. Render two named groups:

```text
Core brief ready / Core brief needs a project need and contact route
Optional details / Add any useful context, or leave these for the team conversation
```

The primary action label is `Send brief to Balance`; after a canonical edit to an approved version it is `Send updated brief to Balance`. Confirmation may show only `Brief saved`, `Queued for the Balance team`, or `Delivered to the Balance team`, chosen from finalization's persisted/queued/delivered booleans. Never render producer review as complete.

**Step 6: Run focused tests to verify GREEN**

Run the command from Step 2. Expected: PASS with semantic groups, distinct wording, multiline editing, and no internal terms.

**Step 7: Commit semantic review**

```powershell
git add lib/conversation/review-state.ts components/widget/widget-overlay-parts.tsx components/widget/review-panel.tsx components/widget/widget-overlay.tsx tests/conversation/review-state.test.ts tests/widget/project-brief-card.test.tsx tests/widget/review-panel.test.tsx
git commit -m "feat: present a semantic editable brief review"
```

### Task 5: Render Accessible Stage Progress And Mobile-Safe Copy

**Files:**
- Create: `components/widget/intake-stage-progress.tsx`
- Create: `tests/widget/intake-stage-progress.test.tsx`
- Modify: `components/widget/widget-overlay.tsx:1138-1333`
- Modify: `components/widget/review-panel.tsx`
- Modify: `app/globals.css:22-25`
- Modify: `tests/widget/widget-overlay-a11y.test.tsx`
- Modify: `tests/widget/widget-overlay-intent.test.tsx`

**Step 1: Write failing component and accessibility tests**

Test `IntakeStageProgress` as a named ordered list with all four labels, `aria-current="step"` on the canonical current item, textual `Stage 2 of 4`, and a polite live-region announcement when the current stage changes. Assert no color-only status.

In overlay tests, mock `matchMedia('(max-width: 639px)')` both ways. Assert ready copy is exactly:

```text
Desktop: Your core brief is ready. Review it in the brief panel.
Mobile: Your core brief is ready. Review it in the Brief tab.
```

Assert every mobile prompt/error that points to review uses `Brief tab`, not `left`, `right`, `rail`, or `panel`. Test tab arrow keys/Home/End, persistent editor labels, approval/error live regions, and 44px inline action styles/classes.

**Step 2: Run focused tests to verify RED**

Run:

```powershell
npx vitest run tests/widget/intake-stage-progress.test.tsx tests/widget/widget-overlay-a11y.test.tsx tests/widget/widget-overlay-intent.test.tsx tests/widget/review-panel.test.tsx
```

Expected: FAIL because there is no stage component and review copy is generated/directional rather than viewport-correct.

**Step 3: Implement the stage component**

Create a small presentational component receiving only `currentStageId`. Render `<ol aria-label="Intake stages">`, visible stage text, and a restrained `aria-live="polite"` announcement. Use canonical `getCurrentIntakeStage(draft).id` in `WidgetOverlay`; do not add stage state.

Place it above the chat/review split for AI intake so it remains visible on both mobile tabs. Keep human-only mode free of irrelevant AI stage progress.

**Step 4: Normalize ready and error copy at render time**

When the server reports `briefReady`, use `getReviewPrompt(isMobile)` for the final review direction rather than trusting model prose. Keep server `stageRecaps` factual and unchanged. Render approval errors in a shared banner above the mobile tab panels so Chat and Brief both expose the same failure and retry action.

Add stable CSS classes in `app/globals.css` for focus-visible, 44px actions, wrapping, and reduced motion:

```css
.balance-widget-action { min-width: 44px; min-height: 44px; }
.balance-widget-wrap { min-width: 0; overflow-wrap: anywhere; }
.balance-widget-action:focus-visible { outline: 2px solid #dbb580; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .balance-widget-motion { animation: none !important; scroll-behavior: auto !important; }
}
```

Textual stage/status information must remain when motion is reduced.

**Step 5: Run focused tests to verify GREEN**

Run the command from Step 2. Expected: PASS with accessible named stages and viewport-correct review language.

**Step 6: Commit stage UI and mobile copy**

```powershell
git add components/widget/intake-stage-progress.tsx components/widget/widget-overlay.tsx components/widget/review-panel.tsx app/globals.css tests/widget/intake-stage-progress.test.tsx tests/widget/widget-overlay-a11y.test.tsx tests/widget/widget-overlay-intent.test.tsx tests/widget/review-panel.test.tsx
git commit -m "feat: show accessible intake progress and mobile copy"
```

### Task 6: Centralize Approval Retry And Approve-Edit-Reapprove State

**Files:**
- Modify: `components/widget/use-widget-session-draft.ts:25-49,58-80,176-207,225-232`
- Modify: `components/widget/widget-overlay.tsx:159-195,676-727,752-801,1289-1312`
- Modify: `components/widget/review-panel.tsx`
- Modify: `tests/widget/widget-state-controllers.test.tsx:24-246`
- Modify: `tests/widget/review-panel.test.tsx`
- Modify: `tests/widget/widget-overlay-approve-idempotency.test.tsx`
- Modify: `tests/widget/widget-overlay-approved-confirmation.test.tsx`
- Modify: `tests/widget/widget-overlay-producer-upload.test.tsx`

**Step 1: Write failing shared-controller tests**

Add controller tests for this exact state sequence:

```text
idle -> pending -> error -> pending -> approved
approved(version 4) -> canonical edit(version 5) -> idle/reapproval-required
idle -> pending -> approved(version 5)
```

Assert a duplicate begin while pending returns false; every failure, thrown exception, reset, invalidation, and stale operation returns the operation to retryable `idle`/`error`; a successful canonical edit invalidates approval only when `approvedDraftVersion !== draftVersion` (or reference hashes differ); and stale approval completion cannot mark a newer draft approved.

Update `ReviewPanel` tests so it receives operation status as a prop and has no private sticky lock. A failed send must re-enable `Send brief to Balance`, preserve an inline `The brief was not sent` error, and expose `Retry`, `Talk to the team without AI`, and email/scheduling fallbacks where configured.

Expand overlay tests to approve, edit `Original wording`, receive canonical version increment, and reapprove without unmounting `review-panel`. Assert finalize runs twice for two different canonical versions and duplicate clicks still call it once per operation.

**Step 2: Run focused tests to verify RED**

Run:

```powershell
npx vitest run tests/widget/widget-state-controllers.test.tsx tests/widget/review-panel.test.tsx tests/widget/widget-overlay-approve-idempotency.test.tsx tests/widget/widget-overlay-approved-confirmation.test.tsx tests/widget/widget-overlay-producer-upload.test.tsx
```

Expected: FAIL because `ReviewPanel` owns a second sticky `isApproveInFlight`, failures do not release it, and reapproval is inferred from CRM revision rather than approved canonical version/reference hashes.

**Step 3: Put transient operation state in the shared controller**

Replace the parallel `approve()` API and component-local lock with one operation contract:

```ts
type ApprovalOperation =
  | { status: 'idle'; error: null }
  | { status: 'pending'; error: null; draftVersion: number }
  | { status: 'error'; error: string };
```

Expose `beginApproval(): { draftVersion: number; generation: number } | null`, `finishApprovalSuccess(token, response)`, and `finishApprovalError(token, message)`. Validate token generation and draft version before applying success. Always release the ref in failure, catch, reset, unmount/invalidation, and stale-token paths. Derive:

```ts
const briefApproved =
  approval.approvedDraftVersion === draftVersion &&
  approval.canonicalReferenceSetHash === approval.approvedReferenceSetHash;
const requiresReapproval = approval.approvedDraftVersion !== undefined && !briefApproved;
```

Do not retain `setBriefApproved` as an independent truth source.

**Step 4: Make approval output factual and retryable**

In `handleApproveBrief`, capture the controller token before consent/finalization. Map outcomes only to:

```text
persisted=true, delivered=true -> Delivered to the Balance team
persisted=true, queued=true    -> Queued for the Balance team
persisted=true otherwise      -> Brief saved
any failure                   -> The brief was not sent. Please retry or contact the team directly.
```

Pass `approvalOperation`, factual transfer status, and `requiresReapproval` to `ReviewPanel`. Delete `telegramBroadcastStatus`, `crmQueued`, `crmRevision`, and chat copy claiming approval/readiness or producer review. Keep internal response fields available to backend integrations but do not pass them into visible components.

On a successful edit, apply the returned canonical draft/version and leave the same mounted review component visible. Label its next primary action `Send updated brief to Balance`.

**Step 5: Run focused tests to verify GREEN**

Run the command from Step 2. Expected: PASS; retry is enabled after failure, stale success is ignored, and approve-edit-reapprove completes in one mounted panel.

**Step 6: Commit approval state**

```powershell
git add components/widget/use-widget-session-draft.ts components/widget/widget-overlay.tsx components/widget/review-panel.tsx tests/widget/widget-state-controllers.test.tsx tests/widget/review-panel.test.tsx tests/widget/widget-overlay-approve-idempotency.test.tsx tests/widget/widget-overlay-approved-confirmation.test.tsx tests/widget/widget-overlay-producer-upload.test.tsx
git commit -m "fix: centralize retryable canonical brief approval"
```

### Task 7: Cover The Desktop Intake Journey End To End

**Files:**
- Modify: `tests/e2e/intake.spec.ts`

**Step 1: Replace the one-shot complete-brief fixture with staged canonical fixtures**

Build a route fixture that records chat request bodies and returns incrementing canonical drafts/versions for project/objective, audience/outputs, planning, and references/contact. Return deterministic `stageRecaps` at boundaries. Make the draft PUT route accept one correction and return the next version. Make finalize fail once, then return queued, then support a second successful finalization after an edit.

Keep `/api/projects/:sessionId/consent` asserted before every finalize. Do not assert qualification fields even if the internal fixture contains them.

**Step 2: Add the failing desktop journey assertions**

Drive the browser through all four named stages and assert:

- Only one contextual question is visible as the current prompt.
- Timeline and budget rationale is visible before answering.
- `Not sure yet`/`Skip` literal answers advance optional stages and remain in the review.
- A stage-boundary recap uses only canonical wording.
- Editing/correcting the recap updates the canonical version and subsequent review.
- `Original wording` retains the first project statement while `AI-drafted summary` is separate.
- `Core brief ready` and `Optional details` render; no `8 of 8` renders.
- `Talk to the team without AI`, email, and scheduling remain available at each stage (factor a helper that asserts them after each boundary).
- The first send failure remains visible and retry works.
- Queued success says `Queued for the Balance team`, not delivered/reviewed.
- Editing after approval changes the CTA to `Send updated brief to Balance`; reapproval succeeds without the panel unmounting.
- The client surface never matches `/score|qualified|unqualified|misfit|crm|telegram|revision/i`.

**Step 3: Run the desktop E2E test to verify RED**

Run:

```powershell
npx playwright test tests/e2e/intake.spec.ts --project=desktop-chromium
```

Expected: FAIL until the integrated four-stage, recap, review, retry, and reapproval flow from Tasks 1-6 is complete.

**Step 4: Make only fixture/selector corrections required by the implemented public contract**

Do not weaken assertions with arbitrary sleeps, force clicks, internal IDs, or implementation-only selectors. Use roles, labels, stage text, and the existing stable `data-testid` attributes for the review panel/rail. Keep API fixtures shaped exactly like `chatResponsePayloadSchema`, `ProjectDraftResponse`, and `FinalizeLeadResponse`.

**Step 5: Run the desktop E2E test to verify GREEN**

Run the command from Step 3. Expected: PASS on `desktop-chromium` with one failed approval followed by retry and one approve-edit-reapprove sequence.

**Step 6: Commit desktop E2E coverage**

```powershell
git add tests/e2e/intake.spec.ts
git commit -m "test: cover thesis-aligned desktop intake"
```

### Task 8: Cover Mobile Copy, Reflow, Tabs, Errors, And Targets End To End

**Files:**
- Modify: `tests/e2e/mobile-intake.spec.ts`

**Step 1: Add failing mobile journey assertions**

Reuse staged canonical route fixtures, but keep this file independent of the desktop spec. At the configured Pixel 5 project and an explicit `page.setViewportSize({ width: 320, height: 640 })` case, assert:

- Every review direction/error says `Brief tab`; none says left/right/panel/rail.
- Chat/Brief tabs retain tablist/tab/tabpanel semantics, ArrowLeft/ArrowRight/Home/End behavior, focus, and selected state.
- Stage list, original wording, AI-drafted summary, review errors, and actions have no horizontal document or panel overflow.
- Every stage, skip, edit, Save, Cancel, retry, send, tab, and direct-human button has a bounding box at least 44 by 44 CSS pixels.
- A long original statement and long generated summary wrap and remain readable at 320 CSS pixels.
- An approval failure banner and Retry are visible from both Chat and Brief tabs.
- With `page.emulateMedia({ reducedMotion: 'reduce' })`, textual stage and transfer states remain visible and computed animations are `none`.
- Keyboard-only editing inserts a newline in multiline original wording, then explicit Save commits.

For 200 percent zoom behavior, use a 320 CSS pixel viewport and verify reflow/scroll metrics rather than browser UI zoom, which Playwright does not portably control.

**Step 2: Run mobile E2E to verify RED**

Run:

```powershell
npx playwright test tests/e2e/mobile-intake.spec.ts --project=mobile-chrome
```

Expected: FAIL if any directional copy, target size, multiline editor, shared error, reduced-motion, or 320px reflow behavior is missing.

**Step 3: Make only public-contract fixture/selector corrections**

Keep direct human access assertions at every stage. Do not use `force: true`, remove keyboard checks, or increase the viewport to hide overflow. Preserve existing confidential upload and narrow-widget tests.

**Step 4: Run mobile E2E to verify GREEN**

Run the command from Step 2. Expected: PASS for the new intake journey and all pre-existing mobile upload/layout tests.

**Step 5: Commit mobile E2E coverage**

```powershell
git add tests/e2e/mobile-intake.spec.ts
git commit -m "test: cover thesis-aligned mobile intake"
```

### Task 9: Run Full Verification And Commit Any Test-Only Corrections

**Files:**
- Modify only if verification exposes a thesis-intake regression: files already named in Tasks 1-8

**Step 1: Run the complete unit/component/API suite**

Run:

```powershell
npm test
```

Expected: all Vitest suites PASS. If an existing fixture constructs `LeadDraft` directly, add the three new empty string fields or spread `createDefaultLeadDraft()`; do not make the new fields optional to silence tests.

**Step 2: Run lint**

Run:

```powershell
npm run lint
```

Expected: exit 0 with zero warnings. Remove obsolete imports/functions such as qualification display helpers, numeric progress helpers, and component-local approval state rather than suppressing warnings.

**Step 3: Run the production build**

Run:

```powershell
npm run build
```

Expected: Next.js production build completes successfully with TypeScript checking the expanded draft and response contracts.

**Step 4: Run all Chromium E2E projects**

Run:

```powershell
npm run test:e2e
```

Expected: desktop Chromium, mobile Chrome intake, and mobile widget Chromium projects PASS. Inspect retained traces/screenshots for any failure instead of adding sleeps or retries locally.

**Step 5: Search client code and tests for prohibited stale copy**

Run:

```powershell
rg -n -i "8 of 8|[0-9]+ of [0-9]+ captured|score|qualified|unqualified|misfit|CRM|Telegram|revision|panel on the left|tab on the right" components/widget tests/widget tests/e2e
```

Expected: no client-visible production copy or positive UI assertion matches. Internal API fixtures may include backend response fields only where needed to prove they are not rendered; comments should not preserve stale UI requirements.

**Step 6: Review the final diff and repository state**

Run:

```powershell
git status --short
git diff --check
git diff --stat HEAD~8..HEAD
git log --oneline -10
```

Expected: no whitespace errors, no migration, no unrelated file, and one implementation commit per prior task. Confirm the review panel still uses canonical draft/version and approved draft/reference hashes.

**Step 7: Commit verification-only corrections if any were required**

If verification required fixture, type, or accessibility corrections, stage only those files and commit:

```powershell
git add <exact-files-corrected-during-verification>
git commit -m "test: complete thesis-aligned intake verification"
```

If no files changed, do not create an empty commit.
