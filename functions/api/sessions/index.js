import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, ADMIN } from "../../_shared/auth.js";

export async function onRequestGet(context) {
  const user = await authenticate(context, [], { allowPasswordChange: true });
  const scope = new URL(context.request.url).searchParams.get("scope");
  const now = new Date().toISOString();
  let rows;
  if (scope === "org") {
    if (!ADMIN.includes(user.role)) throw new HttpError(403, "Insufficient permission");
    rows = await context.env.DB.prepare(
      `SELECT s.id, s.created_at, s.last_seen_at, s.expires_at, s.user_agent, u.email, u.display_name, u.role
         FROM sessions s JOIN users u ON u.id=s.user_id
        WHERE u.organization_id=? AND s.revoked_at IS NULL AND s.expires_at>? ORDER BY s.last_seen_at DESC LIMIT 500`
    ).bind(user.organization_id, now).all();
  } else {
    rows = await context.env.DB.prepare(
      "SELECT id, created_at, last_seen_at, expires_at, user_agent FROM sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>? ORDER BY last_seen_at DESC"
    ).bind(user.id, now).all();
  }
  const sessions = (rows.results || []).map(s => ({ ...s, current: s.id === user.session_id }));
  return respond({ sessions });
}

export async function onRequestPost(context) {
  const user = await authenticate(context, [], { allowPasswordChange: true });
  const b = await readJson(context.request, 1024);
  if (b.action !== "revoke_others") throw new HttpError(400, "Unknown action");
  const { env, request } = context;
  const result = await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL").bind(new Date().toISOString(), user.id, user.session_id).run();
  await (await auditStatement(env, user, "session.revoked_others", "user", user.id, null, request)).run();
  return respond({ ok: true, revoked: result.meta?.changes ?? 0 });
}
