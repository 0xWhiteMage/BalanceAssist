# Contributing

## Development

Use Node 22 and npm 10. The repository enforces this through `.node-version`, `.npmrc`, and `package.json`.

1. Create a branch from `main`.
2. Run `npm ci`.
3. Make the smallest focused change and add tests for changed behavior.
4. Run `npm run lint`, `npx tsc --noEmit`, and the relevant Vitest or Playwright tests.
5. Open a pull request. Do not commit `.env` files, credentials, production data, `.scratch/`, or `.artifacts/`.

Use `npm run test:e2e` after installing Chromium once with `npx playwright install chromium`. CI installs the browser and operating-system dependencies separately.

## Database And Releases

Never point `TEST_DATABASE_URL` at production. Database changes require a new incremental migration and disposable-stack proof. Do not edit previously released migrations.

Production releases run only through `.github/workflows/production-release.yml`. Contributors must not deploy, promote a Vercel alias, run a production migration, or configure a webhook outside the documented protected workflows and approvals.

## Reviews

Security-sensitive changes require independent CODEOWNER review when an eligible reviewer is available. Release evidence belongs in GitHub issues using the exact SHA and role fields enforced by the production workflow; do not put secrets or customer data in review records.
