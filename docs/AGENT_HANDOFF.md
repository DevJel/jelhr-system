# JelHR agent handoff — mandatory project operating guide

> Read this file, [README.md](../README.md), [API.md](../API.md), [DEPLOYMENT.md](../DEPLOYMENT.md), [SECURITY.md](../SECURITY.md), [RBAC.md](../RBAC.md), and [docs/architecture.md](architecture.md) before changing code. This guide is intentionally self-contained so a new agent does not need conversation memory.

## 1. Mission and source of truth

- Repository: `DevJel/jelhr-system`; default branch: `main`.
- Product: JelHR, a multi-tenant Human Resources Information System (HRIS).
- Hosting/runtime: Cloudflare Pages + Pages Functions.
- Primary data store: Cloudflare D1; private files: R2; AI: Workers AI and optional Vectorize; outbound email: internal `MAILER` service binding backed by Amazon SES.
- Pages project name in Wrangler: `jelhr-system`.
- Production hostname historically used: `https://hris.internal.operavaglobal.com`. Verify DNS and current deployment before claiming it is live.
- Correct Cloudflare account for production: **Jelvan - Business - Operava**. Do not deploy from or mutate **Jelvan - Projects - Works**.
- Never infer production readiness from a successful GitHub workflow. CI and Cloudflare deployment are separate checks.

## 2. Mandatory rules for every agent

1. Inspect the current `main` tree, recent commits, open PRs, workflow runs, and relevant files before editing. Do not rely on a prior agent's summary as source code.
2. Work on a feature branch. Do not push directly to `main`, force-push, or rewrite history.
3. Preserve current production behavior and existing resources. Never delete/recreate D1, R2, Vectorize, DNS, Pages, or mailer resources as a shortcut.
4. Use additive D1 migrations. Never edit a migration already applied to production; create the next numbered migration.
5. Tenant scope must come from the verified session's `organization_id`, not from request body, query string, browser storage, or a caller-controlled header.
6. Validate roles and ownership in the server handler. Hiding a button is not authorization.
7. Keep credentials and secrets in encrypted Cloudflare secrets. Never commit secrets, print them, return them to clients, or place them in `wrangler.toml`.
8. Never expose OTP values, password hashes, TOTP secrets, private keys, access tokens, raw identity documents, or internal stack traces in API responses or logs.
9. Every change must include tests and documentation. Update `README.md` for every meaningful feature/security/API/deployment change and update the relevant detailed document.
10. Add or update Mermaid diagrams when architecture, authentication, data flow, or deployment behavior changes.
11. Do not enable MFA/passkey/SSO enforcement until the actual browser flows and recovery paths are tested against production-like resources.
12. Do not use real employee/applicant data before privacy, access, retention, backups, and incident response gates are satisfied.
13. Never claim merged, deployed, configured, or tested unless the corresponding source/tool result confirms it.
14. Keep preview deployments disabled until isolated preview D1/R2/Vectorize/secrets/service bindings exist.
15. Use human review for AI-generated HR content. AI must not autonomously reject candidates, change employment status, or send sensitive HR/legal messages.

## 3. Required change workflow

### Before editing
- Read relevant route, shared module, schema/migration, frontend caller, tests, README and API reference.
- Trace the complete request: page -> frontend module -> API route -> shared helper -> D1/R2/AI/MAILER.
- Identify tenant boundary, role boundary, PII, state transitions, error behavior, audit event and rollback.
- Record assumptions and unresolved production dependencies in the PR description.

### While editing
- Keep route handlers thin; put reusable logic in `functions/_shared/`.
- Use prepared D1 statements and explicit organization filters.
- Enforce request-size, content-type, same-origin, input validation, rate limiting and safe errors.
- Use `DB.batch()` for related writes where possible.
- Audit sensitive changes (access, employee lifecycle, payroll-related settings, auth, files, exports).
- Add tests for success, invalid input, unauthenticated, forbidden role, cross-tenant access, rate limit, expired challenge and failure behavior as applicable.
- Do not add dependencies without documenting why and reviewing runtime compatibility.

### Before opening PR
Run:
```sh
node --version
npm test
npm run test:ui
npm run db:migrations:list
```
Also run any route-specific scripts and inspect the diff. If a command cannot run locally, state that explicitly; do not substitute a claim of success.

### PR requirements
- Small, reviewable commits on a named feature branch.
- Include purpose, changed routes/tables/bindings, security impact, migration instructions, tests/results, rollback plan and deployment impact.
- Include screenshots or browser/device evidence for UI changes.
- Update `README.md`, `API.md`, `CHANGELOG.md`, and detailed docs as applicable.
- Merge only after required checks pass and mergeability is confirmed.

