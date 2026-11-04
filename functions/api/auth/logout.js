import { respond } from "../../_shared/http.js";
import { readSessionToken, sessionCookie } from "../../_shared/auth.js";
import { sha256b64 } from "../../_shared/crypto.js";

// Revokes the server-side session for the presented cookie and clears it.
// (The previous version hashed with padded base64, so the hash never matched
// the stored base64url hash and sessions were not actually revoked.)
export async function onRequestPost({ request, env }) {
  const token = readSessionToken(request);
  if (token && env.DB) {
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL")
      .bind(new Date().toISOString(), await sha256b64(token)).run();
  }
  return respond({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}
