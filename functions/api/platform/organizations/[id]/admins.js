import { respond, readJson, HttpError } from "../../../../_shared/http.js";
import { requireSuperAdmin, platformAudit } from "../../../../_shared/platform.js";
import { newUserStatement, resetPasswordStatements, revokeUserSessions } from "../../../../_shared/users.js";
import { PLATFORM_ASSIGNABLE } from "../../../../_shared/auth.js";
import * as v from "../../../../_shared/validate.js";

// Only the platform super admin can create, disable or reset organization owner/admin accounts.
export async function onRequestPost(context) {
  const admin = await requireSuperAdmin(context);
  const { env, params, request } = context;
  const org = await env.DB.prepare("SELECT id, status FROM organizations WHERE id=?").bind(v.id(params.id)).first();
  if (!org) throw new HttpError(404, "Organization not found");
  const b = await readJson(request, 4096);
  const email = v.email(b.email);
  const displayName = v.text(b.displayName, "Name", { required: true, max: 120 });
  const role = v.oneOf(b.role || "admin", PLATFORM_ASSIGNABLE, "Role");
  const user = await newUserStatement(env, { organizationId: org.id, email, displayName, role, password: String(b.password || "") });
  await env.DB.batch([user.statement, await platformAudit(env, request, admin, "platform.admin_created", org.id, user.id, { email, role })]);
  return respond({ id: user.id }, 201);
}

export async function onRequestPatch(context) {
  const admin = await requireSuperAdmin(context);
  const { env, params, request } = context;
  const b = await readJson(request, 4096);
  const target = await env.DB.prepare("SELECT id, role, status FROM users WHERE id=? AND organization_id=? AND role IN ('owner','admin')")
    .bind(v.id(b.userId, "userId"), v.id(params.id)).first();
  if (!target) throw new HttpError(404, "Administrator not found in this organization");
  const statements = [];
  if (b.status !== undefined) {
    const status = v.oneOf(b.status, ["active", "suspended", "disabled"], "Status");
    if (status !== "active" && target.status === "active") {
      const others = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE organization_id=? AND role IN ('owner','admin') AND status='active' AND id<>?").bind(params.id, target.id).first();
      if (!others.n) throw new HttpError(409, "An organization must keep at least one active administrator");
    }
    statements.push(env.DB.prepare("UPDATE users SET status=?, updated_at=? WHERE id=?").bind(status, new Date().toISOString(), target.id));
    if (status !== "active") statements.push(revokeUserSessions(env, target.id));
  }
  if (b.role !== undefined) statements.push(env.DB.prepare("UPDATE users SET role=? WHERE id=?").bind(v.oneOf(b.role, PLATFORM_ASSIGNABLE, "Role"), target.id));
  if (b.password !== undefined) statements.push(...await resetPasswordStatements(env, target.id, String(b.password)));
  if (!statements.length) throw new HttpError(400, "Nothing to update");
  statements.push(await platformAudit(env, request, admin, "platform.admin_updated", params.id, target.id, { status: b.status, role: b.role, passwordReset: b.password !== undefined }));
  await env.DB.batch(statements);
  return respond({ ok: true });
}