## 4. Repository structure

```text
.
├── .github/workflows/       # CI and OIDC provider checks
├── frontend/                # Static HTML/CSS/ES modules served by Pages
│   ├── css/                 # App, auth, responsive and component styles
│   ├── js/                  # Login, navigation, HR domains and page controllers
│   └── *.html               # User-facing pages
├── functions/               # Cloudflare Pages Functions API
│   ├── _middleware.js       # Global API security/error/request controls
│   ├── _shared/             # Auth, crypto, email, OIDC, OTP, files, domain helpers
│   ├── api/                 # REST endpoints by domain
│   └── oauth/               # Operava OIDC provider endpoints
├── migrations/              # Ordered, additive D1 migrations
├── tests/                   # Node built-in test suite and D1 test helpers
├── scripts/                 # Offline server, smoke/UI checks and utilities
├── docs/                    # Architecture, auth, agent and production runbooks
├── API.md                   # Route contract
├── README.md                # Project entry point; always keep current
├── DEPLOYMENT.md             # Cloudflare setup, migrations and release gates
├── SECURITY.md               # Threat model and security operations
├── RBAC.md                   # Role and permission matrix
└── wrangler.toml             # Non-secret Pages resource bindings
```

## 5. Authentication and sign-in contract

Current sign-in building blocks:
- `GET /api/auth/config`: public Turnstile site-key configuration.
- `GET /api/auth/options?workspace=<slug>`: workspace branding, allowed identifiers, MFA policy methods, passkey availability and SSO availability.
- `POST /api/auth/login`: password first factor; identifier may be email, username or employee ID. Username/employee ID require workspace resolution. Turnstile is validated server-side.
- `POST /api/auth/mfa`: send email OTP, obtain passkey assertion options, verify email OTP/TOTP/passkey.
- `POST /api/auth/passkey`: discoverable passkey sign-in.
- `GET /api/auth/sso/start` and callback: OIDC authorization-code + PKCE.
- `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/password`.
- `/api/mfa`: authenticated enrollment and management.
- `/api/auth/invite`: invitation inspect, OTP and acceptance.

Sign-in policy is stored in `organization_settings.settings_json.auth`. Supported identifiers: `email`, `username`, `employee_id`. MFA methods: `passkey`, `totp`, `email_otp`. Levels: `off`, `admins`, `all`. SSO configuration must never expose the encrypted client secret.

**Important:** Email OTP is a second factor in a login challenge; it is not a substitute for password reset or account recovery. Recovery must be separately authorized, audited and rate limited. Never send a development OTP in a production response.

See [Authentication and sign-in](authentication-and-sign-in.md) for detailed state transitions and test requirements.

## 6. Cross-system identity / shared JWT requirement

JelHR is intended to interoperate with the Multi Agent AI and MASTER AI systems using shared JWT trust. Before implementing cross-app SSO:
- Agree one issuer, audience model, signing algorithm and key-rotation policy.
- Prefer asymmetric signing (private key only at issuer; public JWKS at verifiers) for multi-service verification.
- Validate `iss`, `aud`, `sub`, `exp`, `nbf`, `iat`, `jti`, tenant/organization and scopes.
- Use short-lived access tokens; use separate, revocable refresh/session credentials.
- Do not reuse a single symmetric secret across unrelated services if a public/private key model is available.
- Never place a shared signing key in browser code or public Pages variables.
- Keep app-specific sessions and permissions distinct; shared identity does not imply shared authorization.
- Coordinate key rotation and emergency revocation across all relying applications.
- Do not change the existing production issuer/keys until the owner has approved a migration plan and compatibility has been tested.

## 7. Required documentation updates

For every feature, update:
- `README.md`: status summary, capability, entry points, setup/operations and links.
- `API.md`: methods, paths, authentication, request/response fields, status/error codes.
- `CHANGELOG.md`: user-visible or operational change.
- `docs/architecture.md`: topology or data-flow changes.
- `SECURITY.md`: new threats, controls, secrets, retention or incident implications.
- `DEPLOYMENT.md`: new bindings/secrets/migrations and rollback steps.
- Relevant domain guide and tests.

## 8. Production status discipline

A change is **implemented** only when code exists. It is **verified** only when automated and relevant manual tests pass. It is **merged** only when GitHub reports the PR merged. It is **deployed** only when Cloudflare reports a successful production deployment for the merged commit. It is **production-ready** only after all go-live gates in [production plan](production-plan.md) are evidenced.

Do not report a single generic “complete” status when any of these stages differ.
