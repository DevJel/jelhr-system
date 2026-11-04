import { respond, readJson, HttpError } from "../../../_shared/http.js";
import { requireSuperAdmin, platformAudit } from "../../../_shared/platform.js";
import { newUserStatement } from "../../../_shared/users.js";
import { PLATFORM_ASSIGNABLE } from "../../../_shared/auth.js";
import * as v from "../../../_shared/validate.js";

export async function onRequestGet(context) {
  await requireSuperAdmin(context);
  const { results } = await context.env.DB.prepare(
    `SELECT o.id, o.name, o.slug, o.status, o.timezone, o.created_at,
            (SELECT COUNT(*) FROM users u WHERE u.organization_id=o.id) AS user_count,
            (SELECT COUNT(*) FROM users u WHERE u.organization_id=o.id AND u.role IN ('owner','admin')) AS admin_count,
            (SELECT COUNT(*) FROM employees e WHERE e.organization_id=o.id AND e.employment_status<>'terminated') AS employee_count
       FROM organizations o ORDER BY o.created_at DESC`
  ).all();
  return respond({ organizations: results || [] });
}

export async function onRequestPost(context) {
  const admin = await requireSuperAdmin(context);
  const { env, request } = context;
  const b = await readJson(request, 8192);
  const name = v.text(b.name, "Organization name", { required: true, max: 120 });
  const slugBase = (b.slug ? String(b.slug) : name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "org";
  const timezone = v.timezone(b.timezone || "Asia/Kuala_Lumpur");
  const adminEmail = v.email(b.adminEmail, "Administrator email");
  const adminName = v.text(b.adminName, "Administrator name", { required: true, max: 120 });
  const role = v.oneOf(b.adminRole || "owner", PLATFORM_ASSIGNABLE, "Administrator role");
  const slugTaken = await env.DB.prepare("SELECT 1 FROM organizations WHERE slug=?").bind(slugBase).first();
  const slug = slugTaken ? `${slugBase}-${crypto.randomUUID().slice(0, 6)}` : slugBase;
  const orgId = crypto.randomUUID();
  const user = await newUserStatement(env, { organizationId: orgId, email: adminEmail, displayName: adminName, role, password: String(b.adminPassword || "") });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations(id,name,slug,timezone) VALUES(?,?,?,?)").bind(orgId, name, slug, timezone),
    env.DB.prepare("INSERT INTO organization_settings(organization_id,settings_json) VALUES(?,?)").bind(orgId, "{}"),
    user.statement,
    await platformAudit(env, request, admin, "platform.organization_created", orgId, user.id, { name, adminEmail, role })
  ]);
  return respond({ id: orgId, slug, adminUserId: user.id }, 201);
}
