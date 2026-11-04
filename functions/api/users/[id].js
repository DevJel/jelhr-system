import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, ADMIN, ORG_ASSIGNABLE, PLATFORM_ASSIGNABLE } from "../../_shared/auth.js";
import { resetPasswordStatements, revokeUserSessions } from "../../_shared/users.js";
import { newInvite, sendInviteEmail } from "../../_shared/invites.js";
import { normaliseFeatureList } from "../../_shared/features.js";
import { readUsername } from "./index.js";
import * as v from "../../_shared/validate.js";

export async function onRequestPatch(context) {
  const user = await authenticate(context, ADMIN);
  const { env, params, request } = context;
  const target = await env.DB.prepare("SELECT id, role, status, email, display_name FROM users WHERE id=? AND organization_id=?").bind(v.id(params.id), user.organization_id).first();
  if (!target) throw new HttpError(404, "User not found");
  if (target.id === user.id) throw new HttpError(409, "Use the Security page to manage your own account");
  if (PLATFORM_ASSIGNABLE.includes(target.role)) throw new HttpError(403, "Owner and admin accounts are managed by the platform administrator");
  const b = await readJson(request, 4096);
  const statements = [];
  const now = new Date().toISOString();
  let mail = null;
  if (b.role !== undefined) statements.push(env.DB.prepare("UPDATE users SET role=?, updated_at=? WHERE id=?").bind(v.oneOf(b.role, ORG_ASSIGNABLE, "Role"), now, target.id));
  if (b.status !== undefined) {
    const status = v.oneOf(b.status, ["active", "suspended", "disabled"], "Status");
    if (target.status === "invited" && status === "active") throw new HttpError(409, "Invited users become active when they accept the invitation");
    statements.push(env.DB.prepare("UPDATE users SET status=?, updated_at=? WHERE id=?").bind(status, now, target.id));
    if (status !== "active") statements.push(revokeUserSessions(env, target.id));
  }
  if (b.username !== undefined) {
    const username = readUsername(b.username);
    if (username && await env.DB.prepare("SELECT id FROM users WHERE organization_id=? AND username=? AND id<>?").bind(user.organization_id, username, target.id).first()) throw new HttpError(409, "That username is taken");
    statements.push(env.DB.prepare("UPDATE users SET username=? WHERE id=?").bind(username, target.id));
  }
  if (b.features !== undefined) statements.push(env.DB.prepare("UPDATE users SET features_json=? WHERE id=?").bind(b.features === null ? null : JSON.stringify(normaliseFeatureList(b.features)), target.id));
  if (b.password !== undefined) statements.push(...await resetPasswordStatements(env, target.id, String(b.password)));
  if (b.resetMfa) statements.push(env.DB.prepare("DELETE FROM mfa_methods WHERE user_id=?").bind(target.id), revokeUserSessions(env, target.id));
  let invite = null;
  if (b.resendInvite) {
    if (target.status !== "invited") throw new HttpError(409, "This user already accepted their invitation");
    invite = await newInvite();
    statements.push(env.DB.prepare("UPDATE users SET invite_token_hash=?, invite_expires_at=? WHERE id=?").bind(invite.hash, invite.expires, target.id));
  }
  if (!statements.length) throw new HttpError(400, "Nothing to update");
  statements.push(await auditStatement(env, user, "user.updated", "user", target.id, { role: b.role, status: b.status, features: b.features, passwordReset: b.password !== undefined, mfaReset: Boolean(b.resetMfa), inviteResent: Boolean(b.resendInvite) }, request));
  await env.DB.batch(statements);
  if (invite) mail = await sendInviteEmail(env, request, { email: target.email, name: target.display_name, organizationId: user.organization_id, token: invite.token, invitedBy: user.display_name });
  return respond({ ok: true, inviteEmailed: mail?.ok, inviteLink: mail?.link, inviteError: mail && !mail.ok ? mail.error : undefined });
}
