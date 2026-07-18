# Post-Merge Live Settings Runbook

Repository changes do not alter GitHub or Vercel settings. After merging CI, release, or scheduler policy changes, a repository administrator must verify the following without copying secret values into issues or logs.

## GitHub

1. Confirm `main` requires the `release-proof` CI check and blocks force pushes and branch deletion. Require CODEOWNER review only when an independent eligible reviewer is available; do not deadlock a solo-maintainer repository.
2. Confirm Actions uses read-only default workflow permissions and does not allow Actions to create or approve pull requests.
3. Create or verify the environments named in `README.md`. Keep deployment branches restricted to `main` and require approval where supported.
4. Set `RELEASE_TRUSTED_REVIEWERS` to a comma-separated list of unique GitHub logins authorized to sign release-review issues. Set `RELEASE_MIN_REVIEWERS` to the required number of distinct reviewers, from `1` through `5`; use the highest threshold the repository can actually staff. Both variables are mandatory and fail closed. Five separate role-specific, SHA-bound issue artifacts are still required, and one allowlisted reviewer may cover multiple roles only when the configured threshold permits it. Changes to either variable are auditable administrative events and must be reviewed outside the release being approved.
5. Verify environment secrets and variables against the table in `README.md`. Never expose their values while checking them.
6. Enable private vulnerability reporting and Actions failure notifications for maintainers.
7. Confirm Dependabot version updates and security updates are enabled.
8. Manually run each active scheduler workflow after a settings change and verify `Scheduler health` returns healthy.

## Vercel

1. Confirm the project is disconnected from its Git repository so pushes cannot create deployments. Protected production releases continue through Vercel CLI.
2. Confirm the production alias is exactly `https://balance-assist.vercel.app` and points to the deployment promoted by the latest successful `Production release` run.
3. Confirm production environment variables match `.env.example` and the release checks in `README.md`, including exact allowed origins, trusted client IP header, private upload bucket, numeric `TELEGRAM_ALLOWED_USER_IDS`, and disabled Monday write lanes until separately approved.
4. Confirm `CRON_SECRET` matches the GitHub Actions secret without displaying or logging either value.
5. Record the verification time in the protected GitHub environment variable `VERCEL_GIT_DEPLOYMENTS_DISABLED_AT` using UTC ISO-8601. This attestation is required before migration `061` and release promotion; it does not change the Vercel setting. Do not update it unless the setting was actually checked.

## Evidence And Escalation

Record the settings pages checked, checker identity, UTC time, and related commit SHA in a private administrative record. Do not record secret values. If any control differs, stop releases, correct the setting, rotate potentially exposed credentials, inspect deployment and Actions history, and rerun CI plus scheduler health before releasing.
