import { sha256hex } from "./crypto.js";
import { clientIp, userAgent } from "./http.js";
import { sha256b64 } from "./crypto.js";

/** Fingerprint of exactly what the signer is shown. Recomputed on signing to detect tampering. */
export const documentHash = r =>
  sha256hex(JSON.stringify(["jelhr-esign-v1", r.id, r.organization_id, r.employee_id, r.title, r.body, r.created_at]));

export async function signatureEvent(env, request, r, event, actorId, detail = null) {
  return env.DB.prepare("INSERT INTO signature_events(id,request_id,organization_id,event,actor_user_id,ip_hash,user_agent,detail) VALUES(?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), r.id, r.organization_id, event, actorId, await sha256b64(clientIp(request)), userAgent(request), detail ? String(detail).slice(0, 500) : null);
}
