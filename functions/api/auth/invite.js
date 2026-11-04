import { respond, readJson, HttpError } from "../../_shared/http.js";
import { sha256b64, hashPassword, passwordProblem } from "../../_shared/crypto.js";
import { issueOtp, verifyOtp } from "../../_shared/otp.js";
import { loadPolicy, mfaRequiredFor } from "../../_shared/authpolicy.js";
import { finishLogin } from "../../_shared/login.js";
import * as v from "../../_shared/validate.js";

async function invited(env, token) {
  const hash = await sha256b64(String(token || ""));
  const u = await env.DB.prepare(
    `SELECT u.id, u.organization_id, u.email, u.display_name, u.role, u.status, u.username, u.invite_expires_at, u.must_change_password, o.name AS org_name, o.slug
       FROM users u JOIN organizations o ON o.id=u.organization_id WHERE u.invite_token_hash=?`
  ).bind(hash).first();
  if (!u || u.status !== "invited") throw new HttpError(404, "This invitation link isn't valid. Ask your administrator to send a new one.");
  if (Date.parse(u.invite_expires_at) < Date.now()) throw new HttpError(410, "This invitation has expired. Ask your administrator to send a new one.");
  return u;
}

// GET /api/auth/invite?token=… — who the invitation is for.
export async function onRequestGet({ request, env }) {
  const u = await invited(env, new URL(request.url).searchParams.get("token"));
  const p = await loadPolicy(env, u.organization_id);
  const [l, d] = u.email.split("@");
  return respond({ email: `${l.slice(0, 2)}${"•".repeat(Math.max(1, l.length - 2))}@${d}`, name: u.display_name, organization: u.org_name, workspace: u.slug, username: u.username, usernameAllowed: p.identifiers.includes("username"), mfaRequired: mfaRequiredFor(p, u.role) });
}

// POST { action:"code", token } emails a 6-digit code; { action:"accept", token, code, password, username? } activates.
export async function onRequestPost({ request, env }) {
  const b = await readJson(request, 4096);
  const u = await invited(env, b.token);
  if (b.action === "code") {
    const r = await issueOtp(env, u, "invite");
    return respond({ ok: true, sent: r.sent, error: r.error, devCode: r.devCode });
  }
  if (b.action !== "accept") throw new HttpError(400, "Unknown action");
  await verifyOtp(env, u.id, "invite", b.code);
  const problem = passwordProblem(b.password);
  if (problem) throw new HttpError(400, problem);
  let username = u.username;
  if (b.username) {
    username = v.text(b.username, "Username", { min: 3, max: 40 }).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(username)) throw new HttpError(400, "Usernames can use letters, numbers, dots, dashes and underscores");
    const taken = await env.DB.prepare("SELECT id FROM users WHERE organization_id=? AND username=? AND id<>?").bind(u.organization_id, username, u.id).first();
    if (taken) throw new HttpError(409, "That username is taken");
  }
  const { hash, salt } = await hashPassword(String(b.password));
  const now = new Date().toISOString();
  const p = await loadPolicy(env, u.organization_id);
  // The email code just proved the inbox; when MFA is required the user still enrols a method next.
  const mfaMethod = mfaRequiredFor(p, u.role) ? (p.methods.includes("email_otp") ? "email_otp" : "bootstrap") : null;
  return finishLogin(env, request, { ...u, must_change_password: 0 }, {
    authMethod: "invite", mfaMethod,
    extra: [
      env.DB.prepare("UPDATE users SET status='active', password_hash=?, password_salt=?, must_change_password=0, password_changed_at=?, username=?, invite_token_hash=NULL, invite_expires_at=NULL, updated_at=? WHERE id=?")
        .bind(hash, salt, now, username || null, now, u.id),
      env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), u.organization_id, u.id, "user.invite_accepted", "user", u.id)
    ]
  });
}
