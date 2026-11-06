# Security

JelHR stores personal data (contact details, employment status, exit-interview notes, signatures). This document describes the controls in place and the limits you should know before going live.

## Reporting a vulnerability

Email the repository owner privately (do not open a public issue) with steps to reproduce. Please allow time to fix before disclosure.

## Trust boundaries

| Plane | Identity | Session | Can do |
|---|---|---|---|
| **Platform** | `JELHR_SUPERADMIN_EMAIL` / `JELHR_SUPERADMIN_PASSWORD` Cloudflare secrets only — no database row | `jelhr_platform` cookie, 2 h, row in `platform_sessions` | Create organizations; create, reset, disable owner/admin accounts; suspend/close tenants |
| **Tenant** | `users` row (one email = one account, globally unique) | `jelhr_session` cookie, 8 h, row in `sessions` | Everything inside one organization, by role ([docs/rbac.md](docs/rbac.md)) |

The organization is **always** derived from the verified session, never from the request. Every tenant query filters on `organization_id`; cross-tenant ids return `404`. This is covered by `tests/platform.test.mjs`.

## Controls

**Authentication**
- PBKDF2-HMAC-SHA-256, 100,000 iterations (the maximum Cloudflare Workers' WebCrypto allows), 24-byte random salt, constant-time comparison. The iteration count is stored with each hash so it can be raised later.
- Equal work for unknown accounts (dummy derivation) and one generic error message to resist user enumeration.
- Rate limit: 8 failures per email+IP per 15 minutes → 15-minute lock. Account lock after 10 consecutive failures. Platform login: 5 failures per IP → 30-minute lock.
- Temporary passwords (`must_change_password`) block every API except `/api/auth/*` until changed. Minimum 14 characters.
- Changing a password revokes all other sessions; admin password resets revoke all sessions.

**Sessions**
- HS256 JWT in an `HttpOnly; Secure; SameSite=Strict` cookie, plus a server-side session row checked on every request (id, user, expiry, revocation **and** token hash). Logout, revoke-one, revoke-others, user disable, org suspension and offboarding finalization all revoke server-side.
- Fixed in v0.3: logout previously hashed the token with padded base64, never matched the stored hash and therefore never revoked the session.

**Request integrity** (`functions/api/_middleware.js`)
- State-changing requests must be same-origin (`Origin`, else `Sec-Fetch-Site`); a cookie-bearing request with neither header is rejected. Combined with `SameSite=Strict`, this closes CSRF.
- JSON-only bodies (`415` otherwise), 512 KB body cap, per-route caps on fields.
- `auditor` sessions are rejected on every write at the middleware, independent of route checks.
- Errors return a generic message with a request id; details go to the Functions log only.

**Browser**
- CSP is configured in `frontend/_headers`; the public careers route has a narrower Turnstile-specific override. Legacy v0.3 pages still contain inline style attributes, so do not claim a fully strict style CSP until those legacy elements are externalized. Inline scripts are being externalized and checked by `tests/static.test.mjs`.
- HSTS, `X-Frame-Options: DENY`, `nosniff`, COOP/CORP same-origin, restrictive `Permissions-Policy`.
- All dynamic markup goes through an escaping template tag; CSV exports neutralise spreadsheet formulas; login `next=` only accepts local page names.

**Audit**
- Every write inserts an `audit_logs` row in the same D1 batch as the change (actor, action, record, hashed IP, user agent). Platform actions go to `platform_audit`.
- E-signature events (created, viewed, signed, declined, voided, reminded) are recorded separately with hashed IP and user agent.

**Email**
- Provider credentials are Cloudflare secrets, never in D1 or responses. `/api/health` reports only booleans.
- Header injection is stripped from every address and subject. Applicants need recorded consent; former employees can opt out and are only contacted at a personal address.

## Known limitations

- **PBKDF2 at 100k** is below OWASP's 600k recommendation for PBKDF2-SHA256; it is the platform ceiling. Long minimum length, rate limits and lockouts compensate. A memory-hard KDF would require a WASM implementation.
- **MFA is implemented in the v0.4 backend.** Email OTP, TOTP and passkeys are supported by the API; the v0.4 UI is still under review in draft PR #7. Keep enforced MFA policies disabled until enrollment, recovery and login ceremonies have passed real-browser testing. Protect the platform super admin with a long unique passphrase and an independent TOTP secret.
- **Rate limits live in D1**, not at the edge. Add a Cloudflare WAF rate-limiting rule for `/api/auth/login` and `/api/platform/login` for volumetric protection.
- **Offboarding records the work, it doesn't do it.** Identity provider, device management and payroll actions still happen in those systems.
- **Electronic signatures** provide a tamper-evident record (see [docs/e-signature.md](docs/e-signature.md)); they are not qualified/certificate-based digital signatures.
- **Preview deployments** share the production database unless you configure `[env.preview]` (see DEPLOYMENT.md).
- **Retention**: there is no automatic deletion. Applicants can be erased individually; define a schedule for former employees and signature records.

## Secrets hygiene

Never commit `.dev.vars` (ignored; enforced by tests). Rotate `JELHR_JWT_SECRET` if exposed (signs everyone out). Rotate SES keys by creating a new key, updating the secret, then deleting the old key.
