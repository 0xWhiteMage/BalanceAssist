# Thesis-Aligned Intake Design

## Scope

This design implements Task 6 of the approved trust-centered remediation. It
changes the AI intake and brief review only; session, draft, reference,
finalization, and consent APIs remain the authority.

## Selected Approach

Extend the existing versioned JSON draft with `projectObjective`, `audience`,
and `intendedOutputs`, and use the existing `projectScope` as the user's
original project wording and `scopePolished` as optional generated
interpretation. This needs type, tool-schema, prompt, flow, and presentation
changes but no database migration because the canonical draft already accepts
versioned fields.

Rejected alternatives:

- Packing audience, outputs, and objective into `projectScope` is smaller but
  loses editability, stage completion, and reliable verbatim attribution.
- A new intake table and workflow state machine provides stricter structure
  but duplicates the mature canonical draft/version path.
- Client-only stage and summary state is simple but can disagree after reload,
  conflict, approval, or retry.

## Experience

Show one labelled stage indicator throughout intake:

1. **Project and objective**: capture what is being made and what it should
   achieve.
2. **Audience and outputs**: capture who it is for and the intended formats or
   deliverables.
3. **Timeline and budget**: explain that timing helps assess planning and
   feasibility, while budget helps suggest realistic formats and scope.
4. **References and contact**: offer references, then capture a usable contact
   route.

Ask one contextual question at a time. At each stage boundary, render a short
factual recap from the latest canonical fields, for example `So far: launch
film for young adults; social cut-downs requested.` Do not add inferred facts.
The user can correct the recap before continuing.

`Not sure yet`, `Skip`, and `Prefer not to share` are explicit valid actions
where relevant. Store their literal, stable values rather than treating them
as missing. They never prevent `Talk to the team without AI`, email, or
scheduling. Timeline and budget remain optional for brief readiness.

Desktop review copy can refer to the brief panel. At mobile widths all prompts
and errors say `Brief tab`, including `Your core brief is ready. Review it in
the Brief tab.`

## Brief Review

Replace field-count progress such as `8 of 8 captured` with two semantic
groups:

- `Core brief ready` when there is a project need (`projectScope`,
  `projectObjective`, or `service`) and a contact route (`contactName` or
  `contactEmail`).
- `Optional details` for audience, outputs, timeline, budget, company,
  references, and other non-gating context.

The card shows `Original wording` from `projectScope` unchanged. If
`scopePolished` exists and differs, show it separately as `AI-drafted summary`;
never substitute it for or overwrite the original. Long original and generated
fields use multiline editors. User edits are saved as `confirmed`; generated
interpretation remains provenance `inferred` until the user edits it.

The primary action is `Send brief to Balance`. Confirmation copy describes
only observable states such as `Brief saved`, `Queued for the Balance team`,
or `Delivered to the Balance team`. Client copy must not contain score,
qualified, unqualified, misfit, CRM, Telegram, or revision terminology, and
must not claim producer review before it occurs.

## Architecture And Data Flow

`conversation/flow.ts` and the system prompt define the four stages, rationales,
valid non-answers, and stage-boundary recap policy. The tool schema accepts the
new fields and continues to reject fabricated values. The chat route loads the
canonical versioned draft, gives that state to the model, validates updates,
writes with the current draft version, and computes readiness from the saved
result.

The widget hydrates and renders only the latest server-returned draft and
version. Direct edits send an expected version and replace UI state with the
successful or conflict response; a failed save leaves the previous canonical
value visible. References remain in the existing canonical reference path.

Readiness and stage completion are pure functions over canonical values. A
deterministic summary formatter produces factual stage recaps; model prose is
never used as readiness evidence. Existing JSON field provenance distinguishes
user wording, inferred summaries, confirmed edits, and cleared values.

Approval remains canonical through approved draft version and reference-set
hashes. The client may hold only transient `idle`, `pending`, and `error`
operation state:

1. `Send brief to Balance` records transfer consent and finalizes the current
   canonical version.
2. Success rehydrates or applies the server approval metadata.
3. Failure returns to `idle`, keeps an inline error, and enables retry.
4. Any successful canonical edit increments the draft version, so it no longer
   matches the approved version and `Send updated brief to Balance` appears.
5. Reapproval finalizes that new canonical version without unmounting the
   review panel.

The review component must not keep a second sticky approval lock. Duplicate
click suppression belongs to the shared approval controller and is released in
all failure, cancellation, and stale-operation paths.

## Errors

Stage answers and edits report whether saving failed or a newer server version
won. On conflict, replace the view with the returned canonical draft and ask
the user to reapply the intended change. Summary-generation failure falls back
to the canonical field list and does not block intake or human access.

Approval errors remain visible in Chat and Brief views, identify that the brief
was not sent, and offer retry plus direct human-contact fallbacks. Never infer
delivery from a successful local state transition.

## Accessibility

Use a named ordered stage list with current-stage text, not colour alone.
Announce stage changes, saved factual recaps, conflicts, approval pending,
failure, saved, queued, and delivered states through restrained live regions.
The Chat/Brief controls retain tab semantics and arrow-key behavior.

All stage, skip, edit, retry, and send controls are keyboard reachable, have
visible focus, and meet the existing 44 by 44 CSS pixel mobile target. Editors
have persistent labels; multiline fields do not make Enter an implicit submit.
At 320 CSS pixels and 200 percent zoom, stage text, original wording, generated
summary, errors, and actions reflow without horizontal scrolling. Reduced
motion does not remove textual progress or status.

## Tests

Use TDD at the existing boundaries:

- Conversation unit tests assert the four ordered stages, timeline/budget
  reasons, exact non-answer handling, stage-boundary factual recaps, and no
  fabricated or automated-fit language.
- Review-state tests cover semantic core readiness, optional omissions, and
  accepted uncertainty/skip values.
- Brief-card and review-panel tests prove original wording is retained,
  generated text is labelled `AI-drafted summary`, no `8 of 8` or forbidden
  operational/qualification copy renders, and long fields are multiline.
- Controller and overlay tests cover canonical conflict replacement, failed
  approval retry, duplicate-click suppression, and approve-edit-reapprove in
  one mounted component.
- Desktop Playwright tests cover all stages, periodic corrections, optional
  answers, send statuses, and human access at every stage.
- Mobile Playwright tests require `Brief tab` wording, keyboard-operable tabs,
  44px targets, 320px reflow, and errors visible from either tab.
- Accessibility checks cover names, focus order, live announcements, zoom,
  contrast, and reduced motion.

No test should require or assert score, qualification status, CRM, Telegram,
or revision wording in client-visible output. Backend integration may continue
to assert those internal contracts separately.

## Non-Goals

- Replacing the canonical session draft or finalization backend.
- Changing internal qualification, CRM, or provider integrations.
- Adding long-term memory or accepting confidential material.
- Making timeline, budget, optional details, or AI interpretation prerequisites
  for human contact.
