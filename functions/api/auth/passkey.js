import { respond, readJson, HttpError } from "../../_shared/http.js";
import { randomToken } from "../../_shared/crypto.js";
import { verifyAssertion, rpFromRequest } from "../../_shared/webauthn.js";
import { loadPolicy } from "../../_shared/authpolicy.js";
import { loadChallenge, consumeChallenge, failChallenge, finishLogin } from "../../_shared/login.js";

// Passwordless sign-in with a passkey (discoverable credential). A user-verifying passkey
// is itself two factors (device + biometric/PIN), so no further step is asked.
export async function onRequestPost({ request, env }) {
  const b = await readJson(request, 16384);
  const { rpId, origins } = rpFromRequest(request, env);
  if (b.action === "options") {
    const id = crypto.randomUUID(), challenge = randomToken(32);
    await env.DB.prepare("INSERT INTO auth_challenges(id,purpose,challenge,expires_at) VALUES(?,?,?,?)").bind(id, "webauthn_login", challenge, new Date(Date.now() + 5 * 60000).toISOString()).run();
    return respond({ challengeId: id, publicKey: { challenge, rpId, timeout: 60000, userVerification: "required", allowCredentials: [] } });
  }
  if (b.action !== "verify") throw new HttpError(400, "Unknown action");
  const c = await loadChallenge(env, b.challengeId, "webauthn_login");
  const cred = b.credential || {};
  const m = await env.DB.prepare(
    `SELECT m.*, u.id AS uid, u.organization_id, u.email, u.display_name, u.role, u.status, u.must_change_password, o.status AS org_status
       FROM mfa_methods m JOIN users u ON u.id=m.user_id JOIN organizations o ON o.id=u.organization_id
      WHERE m.type='passkey' AND m.credential_id=? AND m.confirmed_at IS NOT NULL`
  ).bind(String(cred.id || "")).first();
  if (!m) { await failChallenge(env, c.id); throw new HttpError(400, "This passkey isn't registered with JelHR. Sign in with your password first, then add it under Security."); }
  if (m.status !== "active" || m.org_status !== "active") throw new HttpError(401, "Account disabled");
  const policy = await loadPolicy(env, m.organization_id);
  if (!policy.methods.includes("passkey")) throw new HttpError(403, "Your organization doesn't allow passkey sign-in");
  if (policy.sso.enabled && policy.sso.enforced && m.role !== "owner") throw new HttpError(403, "Your organization signs in with single sign-on", { code: "sso_required" });
  let r;
  try { r = await verifyAssertion(cred, { challenge: c.challenge, rpId, origins, jwk: JSON.parse(m.public_key_jwk), signCount: m.sign_count }); }
  catch (e) { await failChallenge(env, c.id); throw new HttpError(400, e.message); }
  if (!r.userVerified) throw new HttpError(400, "Your device didn't verify you (PIN or biometrics). Try again.");
  const user = { id: m.uid, organization_id: m.organization_id, email: m.email, display_name: m.display_name, role: m.role, must_change_password: m.must_change_password };
  return finishLogin(env, request, user, { authMethod: "passkey", mfaMethod: "passkey", extra: [
    consumeChallenge(env, c.id),
    env.DB.prepare("UPDATE mfa_methods SET sign_count=?, last_used_at=? WHERE id=?").bind(r.signCount, new Date().toISOString(), m.id)
  ] });
}
