# Protected Release Toolchain Design

## Goal

Remove High-severity findings from the locked Vercel CLI dependency and ensure promotion can execute its local CLI without relying on state from earlier jobs.

## Approach

Pin `vercel` to version `54.17.3`, the registry-supported release that removes the current High audit chain. Keep all workflow invocations on the repository-local binary.

The promote job will first check out only `needs.validate.outputs.sha`, set up Node through the existing immutable action pin, and install the lockfile with `npm ci`. The alias command will remain local and retain its token checks; no user ref is used outside the validation job and no credential bypass is introduced.

## Validation

The parsed workflow test will assert the dependency version, local binary references, and promote prerequisites. It will be made red before the package and workflow changes. Verification includes the targeted test, audit at High, full tests, lint, TypeScript, E2E with two workers, and whitespace diff validation.
