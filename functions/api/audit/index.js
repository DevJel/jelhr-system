import { respond } from "../../_shared/http.js";
import { authenticate, ADMIN } from "../../_shared/auth.js";
import * as v from "../../_shared/validate.js";

export async function onRequestGet(context) {
  const user = await authenticate(context, [...ADMIN, "auditor"]);
  const url = new URL(context.request.url);
  const limit = v.int(url.searchParams.get("limit"), "limit", { min: 1, max: 500, fallback: 100 });
  const type = url.searchParams.get("type");
  const binds = [user.organization_id];
  let where = "a.organization_id=?";
  if (type) { where += " AND a.resource_type=?"; binds.push(String(type).slice(0, 40)); }
  const { results } = await context.env.DB.prepare(
    `SELECT a.id, a.action, a.resource_type, a.resource_id, a.metadata_json, a.created_at, u.email AS actor_email, u.display_name AS actor_name
       FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE ${where} ORDER BY a.created_at DESC LIMIT ?`
  ).bind(...binds, limit).all();
  return respond({ events: results || [] });
}
