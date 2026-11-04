import { respond } from "../../_shared/http.js";
import { sha256b64 } from "../../_shared/crypto.js";
import { readPlatformToken, platformCookie } from "../../_shared/platform.js";

export async function onRequestPost({ request, env }) {
  const token = readPlatformToken(request);
  if (token && env.DB) {
    await env.DB.prepare("UPDATE platform_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").bind(new Date().toISOString(), await sha256b64(token)).run();
  }
  return respond({ ok: true }, 200, { "Set-Cookie": platformCookie("", 0) });
}
