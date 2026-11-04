import { respond, readJson } from "../../_shared/http.js";
import { requireUser, auditStatement } from "../../_shared/auth.js";
import { verifyPassword, hashPassword, passwordProblem } from "../../_shared/crypto.js";

// Change own password. Revokes every other session for the account.
export async function onRequestPost({ request, env }) {
  const auth = await requireUser(request, env, [], { allowPasswordChange: true });
  if (auth.error) return auth.error;
  const body = await readJson(request, 4096);
  const row = await env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id=?").bind(auth.user.id).first();
  if (!await verifyPassword(String(body.currentPassword || ""), row?.password_salt, row?.password_hash)) {
    return respond({ error: "Current password is incorrect" }, 400);
  }
  const next = String(body.newPassword || "");
  const problem = passwordProblem(next);
  if (problem) return respond({ error: problem }, 400);
  if (next === String(body.currentPassword)) return respond({ error: "Choose a password you have not used for this account" }, 400);
  const { hash, salt } = await hashPassword(next);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash=?, password_salt=?, must_change_password=0, password_changed_at=?, updated_at=? WHERE id=?")
      .bind(hash, salt, now, now, auth.user.id),
    env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL").bind(now, auth.user.id, auth.user.session_id),
    await auditStatement(env, auth.user, "auth.password_changed", "user", auth.user.id, null, request)
  ]);
  return respond({ ok: true });
}
