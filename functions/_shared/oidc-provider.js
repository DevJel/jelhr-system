import { b64url, fromB64url, randomToken, sha256b64 } from "./crypto.js";
import { requireUser } from "./auth.js";
import { respond, HttpError } from "./http.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PRIVATE_FIELDS = new Set(["d", "p", "q", "dp", "dq", "qi", "oth", "k"]);

export function issuerFor(request, env) {
  return String(env.JELHR_OIDC_ISSUER || new URL(request.url).origin).replace(/\/$/, "");
}
export function getClients(env) {
  let parsed;
  try { parsed = JSON.parse(env.OPERAVA_OIDC_CLIENTS_JSON || "{}"); }
  catch { throw new HttpError(503, "OIDC client registry is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new HttpError(503, "OIDC client registry is unavailable.");
  return parsed;
}
export function getClient(env, clientId) {
  const client = getClients(env)[clientId];
  if (!client || !Array.isArray(client.redirectUris) || !client.redirectUris.length) return null;
  return client;
}
function parsePrivateJwk(env) {
  try {
    const jwk = JSON.parse(env.JELHR_OIDC_PRIVATE_JWK || "");
    if (jwk.kty !== "RSA" || !jwk.n || !jwk.e || !jwk.d) return null;
    return jwk;
  } catch { return null; }
}
export function publicJwk(env) {
  const privateJwk = parsePrivateJwk(env);
  if (!privateJwk) return null;
  const pub = Object.fromEntries(Object.entries(privateJwk).filter(([k]) => !PRIVATE_FIELDS.has(k)));
  pub.use = "sig"; pub.alg = "RS256"; pub.kid = String(env.JELHR_OIDC_KID || "operava-oidc-2026-01");
  return pub;
}
async function signingKey(env) {
  const jwk = parsePrivateJwk(env);
  if (!jwk) throw new HttpError(503, "OIDC signing key is not configured.");
  return crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}
export async function signRs256(payload, env) {
  const kid = String(env.JELHR_OIDC_KID || "operava-oidc-2026-01");
  const header = b64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT", kid })));
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const input = header + "." + body;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await signingKey(env), encoder.encode(input));
  return input + "." + b64url(signature);
}
export async function verifyRs256(token, env) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return null;
    const header = JSON.parse(decoder.decode(fromB64url(parts[0])));
    const payload = JSON.parse(decoder.decode(fromB64url(parts[1])));
    const jwk = publicJwk(env);
    if (!jwk || header.alg !== "RS256" || header.kid !== jwk.kid) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, fromB64url(parts[2]), encoder.encode(parts[0] + "." + parts[1]));
    if (!ok || typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}
export async function parseTokenRequest(request) {
  const raw = await request.text();
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (type === "application/x-www-form-urlencoded") return Object.fromEntries(new URLSearchParams(raw));
  if (type === "application/json") {
    try { const parsed = JSON.parse(raw || "{}"); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); return parsed; }
    catch { throw new HttpError(400, "invalid_request"); }
  }
  throw new HttpError(415, "unsupported_media_type");
}
export async function requireSignedInUser(request, env) {
  const auth = await requireUser(request, env);
  return auth.error ? { error: auth.error } : { user: auth.user };
}
export function oidcError(error, status = 400) {
  return respond({ error }, status, { "Cache-Control": "no-store", "Pragma": "no-cache" });
}
export async function createAuthorizationCode(env, user, clientId, redirectUri, challenge, nonce, scope) {
  const code = randomToken(32);
  await env.DB.prepare("INSERT INTO oidc_authorization_codes(code_hash,client_id,user_id,organization_id,redirect_uri,code_challenge,nonce,scope,expires_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(await sha256b64(code), clientId, user.id, user.organization_id, redirectUri, challenge, nonce, scope, new Date(Date.now() + 300000).toISOString()).run();
  return code;
}
export async function exchangeAuthorizationCode(env, body, issuer) {
  const clientId = String(body.client_id || ""), client = getClient(env, clientId);
  if (!client) throw new HttpError(401, "invalid_client");
  if (body.grant_type !== "authorization_code") throw new HttpError(400, "unsupported_grant_type");
  const code = String(body.code || ""), redirectUri = String(body.redirect_uri || ""), verifier = String(body.code_verifier || "");
  if (!code || !redirectUri || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !client.redirectUris.includes(redirectUri)) throw new HttpError(400, "invalid_grant");
  const row = await env.DB.prepare("SELECT * FROM oidc_authorization_codes WHERE code_hash=? AND client_id=?").bind(await sha256b64(code), clientId).first();
  if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now() || row.redirect_uri !== redirectUri) throw new HttpError(400, "invalid_grant");
  const challenge = b64url(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
  if (challenge !== row.code_challenge) throw new HttpError(400, "invalid_grant");
  const consumed = await env.DB.prepare("UPDATE oidc_authorization_codes SET consumed_at=? WHERE code_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING user_id, organization_id, nonce, scope")
    .bind(new Date().toISOString(), row.code_hash, new Date().toISOString()).first();
  if (!consumed) throw new HttpError(400, "invalid_grant");
  const user = await env.DB.prepare("SELECT u.id,u.organization_id,u.email,u.display_name,u.role,u.status,o.status AS organization_status FROM users u JOIN organizations o ON o.id=u.organization_id WHERE u.id=? AND u.organization_id=?")
    .bind(consumed.user_id, consumed.organization_id).first();
  if (!user || user.status !== "active" || user.organization_status !== "active") throw new HttpError(400, "invalid_grant");
  const now = Math.floor(Date.now() / 1000), expiresIn = 300;
  const claims = { iss: issuer, sub: user.id, aud: clientId, iat: now, exp: now + expiresIn, userId: user.id, tenantId: user.organization_id };
  const idToken = await signRs256({ ...claims, nonce: consumed.nonce, email: user.email, name: user.display_name, role: user.role }, env);
  const accessToken = await signRs256({ ...claims, scope: consumed.scope, token_use: "access" }, env);
  return { access_token: accessToken, token_type: "Bearer", expires_in: expiresIn, id_token: idToken, scope: consumed.scope };
}
