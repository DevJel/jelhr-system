import { onRequestPost as verifyMfa } from "../../auth/mfa.js";

export async function onRequestPost(context) {
  const requestBody = await context.request.clone().json().catch(() => ({}));
  const response = await verifyMfa(context);
  const payload = await response.json().catch(() => ({}));
  let safe;
  if (!response.ok) {
    safe = { error: payload?.error || "Verification failed", ...(payload?.code ? { code: payload.code } : {}) };
  } else if (requestBody.action === "email") {
    // The browser needs delivery status, never the local development OTP value.
    safe = { sent: Boolean(payload?.sent), ...(payload?.error ? { error: payload.error } : {}) };
  } else if (requestBody.action === "passkey_options") {
    // WebAuthn request options are public challenge material; no secret key is returned.
    safe = { publicKey: payload?.publicKey };
  } else if (requestBody.action === "verify") {
    safe = {
      authenticated: true,
      mfaEnrollmentRequired: Boolean(payload?.mfaEnrollmentRequired),
      user: { role: payload?.user?.role || "employee" }
    };
  } else {
    safe = { ok: true };
  }
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(safe), { status: response.status, headers });
}
