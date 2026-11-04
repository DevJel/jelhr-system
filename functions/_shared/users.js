import { HttpError } from "./http.js";
import { hashPassword, passwordProblem } from "./crypto.js";

/** Insert-statement for a new user. Caller decides which roles may be granted. */
export async function newUserStatement(env, { organizationId, email, displayName, role, password, mustChange = true }) {
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE").bind(email).first();
  if (existing) throw new HttpError(409, "An account with this email already exists");
  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  return {
    id,
    statement: env.DB.prepare(
      "INSERT INTO users(id,organization_id,email,display_name,password_hash,password_salt,role,status,must_change_password,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(id, organizationId, email, displayName, hash, salt, role, "active", mustChange ? 1 : 0, now, now)
  };
}

export async function resetPasswordStatements(env, userId, password) {
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
  const { hash, salt } = await hashPassword(password);
  const now = new Date().toISOString();
  return [
    env.DB.prepare("UPDATE users SET password_hash=?, password_salt=?, must_change_password=1, failed_login_count=0, locked_until=NULL, updated_at=? WHERE id=?").bind(hash, salt, now, userId),
    env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now, userId)
  ];
}

export const revokeUserSessions = (env, userId) =>
  env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(new Date().toISOString(), userId);
