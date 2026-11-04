// Session authentication, role checks and audit logging.
import { respond, HttpError, clientIp, userAgent } from "./http.js";
import { verifyJwt, sha256b64, signJwt } from "./crypto.js";
import { loadPolicy, mfaRequiredFor } from "./authpolicy.js";
import { userFeatures } from "./features.js";

export { respond };

export const COOKIE = "jelhr_session";
export const SESSION_SECONDS = 60 * 60 * 8;

export const ROLES = ["owner", "admin", "hr_manager", "manager", "employee", "auditor"];
export const ADMIN = ["owner", "admin"];
export const HR = ["owner", "admin", "hr_manager"];
export const HR_READ = ["owner", "admin", "hr_manager", "auditor"];

// Roles an organization admin may grant. owner/admin accounts are created only by the platform super admin.
export const ORG_ASSIGNABLE = ["hr_manager", "manager", "employee", "auditor"];
export const PLATFORM_ASSIGNABLE = ["owner", "admin"];

export const isHr = user => HR.includes(user.role);
export const isAdmin = user => ADMIN.includes(user.role);

export function sessionCookie(token, maxAge = SESSION_SECONDS) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function readSessionToken(request) {
  const raw = (request.headers.get("Cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="));
  return raw ? raw.slice(COOKIE.length + 1) : null;
}

/**
 * Resolve the signed-in user from the session cookie.
 * Validates JWT signature + expiry, the server-side session row, active status
 * and (optionally) role membership. Returns { user } or { error: Response }.
 *
 * options.roles               allowed roles (empty = any authenticated role)
 * options.allowPasswordChange allow users flagged must_change_password through
 */
