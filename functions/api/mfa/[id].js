import { respond, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement } from "../../_shared/auth.js";
import { loadPolicy, mfaRequiredFor } from "../../_shared/authpolicy.js";
import * as v from "../../_shared/validate.js";

export async function onRequestDelete(context) {
  const user = await authenticate(context, [], { allowPasswordChange: true });
  const { env, request, params } = context;
  const m = await env.DB.prepare("SELECT id, type FROM mfa_methods WHERE id=? AND user_id=?").bind(v.id(params.id), user.id).first();
  if (!m) throw new HttpError(404, "Method not found");
  const p = await loadPolicy(env, user.organization_id);
  if (mfaRequiredFor(p, user.role)) {
    const others = await env.DB.prepare("SELECT COUNT(*) AS n FROM mfa_methods WHERE user_id=? AND id<>? AND confirmed_at IS NOT NULL").bind(user.id, m.id).first();
    const emailFallback = p.methods.includes("email_otp");
    if (!others.n && !emailFallback) throw new HttpError(409, "Two-step verification is required. Add another method before removing this one.");
  }
  await env.DB.batch([env.DB.prepare("DELETE FROM mfa_methods WHERE id=?").bind(m.id), await auditStatement(env, user, "mfa.removed", "user", user.id, { type: m.type }, request)]);
  return respond({ ok: true });
}
