# Semantic Review Quality Hardening Design

## Scope

Harden the thesis-aligned brief review so approval, editing, references,
attribution, and visible transfer claims are driven by durable canonical facts.
Keep the existing versioned session draft, private reference-link endpoints,
producer-transfer consent endpoint, and finalization endpoint as authorities.

## State And Data Flow

The widget session-draft controller owns canonical draft values, field
provenance, draft version, reference links including IDs, approval metadata,
and transient approval operation state. Direct field edits return a typed
`saved`, `conflict`, or `failed` result. A successful canonical draft or
reference change invalidates approval and releases any completed approval lock,
allowing reapproval without remounting. Operation tokens prevent duplicate or
stale completion.

Project draft GET/PUT and canonical chat responses expose a visible provenance
map alongside flattened values. The UI labels `projectScope` as `Original
wording` only for `user-stated`, and `scopePolished` as `AI-drafted summary`
only for `inferred`. Confirmed values use neutral edited labels. Reload and
conflict replacement therefore preserve truthful attribution.

## Review Editing

Each row is activated only by its native Edit button. Multiline core and
optional prose wraps without ellipsis. Editors remain mounted while an async
save is pending, disable duplicate Save, and close only after canonical success.
Failure retains entered text and shows an inline `role="alert"` with Retry and
Cancel. Conflict applies the winning canonical draft and explains that the
latest saved value was reloaded.

`ProjectBriefCard` groups fields under accessible Core details and Optional
details headings. Readiness remains one project need plus one contact detail;
name is accepted, so visible copy says `contact detail`, not `contact route`.

## Private References

The Brief tab contains an inline Add/manage reference-links section. Adding
uses `POST /api/attachments/link` and removing uses the session-owned
`DELETE /api/attachments/link/[linkId]` endpoint. Neither action records or
requires producer-transfer consent. Pending, failure, retry, and removal errors
remain visible in the Brief tab. Any successful reference mutation refreshes
the canonical reference hash, invalidates prior approval, and permits
reapproval.

## Truthful Transfer Copy

Visible status maps only from finalization facts: persisted only is `Brief
saved`, queued is `Queued for the Balance team`, and delivered is `Delivered
to the Balance team`. Saved or queued states do not claim producer review or
follow-up. Scripted flow and post-finalization messages avoid promises unless
durable delivered or replied evidence exists.

## Testing

Strict red-green cycles cover controller approval invalidation and stale-token
handling, async row save outcomes, durable provenance responses and labels,
inline private link add/remove/error behavior, semantic grouping and target
sizes, truthful flow copy, and approve-edit-reapprove without remount or double
submit. Run focused widget/API tests, impacted mobile E2E, full Vitest,
TypeScript, lint, and diff checks before the final commit.
