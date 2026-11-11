# JelHR frontend

The Pages application uses authenticated, same-origin APIs for the dashboard, people directory, time, onboarding, security and settings. Auditor activity uses the read-only, tenant-scoped audit API. Legacy `employees.html`, `security.html`, `settings.html` and `demo.html` URLs redirect to the corresponding current screens; they no longer supply sample records.

The legacy browser-local mock application and navigation scripts have been removed. Synthetic fixtures remain in the test and development tooling and must not be used as production data. Refer to the root README, `SECURITY.md` and `DEPLOYMENT.md` for configuration and production release gates.

Run the automated checks from the repository root with `npm test` and `npm run test:ui`. Browser, provider, security and operational verification remain required before a production release.
