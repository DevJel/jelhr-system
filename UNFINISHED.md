# JelHR v0.4 — frontend implementation status

## Workflow sync update (unreleased)

The time and onboarding screens now call their existing tenant APIs instead of using browser-local sample data. The dashboard and employee workspace link to them. This is not a claim that every JelHR feature is synchronized or production-ready. Payroll, attendance, leave, projects, invoices, payslips, meetings and external system synchronization are not provided by these changes. Pagination and real-time cross-session refresh are not implemented. Complete the release gates below using synthetic data before production.

The v0.4 backend and migration 0004 are deployed in the Operava Business Pages project. This branch builds the corresponding browser workflows while preserving the v0.3 pages. It is a draft PR and is not deployed to production.

## Backend implemented

Migration `migrations/0004_recruitment_ai_auth.sql` is additive and has been applied to the production database. The API areas below are implemented and covered by the repository integration suite:

| Area | API | Notes |
|---|---|---|
| Recruitment | `/api/jobs`, `/api/applicants`, `/api/interviews`, `/api/recruitment/stats` | Job pipeline, applicant stages, interviews, hire-and-onboard. |
| Public careers | `/api/public/careers`, `/api/public/jobs/:id`, `/api/public/jobs/:id/apply` | Branded job board, rate limiting, honeypot, optional Turnstile, résumé validation and email confirmation. |
| Paperwork | `/api/employees/:id/documents`, `/api/files/:id` | Private employee files via R2 or D1 fallback. |
| AI | `/api/ai`, `/api/ai/conversations/:id` | Ask, HR draft, rewrite, job description, applicant screen, document explanation and exit summary. Advisory only. |
| Knowledge | `/api/knowledge` | Organization-scoped HR policies, handbook, labour-law notes and templates. |
| Auth | `/api/auth/login`, `/api/auth/mfa`, `/api/auth/passkey`, `/api/auth/sso/*` | Email/username/employee ID, policy-based MFA, WebAuthn and OIDC/PKCE. |
| Invitations | `/api/users`, `/api/auth/invite` | Invite link, email code, password and optional username. |
| Workspace settings | `PATCH /api/settings` | Authentication, branding, careers, custom domain, country and AI profile. |
| Platform | `/api/platform/overview`, `/api/platform/organizations` | Super-admin organization and feature administration. |

## Frontend implemented in branch v0.4-frontend

- Recruitment workspace: jobs, applicant pipeline, interview scheduling, advisory screening and hire/onboard.
- Public careers page and application form with résumé upload, privacy consent, honeypot and Turnstile.
- AI assistant: organization-scoped chat, HR drafting/checklist and knowledge-base management.
- Invitation acceptance with email code and password setup.
- Workspace users: invite, role/status, username, MFA reset and resend invitation.
- Workspace settings: branding/careers, auth/SSO settings, AI profile and read-only organization feature entitlements.
- Security: email/TOTP enrollment, passkey enrollment and passkey/passwordless sign-in ceremonies.
- Employee directory with profile editing and an employee drawer containing paperwork upload/download/delete.
- Separate platform administrator login and overview, organization creation and per-organization status/feature/quota editing.
- Feature-aware v0.4 navigation, responsive styles, public careers CSP override, externalized demo/employee scripts.
- Login supports workspace selection, SSO discovery and policy-driven email/TOTP/passkey MFA.

## Remaining release gates

1. **TOTP QR code**: authenticator setup currently displays the secret for manual entry. A local QR encoder and OpenCV/browser scan verification remain.
2. **Real browser/device testing**: verify WebAuthn enrollment/sign-in on Android Chrome, desktop Chrome and Safari; verify TOTP and email MFA; verify SSO against test Entra ID, Google and Okta tenants.
3. **Platform administration**: test bootstrap credentials, TOTP, organization creation, feature toggles and AI quota updates against a synthetic tenant. Latest production health previously reported `platformAdmin: false`.
4. **SES**: perform a controlled real delivery test for invitation, OTP, interview and candidate confirmation messages. The mailer binding being configured does not prove delivery.
5. **Turnstile**: verify a real valid challenge on the production hostname and confirm missing, expired, replayed and wrong-host tokens are rejected.
6. **Custom careers domain**: add the domain to the Cloudflare Pages project after it is saved in workspace settings; verify DNS, TLS, tenant routing and Turnstile hostname allowlisting.
7. **Files**: verify R2 upload/download/delete, file size limits and authorization boundaries using synthetic files.
8. **AI**: verify Workers AI availability, quota exhaustion, source citations, private conversations, organization isolation and HR-only knowledge audience.
9. **Feature gates**: verify hidden navigation and server-side denial for each disabled organization/user feature.
10. **Accessibility and UI**: test keyboard navigation, focus, form errors, screen-reader labels, mobile drawers/tables, reduced-motion behavior and loading/empty/error states.
11. **Automated checks**: run `npm test` and `npm run test:ui`. The current UI command performs static route/asset/script checks; it is not a substitute for browser/device validation.
12. **Privacy/legal review**: confirm privacy notice, applicant retention, employee access/export/deletion, labour-law content and e-signature language.
13. **Production go-live**: complete every item in `DEPLOYMENT.md`, deploy the approved branch, then smoke-test each production workflow before entering real data.

## Release safety

- Keep this branch as a draft until all CI checks pass and the release gates above are closed.
- Do not merge/deploy this branch directly to production while UI/device/SES/Turnstile verification is outstanding.
- Keep organization MFA enforcement disabled until all supported enrollment and login methods are tested.
- Use synthetic employee/applicant records only until the go-live checklist passes.
- Human HR staff remain responsible for all hiring and employment decisions. AI screening and drafting are advisory only.
