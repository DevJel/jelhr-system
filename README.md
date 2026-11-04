# JelHR System

A multi-tenant HR workspace on **Cloudflare Pages + Pages Functions + D1**: people directory, applicants, time, onboarding, offboarding, electronic signatures and email communications — with a separate super-admin plane for creating organizations.

![JelHR](frontend/assets/img/og-image.png)

> **Release status — v0.4 backend deployed; frontend pending.** The Operava Business Pages deployment uses the v0.4 D1 schema (migrations 0001–0004), D1, R2, Workers AI, Vectorize and the internal SES mailer binding. The existing browser UI is still v0.3; the new recruitment, careers, MFA/passkey, SSO and AI screens are not finished. Do not enter real employee/applicant data until the [go-live checklist](DEPLOYMENT.md#release-status-and-go-live-checklist) is complete.

## What's included

| Area | Highlights |
|---|---|
| **Platform (super admin)** | Identity lives only in Cloudflare secrets. Creates organizations and their owner/admin accounts, resets or disables org admins, suspends tenants (instantly signs everyone out). Separate cookie, 2-hour sessions, own audit log. |
| **Multi-tenant RBAC** | Roles `owner`, `admin`, `hr_manager`, `manager`, `employee`, `auditor`. Every query is scoped to the organization from the verified session. Org admins can grant only HR/manager/employee/auditor — never owner/admin. Auditor (demo) is read-only at the API layer. |
| **People** | Tabs for **Directory**, **Applicants** and **Former employees**. Create/edit employees, managers, departments, CSV export (formula-injection safe), create sign-ins linked to employees. |
| **Offboarding** | Case tabs (In progress / Awaiting approval / Completed / Cancelled). Case detail tabs: **Checklist** (12 dated tasks with evidence notes), **Assets** (return / lost / write-off), **Exit interview & final pay**, **Documents**, **Activity**. Submit → admin finalization (type-to-confirm), blocked until tasks, assets, final pay and signatures are resolved. Finalizing terminates the employee, disables the login and revokes sessions in one batch. |
| **E-signatures** | Templates (separation acknowledgement, property return, confidentiality, policy, custom) with placeholders. Draw or type a signature, explicit consent, SHA-256 document fingerprint echoed back on signing, tamper detection, decline / void / remind, signing certificate with audit trail, print-to-PDF, fingerprint verification. |
| **Communications** | Compose to all employees, a department, selected people, applicants (by stage, consent required) or former employees (personal email, opt-out honoured). Live recipient count, merge fields, preview, yes/no confirmation, batched sending with progress, per-recipient delivery status, retry failed, cancel, drafts. **Amazon SES SMTP** through the internal `jelhr-mailer` Worker, which reads the shared Operava Secrets Store credentials. |
| **Time & onboarding** | Clock in/out with live timer and weekly chart, manager/HR approvals. Standard 9-step onboarding plan, custom tasks, progress rings. |
| **Security** | Tabs for password, own sessions, users & access, org sessions, audit log. Forced password change for temporary passwords. |
| **UX** | Owned SVG icon set (55 icons), favicon + app icons + manifest, original WebP illustrations, skeleton loading, error states with retry, toasts, offline notice, accessible tabs (keyboard arrows, hash-synced), yes/no confirmations for every destructive action, reduced-motion support, responsive tables, strict CSP. |

## Quick start (no Cloudflare account needed)

```bash
npm test                 # 37 integration + static tests, zero dependencies (Node 22.5+)
npm run dev:offline      # http://localhost:8788 with synthetic demo data
```

Seeded accounts (password `Correct-Horse-Battery-9`): `owner@northwind.test`, `katy.hr@northwind.test` (HR), `harry.login@northwind.test` (manager), `billie.login@northwind.test` (employee with documents to sign), `demo@northwind.test` (read-only auditor). Platform console: `/platform.html` with `platform@jelhr.local` / `local-platform-password-123`.

`npm run dev:offline` runs the real Pages Functions against a `node:sqlite` D1 shim and serves `frontend/` with the production `_headers` (CSP included). For full parity with Cloudflare use `npm run dev` (Wrangler) with a `.dev.vars` file copied from `.dev.vars.example`.

## Deploy

GitHub `DevJel/jelhr-system` → Cloudflare Pages project `jelhr-system` in Jelvan - Business - Operava (`main` deploys production at [jelhr-system-213.pages.dev](https://jelhr-system-213.pages.dev)). Preview deployments are disabled until isolated preview resources are available. Production bindings and migration history are documented in **[DEPLOYMENT.md](DEPLOYMENT.md)**.

## Documentation

| Document | Contents |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Secrets, migrations, first organization, SES/SMTP, CI, rollback, backups, go-live checklist |
| [SECURITY.md](SECURITY.md) | Threat model, controls, known limitations, reporting |
| [docs/architecture.md](docs/architecture.md) | Request flow, data model, tenancy, file layout |
| [docs/rbac.md](docs/rbac.md) | Roles and the permission matrix |
| [docs/api.md](docs/api.md) | Every API route |
| [docs/e-signature.md](docs/e-signature.md) | Signing ceremony, fingerprints, evidence, legal notes |
| [docs/communications.md](docs/communications.md) | Audiences, consent, SES/SMTP, batching |
| [docs/design.md](docs/design.md) | Theme tokens, icons, illustrations, motion, regenerating images |
| [CHANGELOG.md](CHANGELOG.md) | Release notes |

## Project structure

```
frontend/                 Static app (Pages output)
  *.html                  One file per page; no inline script or style (strict CSP)
  css/app.css             Single design system stylesheet
  js/core.js              API client, auth gate, shell, tabs, dialogs, toasts, states
  js/pages/*.js           Page modules
  assets/icons.svg        Owned SVG icon sprite
  assets/img/*.webp       Illustrations, team photo, OG image, app icons
  _headers, _redirects    Security headers, caching, redirects
functions/
  _shared/                Auth, crypto, validation, email (SES/SMTP), e-sign helpers
  api/                    Pages Functions routes (+ _middleware.js, [[path]].js)
migrations/               D1 schema (0001–0004, additive)
scripts/                  Offline dev server, D1 shim, seed, UI check, image generator
tests/                    node:test integration + static suites
design/illustrations/     SVG sources for the WebP illustrations
```

## Screenshots

| Dashboard | Offboarding case | E-sign certificate |
|---|---|---|
| ![Dashboard](docs/screenshots/dashboard.webp) | ![Offboarding](docs/screenshots/offboarding-case.webp) | ![Certificate](docs/screenshots/e-sign-certificate.webp) |

| Communications | Platform console |
|---|---|
| ![Communications](docs/screenshots/communications.webp) | ![Platform](docs/screenshots/platform.webp) |

Screenshots use synthetic seed data. Regenerate with `npm run dev:offline` and `npm run test:ui`.

## License

MIT — see [LICENSE](LICENSE).
