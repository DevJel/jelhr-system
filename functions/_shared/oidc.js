// OpenID Connect (authorization code + PKCE) for organization SSO:
// Microsoft Entra ID, Google Workspace, Okta, Auth0, Keycloak, JumpCloud…
import { b64url, fromB64url } from "./crypto.js";

const dec = new TextDecoder();
const fetcher = env => env.__fetch || fetch;

export async function discover(env, issuer) {
  const url = String(issuer).replace(/\/$/, "") + "/.well-known/openid-configuration";
  const r = await fetcher(env)(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Could not read the identity provider configuration (${r.status})`);
  const conf = await r.json();
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri", "issuer"]) if (!conf[k]) throw new Error("Identity provider configuration is missing " + k);
  return conf;
}

export async function pkcePair() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

export function authorizeUrl(conf, { clientId, redirectUri, state, nonce, codeChallenge, loginHint }) {
  const u = new URL(conf.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (loginHint) u.searchParams.set("login_hint", loginHint);
  return u.toString();
}

export async function exchangeCode(env, conf, { code, clientId, clientSecret, redirectUri, verifier }) {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier });
  if (clientSecret) body.set("client_secret", clientSecret);
  const r = await fetcher(env)(conf.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: body.toString() });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.id_token) throw new Error("The identity provider rejected the sign-in: " + (data.error_description || data.error || r.status));
  return data;
}

export async function verifyIdToken(env, conf, idToken, { clientId, nonce }) {
  const [h, p, s] = String(idToken).split(".");
  const header = JSON.parse(dec.decode(fromB64url(h)));
  const claims = JSON.parse(dec.decode(fromB64url(p)));
  const jwksRes = await fetcher(env)(conf.jwks_uri, { headers: { Accept: "application/json" } });
  const { keys = [] } = await jwksRes.json();
  const jwk = keys.find(k => k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!jwk) throw new Error("Signing key not found at the identity provider");
  let ok = false;
  const data = new TextEncoder().encode(h + "." + p);
  if (header.alg === "RS256") {
    const key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: jwk.n, e: jwk.e, ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(s), data);
  } else if (header.alg === "ES256") {
    const key = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, fromB64url(s), data);
  } else throw new Error("Unsupported ID token algorithm " + header.alg);
  if (!ok) throw new Error("ID token signature is invalid");
  const now = Date.now() / 1000;
  if (claims.iss !== conf.issuer) throw new Error("ID token issuer mismatch");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error("ID token audience mismatch");
  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new Error("ID token expired");
  if (claims.nonce !== nonce) throw new Error("ID token nonce mismatch");
  const email = String(claims.email || claims.preferred_username || claims.upn || "").toLowerCase();
  if (!email.includes("@")) throw new Error("The identity provider did not return an email address");
  if (claims.email_verified === false) throw new Error("Your email isn't verified at the identity provider");
  return { email, name: claims.name || null, subject: claims.sub };
}

// Backward-compatible issuer helper export for existing OIDC client tests/routes.
export { issuerFor } from "./oidc-provider.js";
