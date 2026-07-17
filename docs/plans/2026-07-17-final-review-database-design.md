# Final Review Database Design

## Scope

Add forward migration 055 without modifying applied migrations 047 or 054. The migration replaces `public.finalize_session_lead(uuid)` so an objective is a valid project-detail signal, approved CRM revisions contain the thesis-aligned brief fields, and the RPC returns server-owned approval hashes.

## Database Contract

The replacement preserves every existing input, output, qualification rule, consent gate, lock, idempotency key, CRM revision, Monday obligation, and Telegram handoff behavior. It appends `approval_input_hash text` and `approved_reference_set_hash text` to the result.

Project readiness accepts any nonblank value among service, project scope, objective, timeline, or budget, while still requiring contact name or email. Qualification internals remain unchanged. The CRM payload preserves existing keys and adds `projectObjective`, `audience`, `intendedOutputs`, `scopePolished`, and `referencesStatus`.

The approved reference hash is SHA-256 over compact JSON for normalized, valid HTTPS references sorted by URL then kind and represented as `{kind,url}`. This matches the project draft route's canonical-reference hashing semantics. The approval input hash remains the established SHA-256 over draft version and the canonical approved reference payload.

## Protected Release

Migration 055 has a separate immutable SQL Editor artifact, hash-pinned runner, and main-trusted manually dispatched workflow. The workflow may reuse the `production-trust-migrations` approval environment but cannot execute the 054 artifact. The ordinary production runner excludes both reviewed migrations and requires both versions to be recorded before applying later migrations.

## Verification

Source and policy tests pin migration identity, hashes, artifact boundaries, workflow trust, and ordinary-runner prerequisites. DB-gated tests prove objective-only persistence/readiness, exact CRM payload additions, exact return hashes, normalized-reference determinism, and retry behavior. Verification runs policy tests and TypeScript compilation without running production migration tooling.
