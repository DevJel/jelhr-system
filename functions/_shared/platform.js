// Platform (super admin) plane.
// The super admin is not a database user: the identity is defined only by Cloudflare
// secrets (JELHR_SUPERADMIN_EMAIL + JELHR_SUPERADMIN_PASSWORD). Platform sessions are kept
// in platform_sessions so they can be revoked, and use a separate cookie and JWT scope.
import { respond, clientIp } from "./http.js";
import { verifyJwt, sha256b64, safeEqual } from "./crypto.js";
import { ResponseError } from "./auth.js";
import { secret } from "./secrets.js";
import { verifyTotp } from "./crypto.js";

export const PLATFORM_COOKIE = "jelhr_platform";
export const PLATFORM_SESSION_SECONDS = 60 * 60 * 2;

// Super admin credentials come from Cloudflare secrets (plain Pages/Workers secrets or Secrets Store bindings).
export async function superCreds(env) {
  return { email: String((await secret(env, "JELHR_SUPERADMIN_EMAIL")) || "").trim().toLowerCase(), password: String((await secret(env, "JELHR_SUPERADMIN_PASSWORD")) || ""), totp: (await secret(env, "JELHR_SUPERADMIN_TOTP_SECRET")) || "" };
}
export async function platformConfigured(env) {
  const c = await superCreds(env);
  return Boolean(env.DB && env.JELHR_JWT_SECRET?.length >= 32 && c.email && c.password.length >= 16);
}

export function platformCookie(token, maxAge = PLATFORM_SESSION_SECONDS) {
  return `${PLATFORM_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function readPlatformToken(request) {
  const raw = (request.headers.get("Cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(PLATFORM_COOKIE + "="));
  return raw ? raw.slice(PLATFORM_COOKIE.length + 1) : null;
}

/** Compare the presented credentials with the secrets without leaking which part was wrong. */
export async function checkSuperAdminCredentials(env, email, password, code) {
  const c = await superCreds(env);
  const [a, b] = await Promise.all([sha256b64(String(password)), sha256b64(c.password)]);
  const ok = safeEqual(String(email).trim().toLowerCase(), c.email) && safeEqual(a, b);
  if (!ok) return { ok: false };
  if (c.totp) { if (!code) return { ok: false, totpRequired: true }; if (!await verifyTotp(c.totp, code)) return { ok: false, totpRequired: true, badCode: true }; }
  return { ok: true };
}

export async function requireSuperAdmin(context) {
  const { request, env } = context;
  if (!await platformConfigured(env)) throw new ResponseError(respond({ error: "Platform administration is not configured" }, 503));
  const token = readPlatformToken(request);
  const payload = token ? await verifyJwt(token, env.JELHR_JWT_SECRET) : null;
  if (!payload || payload.scope !== "platform") throw new ResponseError(respond({ error: "Platform sign-in required" }, 401));
  // The secret may have been rotated: a session for a different email is no longer valid.
  if (!safeEqual(payload.sub, (await superCreds(env)).email)) {
    throw new ResponseError(respond({ error: "Platform session is no longer valid" }, 401));
  }
  const session = await env.DB.prepare("SELECT id FROM platform_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?")
    .bind(payload.sid, await sha256b64(token), new Date().toISOString()).first();
  if (!session) throw new ResponseError(respond({ error: "Platform session revoked" }, 401));
  return { email: payload.sub, sessionId: session.id };
}

export async function platformAudit(env, request, actor, action, organizationId = null, resourceId = null, metadata = null) {
  return env.DB.prepare("INSERT INTO platform_audit(id,actor_email,action,organization_id,resource_id,metadata_json,ip_hash) VALUES(?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), actor.email, action, organizationId, resourceId, metadata ? JSON.stringify(metadata) : null, await sha256b64(clientIp(request)));
}
