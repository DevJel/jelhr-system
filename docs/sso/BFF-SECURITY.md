# JelHR + Operava eSign BFF security boundary

## Browser contract

The browser uses same-origin /api/bff/* endpoints only for application API traffic. The Worker/Pages Functions maps those routes to private implementation handlers after authentication, CSRF, host and role checks. The legacy eSign /api/* route namespace returns 404 to direct callers, except the non-user health/CSP/probe endpoints.

BFF responses are UI projections, not serialized database records or identity tokens. The browser must never receive:
- OIDC access or ID tokens, refresh tokens, SAML assertions, signing keys or private certificate material
- Database connection strings, internal service addresses or SQL text
- Tenant IDs, token-derived user IDs, session hashes or authorization-code verifier values

The network panel will still show the public /api/bff/* URL, request method, status, timing and response fields. A BFF cannot hide the existence of its own public endpoint; it keeps the implementation and sensitive data server-side.

## JelHR (IdP)

- Browser login uses /api/bff/auth/config, /api/bff/auth/login and /api/bff/auth/mfa.
- /api/bff/auth/me requires a valid jelhr_session cookie and returns exactly email, displayName and avatar.
- /api/bff/auth/navigation returns only the display name and role needed for navigation; it omits all database identifiers.
- MFA completion preserves the HttpOnly session cookie but returns only a minimal UI role marker, not the full user or organization object.
- Existing server-side session validation, OTP, Turnstile, CSRF and role checks remain in place.
- Direct /api/internal/*, /api/admin/* and /api/db/* requests require a valid session cookie; the endpoint's own role/ownership checks still apply.

JelHR's OIDC token and JWKS endpoints are protocol endpoints for trusted relying parties such as Cloudflare Access. They are not BFF browser APIs. The private RS256 signing JWK stays in server-side secret storage. The Actalis edge TLS certificate is not reused as an application JWT signing key.

## Operava eSign (SP)

- src/frontend/assets/api.js rewrites same-origin /api/* calls to /api/bff/* before fetch.
- src/index.ts maps BFF paths to internal handlers after enforcing the BFF boundary.
- Legacy browser requests to internal /api/* handlers are rejected (404), with explicit health, CSP report and service probe exceptions.
- Every protected BFF route still uses the existing Cloudflare Access host/audience validation, app session, CSRF and role checks.
- /api/bff/auth/me returns exactly email, display name and avatar placeholder. /api/bff/auth/context is a separate UI session endpoint for role/host and the in-memory CSRF nonce; it contains no internal user ID, tenant ID, Access JWT or token claims.
- /api/bff/esign/documents runs a server-side owner-scoped query and returns only document ID, title, status and creation time.
- /api/bff/sso/exchange uses the verified Cloudflare Access identity on the server to create the host-bound eSign HttpOnly session. The browser receives only the session cookie and CSRF value.

The eSign session is a random opaque __Host-esign_sid cookie (HttpOnly, Secure, SameSite=Strict, Path=/), stored server-side as a hash and limited to eight hours absolute / 30 minutes idle. No JWT or refresh token is stored in browser storage. Cloudflare Access handles its own identity session; the eSign app does not copy the Access JWT into JavaScript.

Document ownership in the current eSign schema is user-scoped (owner_user_id), not tenant-scoped. The new document projection obtains that owner from the verified server-side session and never accepts an owner or tenant ID from request JSON/query parameters. Do not introduce tenant-wide queries unless the schema and authorization model are explicitly migrated to tenant membership and every query is scoped accordingly.

## TLS and signing key separation

The Actalis certificate is for TLS termination/origin trust. OIDC JWT signing uses a dedicated RSA signing key/JWK and public JWKS. Never export or copy the Actalis TLS private key into application code or use it as a token signing key. Cloudflare-managed TLS and the existing origin TLS configuration must be validated independently of this BFF change.

## Verification

Run JelHR:
- npm test
- npm run test:ui

Run eSign:
- npm ci
- npm run check

The eSign BFF integration tests verify that:
- sanitized identity omits internal user and tenant identifiers
- legacy direct API calls are rejected
- BFF routes require a valid app session
- document list projection is minimal and owner-scoped

This change is staged on feature branches and must pass CI and end-to-end browser verification before merge/deploy. It does not rotate secrets, change production authentication modes, alter DNS, migrate production data, or deploy either app.