export async function requireUser(request, env, roles = [], options = {}) {
  const opts = Array.isArray(roles) ? { ...options, roles } : { ...roles };
  const token = readSessionToken(request);
  if (!token || !env.JELHR_JWT_SECRET || !env.DB) return { error: respond({ error: "Authentication required" }, 401) };
  const payload = await verifyJwt(token, env.JELHR_JWT_SECRET);
  if (!payload?.sid || !payload?.sub) return { error: respond({ error: "Session expired" }, 401) };
  const session = await env.DB.prepare(
    "SELECT id, token_hash, last_seen_at, mfa_method, auth_method FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?"
  ).bind(payload.sid, payload.sub, new Date().toISOString()).first();
  if (!session || session.token_hash !== await sha256b64(token)) return { error: respond({ error: "Session revoked" }, 401) };
  const user = await env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.display_name, u.role, u.organization_id, u.status, u.must_change_password, u.features_json,
            e.id AS employee_id, o.status AS organization_status, o.name AS organization_name, o.slug AS organization_slug,
            o.features_json AS organization_features
       FROM users u
       JOIN organizations o ON o.id = u.organization_id
       LEFT JOIN employees e ON e.user_id = u.id AND e.organization_id = u.organization_id
      WHERE u.id=?`
  ).bind(payload.sub).first();
  if (!user || user.status !== "active") return { error: respond({ error: "Account disabled" }, 401) };
  if (user.organization_status !== "active") return { error: respond({ error: "Organization is suspended. Contact your platform administrator." }, 403) };
  if (user.must_change_password && !opts.allowPasswordChange) {
    return { error: respond({ error: "Password change required", code: "password_change_required" }, 403) };
  }
  // Two-step verification policy: sessions started before MFA became required must sign in
  // again; sessions bootstrapped by email (no enrolled method yet) may only enroll a method.
  const policy = await loadPolicy(env, user.organization_id);
  user.mfa_required = mfaRequiredFor(policy, user.role);
  if (user.mfa_required && !session.mfa_method) return { error: respond({ error: "Your organization now requires two-step verification. Please sign in again.", code: "mfa_reauth" }, 401) };
  if (user.mfa_required && session.mfa_method === "bootstrap" && !opts.allowPasswordChange) {
    return { error: respond({ error: "Set up two-step verification to continue", code: "mfa_enrollment_required" }, 403) };
  }
  if (opts.roles?.length && !opts.roles.includes(user.role)) return { error: respond({ error: "Insufficient permission" }, 403) };
  user.session_id = session.id;
  user.session_mfa = session.mfa_method;
  user.auth_method = session.auth_method;
  user.features = userFeatures(user);
  // Refresh last_seen_at at most every five minutes to keep writes low.
  if (!session.last_seen_at || Date.now() - Date.parse(session.last_seen_at) > 5 * 60 * 1000) {
    await env.DB.prepare("UPDATE sessions SET last_seen_at=? WHERE id=?").bind(new Date().toISOString(), session.id).run();
  }
  return { user };
}

/** Same as requireUser but throws HttpError-compatible responses (used by newer routes). */
export async function authenticate(context, roles = [], options = {}) {
  const result = await requireUser(context.request, context.env, roles, options);
  if (result.error) throw new ResponseError(result.error);
  return result.user;
}

export class ResponseError extends Error {
  constructor(response) { super("response"); this.response = response; }
}

/** Build an audit statement. Pass the result to DB.batch() with the change it records, or call .run(). */
export async function auditStatement(env, user, action, type, id, metadata = null, request = null) {
  const ipHash = request ? await sha256b64(clientIp(request)) : null;
  const meta = metadata || request ? JSON.stringify({ ...(metadata || {}), ...(request ? { ua: userAgent(request).slice(0, 120) } : {}) }) : null;
  return env.DB.prepare(
    "INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,ip_hash,metadata_json) VALUES(?,?,?,?,?,?,?,?)"
  ).bind(crypto.randomUUID(), user.organization_id, user.id, action, type, id ?? null, ipHash, meta);
}

export async function audit(env, user, action, type, id, metadata = null, request = null) {
  await (await auditStatement(env, user, action, type, id, metadata, request)).run();
}

export function requireRole(user, roles, message = "Insufficient permission") {
  if (!roles.includes(user.role)) throw new HttpError(403, message);
}

/** Managers may act on employees who report to them. */
export async function isManagerOf(env, user, employeeId) {
  if (user.role !== "manager" || !user.employee_id) return false;
  const row = await env.DB.prepare("SELECT 1 AS ok FROM employees WHERE id=? AND organization_id=? AND manager_id=?")
    .bind(employeeId, user.organization_id, user.employee_id).first();
  return Boolean(row);
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.display_name,
    role: user.role,
    organizationId: user.organization_id,
    organizationName: user.organization_name || null,
    employeeId: user.employee_id || null,
    mustChangePassword: Boolean(user.must_change_password),
    username: user.username || null,
    organizationSlug: user.organization_slug || null,
    features: user.features || userFeatures(user),
    mfaRequired: Boolean(user.mfa_required),
    mfaEnrollmentRequired: Boolean(user.mfa_required && user.session_mfa === "bootstrap"),
    authMethod: user.auth_method || null
  };
}

/**
 * Build a new session for a user. Returns { token, cookie, statements } —
 * run the statements (session insert + last login) in one batch with any other changes.
 * mfaMethod: null (no second factor), 'bootstrap' (email-verified, must enroll), or the method used.
 */
export async function createSession(env, request, user, { authMethod = "password", mfaMethod = null } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const sid = crypto.randomUUID();
  const exp = now + SESSION_SECONDS;
  const token = await signJwt({ sub: user.id, org: user.organization_id, role: user.role, sid, iat: now, exp }, env.JELHR_JWT_SECRET);
  const iso = new Date().toISOString();
  return {
    token,
    cookie: sessionCookie(token),
    statements: [
      env.DB.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at,last_seen_at,user_agent,ip_hash,auth_method,mfa_method) VALUES(?,?,?,?,?,?,?,?,?)")
        .bind(sid, user.id, await sha256b64(token), new Date(exp * 1000).toISOString(), iso, userAgent(request), await sha256b64(clientIp(request)), authMethod, mfaMethod),
      env.DB.prepare("UPDATE users SET last_login_at=?, failed_login_count=0, locked_until=NULL WHERE id=?").bind(iso, user.id)
    ]
  };
}
