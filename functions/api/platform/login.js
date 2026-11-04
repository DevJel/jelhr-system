import { respond, readJson, clientIp, userAgent } from "../../_shared/http.js";
import { sha256b64, signJwt } from "../../_shared/crypto.js";
import { platformConfigured, checkSuperAdminCredentials, platformCookie, PLATFORM_SESSION_SECONDS } from "../../_shared/platform.js";

export async function onRequestPost({ request, env }) {
  if (!await platformConfigured(env)) return respond({ error: "Platform administration is not configured" }, 503);
  const body = await readJson(request, 4096);
  const email = String(body.email || "").trim().toLowerCase();
  const ip = clientIp(request);
  const rateKey = await sha256b64("platform|" + ip);
  const now = Math.floor(Date.now() / 1000);
  const rate = await env.DB.prepare("SELECT attempts, window_started_at, locked_until FROM auth_rate_limits WHERE key=?").bind(rateKey).first();
  if (rate?.locked_until > now) return respond({ error: "Too many attempts. Try again later." }, 429);
  const check = await checkSuperAdminCredentials(env, email, String(body.password || ""), body.code);
  if (check.totpRequired && !check.badCode) return respond({ totpRequired: true, error: "Enter the code from your authenticator app" }, 401);
  const ok = check.ok;
  await env.DB.prepare("INSERT INTO auth_events(id,user_id,email,event,ip_hash) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(), null, email || "(blank)", ok ? "platform_login_success" : "platform_login_failed", await sha256b64(ip)).run();
  if (!ok) {
    const fresh = rate && now - rate.window_started_at < 900;
    const attempts = (fresh ? rate.attempts : 0) + 1;
    await env.DB.prepare("INSERT INTO auth_rate_limits(key,attempts,window_started_at,locked_until) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts, window_started_at=excluded.window_started_at, locked_until=excluded.locked_until")
      .bind(rateKey, attempts, fresh ? rate.window_started_at : now, attempts >= 5 ? now + 1800 : null).run();
    return respond({ error: "Credentials are incorrect." }, 401);
  }
  const sid = crypto.randomUUID();
  const exp = now + PLATFORM_SESSION_SECONDS;
  const token = await signJwt({ scope: "platform", sub: email, sid, iat: now, exp }, env.JELHR_JWT_SECRET);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_rate_limits WHERE key=?").bind(rateKey),
    env.DB.prepare("INSERT INTO platform_sessions(id,email,token_hash,expires_at,ip_hash,user_agent) VALUES(?,?,?,?,?,?)")
      .bind(sid, email, await sha256b64(token), new Date(exp * 1000).toISOString(), await sha256b64(ip), userAgent(request))
  ]);
  return respond({ ok: true, email }, 200, { "Set-Cookie": platformCookie(token) });
}
