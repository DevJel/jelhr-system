# Operava company SSO — JelHR as OIDC Identity Provider

## Scope

JelHR is the authoritative employee identity provider for Operava-owned applications. This additive implementation provides OpenID Connect Authorization Code with PKCE S256. It does not replace JelHR's existing sign-in or third-party OIDC client integration.

The first relying party is the Operava eSign application (client ID: esign). Future Operava apps can be registered using an exact redirect URI and permitted scopes.

## Endpoints

- GET /.well-known/openid-configuration
- GET /oauth/authorize
- POST /oauth/token
- GET /oauth/userinfo
- GET /oauth/jwks.json

Only Authorization Code + PKCE S256 is supported. Implicit flow, password grant, wildcard redirect URIs and client secrets for public clients are not supported. Authorization codes are stored as SHA-256 hashes, expire after five minutes and are consumed once. Access and ID tokens are RS256-signed and expire after five minutes.

SAML is not included in this OIDC-first implementation.

## Required production configuration

Set these as Cloudflare Pages production secrets/variables for JelHR. Never put private key material in GitHub files, Wrangler vars, frontend code or logs.

| Name | Type | Value |
|---|---|---|
| JELHR_OIDC_ISSUER | Variable | Exact canonical HTTPS JelHR identity-provider origin, no trailing slash. |
| OPERAVA_OIDC_CLIENTS_JSON | Secret | JSON client registry; store only SHA-256 base64url hashes for confidential client secrets. |
| JELHR_OIDC_PRIVATE_JWK | Secret | Dedicated RSA private JWK for OIDC signing. |
| JELHR_OIDC_KID | Variable | Stable key identifier, e.g. operava-oidc-2026-01. |

Example client registry (replace callback with the exact deployed eSign callback URL):

~~~json
{
  "esign": {
    "redirectUris": ["https://YOUR-ESIGN-HOST/auth/oidc/callback"],
    "scopes": ["openid", "profile", "email"]
  }
}
~~~

The callback URL must match exactly. Do not use wildcard hosts, paths or regex matching.

Generate an RSA 2048-bit key pair locally with WebCrypto. Export the private JWK directly into the Cloudflare Pages secret prompt. The provider derives and publishes the public part at JWKS. Use a dedicated OIDC key, not the Actalis TLS certificate. Protect an offline recovery copy and plan key rotation by publishing old and new public keys concurrently before retiring the old key.

## Cloudflare Zero Trust as the eSign relying party

For the eSign front door, Cloudflare Access is the OIDC relying party (client) and eSign continues to validate the Access JWT on every employee request. The existing eSign Worker already supports this mode through its Access JWT verification and session exchange. This avoids duplicating OIDC token validation inside the eSign application.

Register a confidential client in JelHR for the Cloudflare Access team:

~~~json
{
  "cloudflare-access": {
    "redirectUris": ["https://YOUR-TEAM.cloudflareaccess.com/cdn-cgi/access/callback"],
    "scopes": ["openid", "profile", "email"],
    "clientSecretHash": "BASE64URL_SHA256_OF_THE_CLIENT_SECRET"
  }
}
~~~

Generate a unique high-entropy client secret. Give the raw secret only to the Cloudflare Zero Trust Generic OIDC provider configuration. Store only its SHA-256 base64url digest in the protected JelHR client registry. The token endpoint supports client_secret_basic and client_secret_post for confidential clients, and no client authentication for PKCE public clients.

In Cloudflare Zero Trust:
1. Add an OpenID Connect identity provider using JelHR's discovery document.
2. Set the client ID to cloudflare-access and use the raw generated client secret.
3. Use the authorization, token, userinfo and JWKS URLs from discovery.
4. Enable PKCE when configuring the OIDC connector.
5. Test the provider before assigning it to the eSign Access application.

Protect the eSign employee hostname with a Self-hosted Access application. Allow only the Operava employee email domain, set an eight-hour application session, and require independent MFA according to the selected Access policy. The eSign Worker must use STAFF_AUTH_MODE=access so its existing per-request Access JWT verification and application-session exchange remain active. Do not switch the Business manifest from local to Access mode until the Access application, identity provider and administrator sign-in have been verified.

The Cloudflare Access free plan is advertised for teams under 50 users. Custom certificate upload is a separate feature and is not available on Cloudflare Free; it is listed for Business and Enterprise plans. Therefore, the custom Actalis edge-certificate requirement is not compatible with a strict $0 Free-plan-only requirement. Use Cloudflare-managed edge TLS on Free, or confirm that the Operava zone already has an eligible Business/Enterprise plan before attempting a custom upload.

## Database

Apply migrations/0005_operava_oidc_provider.sql to the production D1 database before enabling the provider. It creates only a short-lived authorization-code table and does not modify HR records.

## Security behavior

- The authorize endpoint requires an active JelHR session. Without one, it redirects to JelHR login with a returnTo hint. The login page must resume that returnTo URL after the normal login/MFA flow; verify this before production.
- Client ID, exact redirect URI, response type, scope, nonce, state and PKCE S256 are validated.
- Tenant and user claims come from the server-validated JelHR session and database row, never browser-supplied identity fields.
- Tokens carry sub, userId and tenantId. Relying parties must validate signature, issuer, audience, expiry and nonce before creating their own session.
- Userinfo requires a valid RS256 access token and re-checks active user and tenant association.
- No email_verified claim is asserted because the current JelHR user schema has no verified-email flag.
- Authorization codes are one-time, short-lived and stored hashed.

## eSign relying-party requirements

The eSign callback must validate the ID token using the published JWKS and enforce signature, exact issuer, audience esign, expiry and nonce. It must then establish an HttpOnly, Secure session cookie with an eight-hour maximum lifetime. Every eSign database operation must derive tenant and user scope from the validated server-side session, not request parameters or client-side state.

Do not treat tenantId alone as authorization: verify the eSign user mapping and enforce tenant-scoped queries for every resource.

## Cloudflare Access and cost

Cloudflare Access is an optional outer access gate, not the OIDC identity provider. Do not configure Access to trust this same application as an upstream IdP until the product's supported custom OIDC provider requirements and plan entitlement have been confirmed. Application-level OIDC is sufficient for first-party SSO without a paid SAML add-on.

This implementation uses existing JelHR Pages Functions and D1. No paid SaaS identity provider is introduced. Actual Cloudflare pricing/entitlement and certificate-upload behavior must be confirmed in the Operava account before describing the entire deployment as guaranteed $0.

## Release gate

This branch is an implementation change, not production activation. Before production:
1. Configure issuer, client registry, private JWK and key ID as above.
2. Apply migration 0005.
3. Set the exact eSign callback URL.
4. Implement the eSign OIDC client and verify token handling.
5. Test login, MFA, wrong redirect URI, invalid state/nonce, wrong PKCE verifier, expired/replayed code, disabled user and cross-tenant isolation.
6. Deploy only after tests and review pass.
