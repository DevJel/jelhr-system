# Authentication, sign-in options API and backend

## Scope and authoritative implementation

The current implementation lives in:
- `functions/api/auth/config.js`
- `functions/api/auth/options.js`
- `functions/api/auth/login.js`
- `functions/api/auth/mfa.js`
- `functions/api/auth/passkey.js`
- `functions/api/auth/sso/start.js`, `callback.js`
- `functions/api/auth/me.js`, `logout.js`, `password.js`, `invite.js`
- `functions/api/mfa/`
- `functions/_shared/login.js`, `auth.js`, `authpolicy.js`, `otp.js`, `webauthn.js`, `oidc.js`, `crypto.js`

## Public options endpoint

`GET /api/auth/options?workspace=<slug>` resolves an active workspace using the explicit slug or the request's branded hostname. It returns only sign-in display/configuration data:
```json
{
  "found": true,
  "workspace": {
    "slug": "example",
    "name": "Example Organization",
    "brandColor": null,
    "logoFileId": null
  },
  "identifiers": ["email", "username", "employee_id"],
  "passkey": true,
  "mfa": {
    "level": "admins",
    "methods": ["passkey", "totp", "email_otp"]
  },
  "sso": {
    "enabled": false,
    "enforced": false
  }
}
```
No password hash, user existence, private SSO secret, enrolled-user list, or token is returned. A missing/inactive workspace returns `{ "found": false }`. Treat the endpoint as public, cache only briefly, and never treat its output as authorization. Actual policy is reloaded server-side during authentication.

## Sign-in sequence

```mermaid
sequenceDiagram
  autonumber
  actor User
  participant UI as Login page
  participant Opt as GET /auth/options
  participant Login as POST /auth/login
  participant Policy as D1 policy + user
  participant MFA as POST /auth/mfa
  participant Session as Session service
  User->>UI: Select workspace and identifier
  UI->>Opt: Fetch public sign-in options
  Opt-->>UI: Branding + allowed methods (no secrets)
  User->>UI: Submit identifier + password + Turnstile token
  UI->>Login: First-factor request
  Login->>Login: Verify Turnstile, rate limit, password
  Login->>Policy: Check account + active organization + SSO/MFA policy
  alt MFA not required and no enrolled factor
    Login->>Session: Create server-side session
    Session-->>UI: HttpOnly Secure SameSite cookie
  else MFA required or enrolled factor exists
    Login->>MFA: Create short-lived challenge
    MFA-->>UI: challengeId + allowed factor types
    User->>UI: Verify OTP/TOTP/passkey
    UI->>MFA: Complete challenge
    MFA->>Session: Consume challenge + create session
    Session-->>UI: HttpOnly Secure SameSite cookie
  end
```

## Password and challenge rules

- Password login requires Turnstile token and server-side Siteverify success for the expected hostname and `login` action.
- Rate limit key is a one-way digest of identifier, workspace and client IP. Failed attempts are tracked; account lockout is applied after repeated failures.
- Suspended workspaces must not receive a session.
- Generic credential errors avoid revealing whether an email/username exists.
- MFA challenge lifetime is 10 minutes; maximum challenge attempts is 5.
- OTP lifetime is 10 minutes; maximum OTP verification attempts is 5; issuance is limited to 5 per 15 minutes.
- OTP values are HMAC-hashed in D1 and consumed after successful verification.
- Production responses must never contain the OTP value, even when a development/testing flag is accidentally configured.
- Session cookie is HttpOnly, Secure, SameSite=Strict, path-wide and expires after 8 hours. Session rows are checked on every authenticated request and can be revoked server-side.
- Password changes revoke other active sessions.

## Passkeys

WebAuthn ceremonies require user verification. Passkey records store credential ID, public JWK, sign counter and transports; private key material remains with the authenticator. Production configuration must set the exact RP ID and allowed HTTPS origins. Test real devices and browsers; mock assertions are not a production validation.

## TOTP

TOTP shared secrets must be encrypted at rest using the configured encryption key. Enrollment must remain unconfirmed until a code verifies. Never return the plaintext secret again after the enrollment flow. Test clock drift and recovery behavior.

## OIDC SSO

The SSO flow uses discovery, authorization code, PKCE, state and nonce validation. Enforce an allowlisted email domain when configured. Only provisioned/invited tenant accounts may sign in; do not auto-create accounts from arbitrary identity-provider claims. Verify issuer, audience, signature, expiry and nonce. Store client secrets encrypted and never include them in public options or logs.

## Security and operational requirements

- All state-changing API requests pass same-origin middleware and body/content-type limits.
- Every protected route must call `requireUser` / `authenticate` and enforce role + tenant scope.
- Public options are configuration hints only; all policy checks repeat server-side.
- Use `Cache-Control: no-store` for auth challenges, MFA and session responses. Avoid caching responses containing identity or challenge data.
- Do not log raw identifiers, email OTPs, password values, authorization codes, cookies, bearer tokens or raw IPs. Audit with minimized/hashed metadata.
- Use generic errors for credentials and recovery to prevent account enumeration.
- Add IP + identifier + workspace throttling to OTP send, passkey challenge and SSO start routes as well as password login.
- Require step-up authentication for high-risk actions (MFA reset, admin role grant, SSO policy change, API key/JWT rotation, bulk export).
- Add alerting for repeated failures, OTP abuse, unusual session creation and privilege changes.

## Required auth test matrix

| Scenario | Expected result |
|---|---|
| Unknown or inactive workspace | `found:false`; no branding or secrets |
| Valid active workspace | Only public options returned |
| Workspace query tries another tenant's records | No user data disclosed |
| Missing/invalid Turnstile | Login rejected |
| Turnstile wrong host/action | Login rejected |
| Invalid password / unknown user | Same generic credential response |
| Suspended organization with valid password | 403; no session cookie |
| Rate limit reached | 429; no session |
| MFA policy off and no enrolled factor | Session cookie after password |
| MFA required | Short-lived challenge only; no session until verified |
| Email OTP sent | No OTP in JSON response |
| Wrong/expired/replayed OTP | Rejected; challenge remains unusable after max attempts |
| Valid OTP/TOTP/passkey | Challenge consumed and session created |
| Unregistered/disabled passkey | Rejected |
| SSO state/nonce/issuer/audience mismatch | Rejected; no session |
| Cross-tenant user ID or resource ID | 404/403; no data disclosure |
| Logout/revoked session | Subsequent protected request returns 401 |

## Current verification caveat

This document defines the API contract and required test coverage. A documented flow is not evidence that every browser/device ceremony or production provider integration has passed. Record actual CI results, real email delivery, Turnstile verification, device tests and Cloudflare deployment evidence in the PR and release record.
