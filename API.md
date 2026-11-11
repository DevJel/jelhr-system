# JelHR API reference (v0.4)

## Unreleased: audit browser workflow

`GET /api/audit?limit=100` returns the current tenant's audit entries to authenticated owner, admin or auditor roles. The audit browser view renders this existing API; authorization and tenant scope remain server-enforced. This change adds no endpoint or migration.


All tenant APIs are same-origin Pages Functions under `/api`. JSON request and response bodies are used unless a route is a file download. Tenant identity is derived from the authenticated server-side session; callers must not supply an organization ID to select another tenant. State-changing requests require same-origin request metadata.

## Health and public endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Readiness and binding status; does not prove SES delivery. |
| GET | `/api/auth/config` | Public login configuration including the Turnstile site key. |
| GET | `/api/auth/options?workspace=...` | Public sign-in methods for a workspace. |
| GET | `/api/public/careers?org=slug` | Branded careers content and open jobs. |
| GET | `/api/public/jobs/:id` | Public job details. |
| POST | `/api/public/jobs/:id/apply` | Candidate application, résumé and privacy consent. |
| GET | `/api/public/logo` | Public organization logo. |

## Tenant authentication and account

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/login` | Password first factor using email, username or employee ID; workspace may be supplied. |
| POST | `/api/auth/mfa` | Complete an email OTP, TOTP or passkey challenge. |
| POST | `/api/auth/passkey` | Discoverable passkey sign-in. |
| GET | `/api/auth/me` | Current authenticated user/session. |
| POST | `/api/auth/logout` | Revoke current session. |
| GET/POST | `/api/mfa` | List and enroll TOTP, email OTP and passkey methods. |
| DELETE | `/api/mfa/:id` | Remove an enrolled method. |
| GET | `/api/auth/sso/start` | Begin OIDC authorization-code + PKCE. |
| GET | `/api/auth/sso/callback` | Complete OIDC sign-in. |
| GET/POST | `/api/auth/invite` | Inspect invitation, send code and accept invitation. |
| GET/POST/PATCH | `/api/users`, `/api/users/:id` | List, invite and manage tenant users. |

## People and employee lifecycle

| Method | Route | Purpose |
|---|---|---|
| GET/POST | `/api/employees` | List/create employee records. |
| GET/PATCH | `/api/employees/:id` | Read/update one employee. |
| GET/POST/DELETE | `/api/employees/:id/documents` | List, upload and delete employee paperwork. |
| GET | `/api/files/:id` | Authorized private file download. |
| GET/POST/PATCH | `/api/onboarding`, `/api/onboarding/:id` | Onboarding plans and task completion. |
| GET/POST/PATCH | `/api/offboarding`, `/api/offboarding/:id` | Offboarding cases, tasks, approvals and closure. |
| GET/POST/PATCH | `/api/time` | Time clock and timesheet workflows. |

### Time and onboarding workflow details

All requests require the effective `time` or `onboarding` feature and a tenant session. Reads default to the caller's own employee record; `scope=team` is limited to HR/auditors or a manager's direct reports. Time accepts optional `from` and `to` UTC start-date filters, defaults to the last 30 days, and returns at most 1,000 entries. Onboarding returns at most 2,000 tasks. There is no pagination in these routes.

- `POST /api/time` takes `action: clock_in|clock_out`, optional `note`, and `breakMinutes` on clock-out. Entries are stored and audited. `PATCH /api/time/:id` supports own pending-entry `note` and `breakMinutes`, or manager/HR `approvalStatus: pending|approved|rejected`; self-approval is prohibited. Breaks cannot exceed elapsed entry time.
- `POST /api/onboarding` requires HR access and `employeeId`, plus `plan: standard` or a custom `title` and optional `ownerLabel`, `dueDate`, and `description`. `PATCH /api/onboarding/:id` supports `completed`; HR can also edit task fields. `DELETE` requires HR. Changes are audited and enforced by the backend, not by UI visibility.

## Recruitment

| Method | Route | Purpose |
|---|---|---|
| GET/POST | `/api/jobs` | List/create jobs. |
| GET/PATCH/DELETE | `/api/jobs/:id` | Read/update/close a job. |
| GET | `/api/applicants` | List applicants and stages. |
| GET/PATCH | `/api/applicants/:id` | Read/update applicant. |
| POST | `/api/applicants/:id/hire` | Convert applicant into employee and start onboarding. |
| GET/POST | `/api/interviews` | List/schedule interviews. |
| GET/PATCH/DELETE | `/api/interviews/:id` | Manage an interview. |
| GET | `/api/recruitment/stats` | Recruitment pipeline counts. |

## AI and knowledge

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/ai` | `ask`, `hr_draft`, `rewrite`, `job_description`, `screen_applicant`, `draft_message`, `explain_document`, `summarize_exit`. |
| GET/POST | `/api/ai/conversations` | List/create conversation. |
| GET/PATCH/DELETE | `/api/ai/conversations/:id` | Read/update/delete a private conversation. |
| GET/POST/PATCH/DELETE | `/api/knowledge`, `/api/knowledge/:id` | Manage organization-scoped knowledge sources. |

AI output is advisory. Applicant screening must not make automated hiring decisions. Drafts require authorized human review.

## Workspace settings and platform

| Method | Route | Purpose |
|---|---|---|
| GET/PATCH | `/api/settings` | Branding, auth policy, SSO, careers, country and AI profile. |
| GET | `/api/platform/overview` | Super-admin totals and health. |
| GET/POST | `/api/platform/organizations` | List/create organizations. |
| GET/PATCH | `/api/platform/organizations/:id` | Organization status, features and AI quota. |
| POST | `/api/platform/login` | Separate platform-admin sign-in. |

## Error handling

Errors are JSON and include a stable status code and message. Tenant-scoped records that are absent or outside the caller's organization return 404. Insufficient privileges return 403. Validation failures return 400. Rate limits return 429. Do not expose internal stack traces or secret values to clients.


## Sign-in options contract and security notes

`GET /api/auth/options?workspace=<slug>` returns public workspace branding, allowed identifier types, MFA policy level/methods, passkey availability and SSO availability. It returns `found:false` for missing or inactive workspaces. This response is configuration for rendering only; the backend reloads and enforces policy during login.

`POST /api/auth/login` requires `identifier`, `password`, `turnstileToken`, and optionally `workspace`. It verifies Turnstile against the request hostname and the `login` action, rate-limits attempts, verifies credentials, rejects suspended organizations and returns either an HttpOnly session cookie or an MFA challenge. Credential failures use a generic message.

`POST /api/auth/mfa` actions:
- `{ "action":"email", "challengeId":"…" }` sends a short-lived email OTP. The response contains delivery status only; never an OTP value.
- `{ "action":"passkey_options", "challengeId":"…" }` returns WebAuthn assertion request options for enrolled credentials.
- `{ "action":"verify", "challengeId":"…", "method":"email_otp|totp", "code":"…" }` verifies a code.
- `{ "action":"verify", "challengeId":"…", "method":"passkey", "credential":{…} }` verifies a WebAuthn assertion.

Authentication challenge and session responses must be non-cacheable. Never expose OTPs, TOTP secrets, SSO client secrets, session tokens, password hashes or internal errors. The full flow and required test matrix are documented in [docs/authentication-and-sign-in.md](docs/authentication-and-sign-in.md).
