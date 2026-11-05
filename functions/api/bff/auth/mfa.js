import { onRequestPost as verifyMfa } from "../../auth/mfa.js";

export async function onRequestPost(context) {
  const response = await verifyMfa(context);
  const payload = await response.json().catch(() => ({}));
  const safe = response.ok
    ? { authenticated: true, user: { role: payload?.user?.role || "employee" } }
    : { error: payload?.error || "Verification failed", ...(payload?.code ? { code: payload.code } : {}) };
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(safe), { status: response.status, headers });
}
