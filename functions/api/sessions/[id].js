import { respond, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, ADMIN } from "../../_shared/auth.js";
import * as v from "../../_shared/validate.js";

export async function onRequestDelete(context) {
  const user = await authenticate(context, [], { allowPasswordChange: true });
  const { env, params, request } = context;
  const s = await env.DB.prepare("SELECT s.id, s.user_id, u.organization_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?").bind(v.id(params.id)).first();
  const allowed = s && (s.user_id === user.id || (ADMIN.includes(user.role) && s.organization_id === user.organization_id));
  if (!allowed) throw new HttpError(404, "Session not found");
  await env.DB.batch([
    env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(new Date().toISOString(), s.id),
    await auditStatement(env, user, "session.revoked", "session", s.id, { userId: s.user_id }, request)
  ]);
  return respond({ ok: true, signedOut: s.id === user.session_id });
}
