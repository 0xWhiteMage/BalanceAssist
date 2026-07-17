# Task 3 Quality Hardening Design

## Goal

Ensure chat and manual draft mutations never replace canonical widget state with stale, malformed, cross-session, or late asynchronous results, and emit every completed-stage recap exactly once per completion transition.

## Architecture

For chat turns that produce no draft changes, the route reloads the authenticated session draft after the provider returns. It compares the reloaded version with the version used to build the provider prompt. An unchanged version returns the freshly loaded canonical draft; a changed version returns a conflict containing the latest canonical draft.

The project-draft client validates GET 200, PUT 200, and PUT 409 payloads with strict Zod schemas. Invalid responses become null or an explicit non-conflict failure and therefore cannot be interpreted as an empty version-zero canonical draft.

The widget draft hook owns an operation generation tied to the active session. Session replacement, reset, explicit invalidation, and unmount invalidate outstanding operations. Chat canonical responses and manual edits apply only when their captured token still matches and their version is not older than the current canonical version. A same-version identical canonical response is a no-op so approval state remains intact.

Recap generation compares completed-stage counts rather than current-stage indexes. Newly completed stages are the half-open range between the prior and current counts, allowing the final references/contact stage to emit once when complete while no-op responses emit no duplicate recap.

## Error Handling

- A failed no-op reload returns `draft_save_failed` rather than stale state.
- A changed no-op reload returns `draft_conflict` with latest state.
- Malformed draft API responses never mutate local state.
- Late or cross-session operation results and their follow-up messages are ignored.
- Older canonical versions are ignored even when their operation token remains current.

## Testing

Use strict TDD for four boundaries: route no-op concurrency, client runtime validation, hook/overlay deferred operation invalidation, and completed-stage recap transitions. Run focused tests after each cycle, then all relevant tests, the full suite, TypeScript, lint, and `git diff --check`.
