import { respond, readJson, clientIp } from "../../_shared/http.js";
import { sha256b64, verifyPassword, dummyPasswordWork } from "../../_shared/crypto.js";
import { loadPolicy } from "../../_shared/authpolicy.js";
import { findUser, afterFirstFactor } from "../../_shared/login.js";

const WINDOW_SECONDS = 15 * 60;   // rate-limit window per identifier+IP
const MAX_ATTEMPTS = 8;           // failures per window before a 15-minute lock
const ACCOUNT_LOCK_AFTER = 10;    // consecutive failures before the account itself locks
const ACCOUNT_LOCK_SECONDS = 15 * 60;

// Step 1 of sign-in: identifier (email, username or employee ID) + password.
// Returns a session, or { mfaRequired, challengeId, methods } for step 2 (/api/auth/mfa).
export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.JELHR_JWT_SECRET || env.JELHR_JWT_SECRET.length < 32) {
    return respond({ error: "Authentication service is not configured." }, 503);
  }
  const body = await readJson(request, 4096);
  const identifier = String(body.identifier ?? body.email ?? "").trim();
  const workspace = String(body.workspace || "").trim();
  const password = String(body.password || "");
  if (!identifier || identifier.length > 254 || password.length < 1 || password.length > 256) {
    return respond({ error: "Enter your email, username or employee ID, and your password." }, 400);
  }

  const ip = clientIp(request);
  const ipHash = await sha256b64(ip);
  const rateKey = await sha256b64(identifier.toLowerCase() + "|" + workspace.toLowerCase() + "|" + ip);
  const now = Math.floor(Date.now() / 1000);
  const rate = await env.DB.prepare("SELECT attempts, window_started_at, locked_until FROM auth_rate_limits WHERE key=?").bind(rateKey).first();
  if (rate?.locked_until && rate.locked_until > now) return respond({ error: "Too many attempts. Try again later." }, 429);
  const windowFresh = rate && now - rate.window_started_at < WINDOW_SECONDS;

  const found = await findUser(env, request, identifier, workspace);
  if (found.needsWorkspace) { await dummyPasswordWork(password); return respond({ error: "Enter your workspace ID to sign in with a username or employee ID.", code: "workspace_required" }, 400); }
  const user = found.user;
  const accountLocked = user?.locked_until && Date.parse(user.locked_until) > Date.now();
  let valid = false;
  if (user && user.status === "active" && !accountLocked && user.password_hash && user.password_salt) {
    valid = await verifyPassword(password, user.password_salt, user.password_hash);
  } else {
    await dummyPasswordWork(password);
  }

  await env.DB.prepare("INSERT INTO auth_events(id,user_id,email,event,ip_hash) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(), user?.id || null, user?.email || identifier.toLowerCase(), valid ? "password_ok" : accountLocked ? "login_locked" : "login_failed", ipHash).run();

  if (!valid) {
    const attempts = (windowFresh ? rate.attempts : 0) + 1;
    const statements = [
      env.DB.prepare("INSERT INTO auth_rate_limits(key,attempts,window_started_at,locked_until) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts, window_started_at=excluded.window_started_at, locked_until=excluded.locked_until")
        .bind(rateKey, attempts, windowFresh ? rate.window_started_at : now, attempts >= MAX_ATTEMPTS ? now + WINDOW_SECONDS : null)
    ];
    if (user && !accountLocked) {
      const failures = (user.failed_login_count || 0) + 1;
      const lock = failures >= ACCOUNT_LOCK_AFTER ? new Date(Date.now() + ACCOUNT_LOCK_SECONDS * 1000).toISOString() : null;
      statements.push(env.DB.prepare("UPDATE users SET failed_login_count=?, locked_until=? WHERE id=?").bind(lock ? 0 : failures, lock, user.id));
    }
    await env.DB.batch(statements);
    return respond({ error: "Those sign-in details are incorrect." }, 401);
  }

  const policy = await loadPolicy(env, user.organization_id);
  if (policy.sso.enabled && policy.sso.enforced && user.role !== "owner") {
    return respond({ error: "Your organization signs in with single sign-on. Use “Sign in with SSO”.", code: "sso_required" }, 403);
  }
  return afterFirstFactor(env, request, user, {
    authMethod: "password",
    extra: [
      env.DB.prepare("DELETE FROM auth_rate_limits WHERE key=?").bind(rateKey),
      env.DB.prepare("DELETE FROM auth_rate_limits WHERE window_started_at < ? AND (locked_until IS NULL OR locked_until < ?)").bind(now - 86400, now),
      env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").bind(new Date(Date.now() - 86400000).toISOString())
    ]
  });
}
