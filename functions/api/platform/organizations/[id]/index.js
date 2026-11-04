import { respond, readJson, HttpError } from "../../../../_shared/http.js";
import { requireSuperAdmin, platformAudit } from "../../../../_shared/platform.js";
import * as v from "../../../../_shared/validate.js";
import { FEATURES, orgFeatures, normaliseFeatureList } from "../../../../_shared/features.js";

async function loadOrg(env, id) {
  const org = await env.DB.prepare("SELECT id, name, slug, status, timezone, created_at, updated_at, features_json, ai_daily_limit, custom_domain, country_code FROM organizations WHERE id=?").bind(v.id(id)).first();
  if (!org) throw new HttpError(404, "Organization not found");
  return org;
}

export async function onRequestGet(context) {
  await requireSuperAdmin(context);
  const { env, params } = context;
  const org = await loadOrg(env, params.id);
  const [admins, audit] = await Promise.all([
    env.DB.prepare("SELECT id, email, display_name, role, status, must_change_password, last_login_at, created_at FROM users WHERE organization_id=? AND role IN ('owner','admin') ORDER BY created_at").bind(org.id).all(),
    env.DB.prepare("SELECT action, actor_email, metadata_json, created_at FROM platform_audit WHERE organization_id=? ORDER BY created_at DESC LIMIT 50").bind(org.id).all()
  ]);
  return respond({ organization: { ...org, features: orgFeatures(org.features_json) }, allFeatures: FEATURES, admins: admins.results || [], audit: audit.results || [] });
}

export async function onRequestPatch(context) {
  const admin = await requireSuperAdmin(context);
  const { env, params, request } = context;
  const org = await loadOrg(env, params.id);
  const b = await readJson(request, 4096);
  const statements = [];
  const now = new Date().toISOString();
  if (b.name !== undefined) statements.push(env.DB.prepare("UPDATE organizations SET name=?, updated_at=? WHERE id=?").bind(v.text(b.name, "Name", { required: true, max: 120 }), now, org.id));
  if (b.timezone !== undefined) {
    statements.push(env.DB.prepare("UPDATE organizations SET timezone=?, updated_at=? WHERE id=?").bind(v.timezone(b.timezone), now, org.id));
  }
  if (b.status !== undefined) {
    const status = v.oneOf(b.status, ["active", "suspended", "closed"], "Status");
    statements.push(env.DB.prepare("UPDATE organizations SET status=?, updated_at=? WHERE id=?").bind(status, now, org.id));
    if (status !== "active") {
      statements.push(env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE organization_id=?)").bind(now, org.id));
    }
  }
  if (b.features !== undefined) statements.push(env.DB.prepare("UPDATE organizations SET features_json=?, updated_at=? WHERE id=?").bind(JSON.stringify(normaliseFeatureList(b.features)), now, org.id));
  if (b.aiDailyLimit !== undefined) statements.push(env.DB.prepare("UPDATE organizations SET ai_daily_limit=? WHERE id=?").bind(v.int(b.aiDailyLimit, "AI daily limit", { min: 0, max: 100000 }), org.id));
  if (!statements.length) throw new HttpError(400, "Nothing to update");
  statements.push(await platformAudit(env, request, admin, "platform.organization_updated", org.id, org.id, { name: b.name, status: b.status, timezone: b.timezone, features: b.features, aiDailyLimit: b.aiDailyLimit }));
  await env.DB.batch(statements);
  return respond({ ok: true });
}
