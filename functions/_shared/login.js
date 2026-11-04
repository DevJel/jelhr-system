// Shared sign-in steps: workspace resolution, identifier lookup, MFA challenges, session issue.
import { respond, HttpError, clientIp } from "./http.js";
import { sha256b64, randomToken } from "./crypto.js";
import { createSession } from "./auth.js";
import { loadPolicy, mfaRequiredFor } from "./authpolicy.js";

export const MFA_CHALLENGE_MINUTES = 10;

/** Organization from an explicit workspace slug, or from a branded custom domain (Host header). */
export async function resolveWorkspace(env, request, workspace) {
  if (workspace) {
    const org = await env.DB.prepare("SELECT id, name, slug, status, custom_domain, features_json FROM organizations WHERE slug=? COLLATE NOCASE").bind(String(workspace).trim().toLowerCase()).first();
    return org || null;
  }
  const host = new URL(request.url).hostname.toLowerCase();
  return await env.DB.prepare("SELECT id, name, slug, status, custom_domain, features_json FROM organizations WHERE custom_domain=?").bind(host).first() || null;
}

const USER_FIELDS = "u.id, u.organization_id, u.email, u.display_name, u.password_hash, u.password_salt, u.role, u.status, u.locked_until, u.failed_login_count, u.must_change_password, u.username";

/** Find a user by email (global), username or employee ID (within a workspace). */
export async function findUser(env, request, identifier, workspace) {
  const id = String(identifier || "").trim();
  if (!id) return { user: null, kind: null };
  if (id.includes("@")) {
    const user = await env.DB.prepare(`SELECT ${USER_FIELDS} FROM users u WHERE u.email=? COLLATE NOCASE LIMIT 1`).bind(id.toLowerCase()).first();
    return { user, kind: "email" };
  }
  const org = await resolveWorkspace(env, request, workspace);
  if (!org) return { user: null, kind: "username", needsWorkspace: !workspace };
  const policy = await loadPolicy(env, org.id);
  const byUsername = await env.DB.prepare(`SELECT ${USER_FIELDS} FROM users u WHERE u.organization_id=? AND u.username=? COLLATE NOCASE`).bind(org.id, id).first();
  if (byUsername) return { user: policy.identifiers.includes("username") ? byUsername : null, kind: "username", org };
  const byEmployee = await env.DB.prepare(`SELECT ${USER_FIELDS} FROM users u JOIN employees e ON e.user_id=u.id WHERE e.organization_id=? AND e.employee_number=? COLLATE NOCASE`).bind(org.id, id).first();
  return { user: byEmployee && policy.identifiers.includes("employee_id") ? byEmployee : null, kind: "employee_id", org };
}

/** Second-factor methods this user can use right now under the org policy. */
export async function availableMethods(env, user, policy) {
  const { results } = await env.DB.prepare("SELECT id, type, label, credential_id, transports FROM mfa_methods WHERE user_id=? AND confirmed_at IS NOT NULL").bind(user.id).all();
  const enrolled = (results || []).filter(m => policy.methods.includes(m.type));
  const types = new Set(enrolled.map(m => m.type));
  const required = mfaRequiredFor(policy, user.role);
  if (policy.methods.includes("email_otp") && (required || types.has("email_otp"))) types.add("email_otp");
  return { enrolled, types: [...types], required };
}

export async function userPayload(env, user) {
  return { id: user.id, email: user.email, name: user.display_name, role: user.role, organizationId: user.organization_id, mustChangePassword: Boolean(user.must_change_password) };
}

/** Issue a session and the JSON response for it. */
export async function finishLogin(env, request, user, { authMethod, mfaMethod, extra = [] }) {
  const s = await createSession(env, request, user, { authMethod, mfaMethod });
  await env.DB.batch([...s.statements, ...extra]);
  return respond({ user: await userPayload(env, user), mfaEnrollmentRequired: mfaMethod === "bootstrap" }, 200, { "Set-Cookie": s.cookie });
}

/** After the first factor: either sign in now, or open an MFA challenge. */
export async function afterFirstFactor(env, request, user, { authMethod, skipMfa = false, extra = [] }) {
  const policy = await loadPolicy(env, user.organization_id);
  const m = await availableMethods(env, user, policy);
  const needMfa = !skipMfa && (m.required || m.enrolled.length > 0);
  if (!needMfa) return finishLogin(env, request, user, { authMethod, mfaMethod: skipMfa ? authMethod : null, extra });
  let methods = m.types;
  let bootstrap = false;
  if (!methods.length) { methods = ["email_otp"]; bootstrap = true; } // required, nothing enrolled, email not allowed: verify by email, then enroll
  const id = crypto.randomUUID();
  await env.DB.batch([
    ...extra,
    env.DB.prepare("INSERT INTO auth_challenges(id,purpose,user_id,organization_id,challenge,data_json,expires_at) VALUES(?,?,?,?,?,?,?)")
      .bind(id, "mfa", user.id, user.organization_id, randomToken(16), JSON.stringify({ authMethod, methods, bootstrap, ipHash: await sha256b64(clientIp(request)) }), new Date(Date.now() + MFA_CHALLENGE_MINUTES * 60000).toISOString())
  ]);
  const [local, domain] = user.email.split("@");
  return respond({ mfaRequired: true, challengeId: id, methods, bootstrap, emailHint: `${local.slice(0, 2)}${"•".repeat(Math.max(1, local.length - 2))}@${domain}` });
}

export async function loadChallenge(env, id, purpose) {
  const c = await env.DB.prepare("SELECT * FROM auth_challenges WHERE id=? AND purpose=?").bind(String(id || ""), purpose).first();
  if (!c || c.consumed_at || Date.parse(c.expires_at) < Date.now()) throw new HttpError(400, "This sign-in step has expired. Start again.", { code: "challenge_expired" });
  if (c.attempts >= 5) throw new HttpError(429, "Too many attempts. Start the sign-in again.");
  c.data = (() => { try { return JSON.parse(c.data_json || "{}"); } catch { return {}; } })();
  return c;
}

export const consumeChallenge = (env, id) => env.DB.prepare("UPDATE auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(), id);
export const failChallenge = (env, id) => env.DB.prepare("UPDATE auth_challenges SET attempts=attempts+1 WHERE id=?").bind(id).run();
