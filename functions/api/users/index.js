import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, ADMIN, ORG_ASSIGNABLE } from "../../_shared/auth.js";
import { newUserStatement } from "../../_shared/users.js";
import { newInvite, sendInviteEmail } from "../../_shared/invites.js";
import { FEATURES, orgFeatures, normaliseFeatureList } from "../../_shared/features.js";
import * as v from "../../_shared/validate.js";

export function readUsername(value) {
  if (value === undefined || value === null || value === "") return null;
  const u = v.text(value, "Username", { min: 3, max: 40 }).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(u)) throw new HttpError(400, "Usernames can use letters, numbers, dots, dashes and underscores");
  return u;
}

export async function onRequestGet(context) {
  const user = await authenticate(context, [...ADMIN, "auditor"]);
  const { results } = await context.env.DB.prepare(
    `SELECT u.id, u.email, u.username, u.display_name, u.role, u.status, u.must_change_password, u.last_login_at, u.created_at, u.features_json, u.invite_expires_at,
            e.id AS employee_id, e.first_name || ' ' || e.last_name AS employee_name, e.employee_number,
            (SELECT COUNT(*) FROM mfa_methods m WHERE m.user_id=u.id AND m.confirmed_at IS NOT NULL) AS mfa_count
       FROM users u LEFT JOIN employees e ON e.user_id=u.id AND e.organization_id=u.organization_id
      WHERE u.organization_id=? ORDER BY u.created_at`
  ).bind(user.organization_id).all();
  const org = await context.env.DB.prepare("SELECT features_json FROM organizations WHERE id=?").bind(user.organization_id).first();
  const enabled = orgFeatures(org.features_json);
  return respond({ users: results || [], assignableRoles: ORG_ASSIGNABLE, features: FEATURES.filter(f => enabled.includes(f.key)) });
}

/**
 * Create a user. Two ways:
 *   { invite: true, email, displayName, role, ... }  → emailed invitation; the person confirms with an email code and sets a password.
 *   { password, email, displayName, role, ... }      → temporary password the person must change at first sign-in.
 * Organization admins grant HR/manager/employee/auditor only; owner/admin accounts are platform-only.
 */
export async function onRequestPost(context) {
  const user = await authenticate(context, ADMIN);
  const { env, request } = context;
  const b = await readJson(request, 4096);
  const role = v.oneOf(b.role, ORG_ASSIGNABLE, "Role");
  const email = v.email(b.email);
  const displayName = v.text(b.displayName, "Name", { required: true, max: 120 });
  const username = readUsername(b.username);
  if (username && await env.DB.prepare("SELECT id FROM users WHERE organization_id=? AND username=?").bind(user.organization_id, username).first()) throw new HttpError(409, "That username is taken");
  const features = b.features === undefined || b.features === null ? null : JSON.stringify(normaliseFeatureList(b.features));
  let employee = null;
  if (b.employeeId) {
    employee = await env.DB.prepare("SELECT id, user_id, employment_status FROM employees WHERE id=? AND organization_id=?").bind(v.id(b.employeeId, "Employee"), user.organization_id).first();
    if (!employee) throw new HttpError(404, "Employee not found");
    if (employee.user_id) throw new HttpError(409, "This employee already has a sign-in account");
    if (employee.employment_status === "terminated") throw new HttpError(409, "Former employees cannot be given access");
  }
  const statements = [];
  let id, invite = null;
  if (b.invite) {
    if (await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE").bind(email).first()) throw new HttpError(409, "An account with this email already exists");
    id = crypto.randomUUID();
    invite = await newInvite();
    const now = new Date().toISOString();
    statements.push(env.DB.prepare("INSERT INTO users(id,organization_id,email,display_name,role,status,username,features_json,invite_token_hash,invite_expires_at,invited_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, user.organization_id, email, displayName, role, "invited", username, features, invite.hash, invite.expires, user.id, now, now));
  } else {
    const created = await newUserStatement(env, { organizationId: user.organization_id, email, displayName, role, password: String(b.password || "") });
    id = created.id;
    statements.push(created.statement, env.DB.prepare("UPDATE users SET username=?, features_json=? WHERE id=?").bind(username, features, id));
  }
  if (employee) statements.push(env.DB.prepare("UPDATE employees SET user_id=?, updated_at=? WHERE id=?").bind(id, new Date().toISOString(), employee.id));
  statements.push(await auditStatement(env, user, b.invite ? "user.invited" : "user.created", "user", id, { role, employeeId: employee?.id || null }, request));
  await env.DB.batch(statements);
  let mail = null;
  if (invite) mail = await sendInviteEmail(env, request, { email, name: displayName, organizationId: user.organization_id, token: invite.token, invitedBy: user.display_name });
  return respond({ id, invited: Boolean(invite), inviteEmailed: mail?.ok ?? false, inviteError: mail && !mail.ok ? mail.error : undefined, inviteLink: mail?.link }, 201);
}
