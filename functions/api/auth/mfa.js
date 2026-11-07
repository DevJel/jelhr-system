import { respond, readJson, HttpError } from "../../_shared/http.js";
import { verifyTotp, decryptText, randomToken } from "../../_shared/crypto.js";
import { issueOtp, verifyOtp } from "../../_shared/otp.js";
import { verifyAssertion, rpFromRequest } from "../../_shared/webauthn.js";
import { loadPolicy } from "../../_shared/authpolicy.js";
import { loadChallenge, consumeChallenge, failChallenge, finishLogin, availableMethods } from "../../_shared/login.js";

// Step 2 of sign-in. Actions:
//   { action:"email", challengeId }                     send an email code
//   { action:"passkey_options", challengeId }           WebAuthn request options for this user
//   { action:"verify", challengeId, method, code | credential }
export async function onRequestPost({ request, env }) {
  const b = await readJson(request, 16384);
  const c = await loadChallenge(env, b.challengeId, "mfa");
  const user = await env.DB.prepare("SELECT id, organization_id, email, display_name, role, status, must_change_password FROM users WHERE id=?").bind(c.user_id).first();
  if (!user || user.status !== "active") throw new HttpError(401, "Account disabled");
  const methods = c.data.methods || [];

  if (b.action === "email") {
    if (!methods.includes("email_otp")) throw new HttpError(400, "Email codes aren't allowed for this account");
    const r = await issueOtp(env, user, "login");
    return respond({ ok: true, sent: r.sent, error: r.error });
  }
  if (b.action === "passkey_options") {
    if (!methods.includes("passkey")) throw new HttpError(400, "Passkeys aren't set up for this account");
    const { results } = await env.DB.prepare("SELECT credential_id, transports FROM mfa_methods WHERE user_id=? AND type='passkey' AND confirmed_at IS NOT NULL").bind(user.id).all();
    const challenge = randomToken(32);
    await env.DB.prepare("UPDATE auth_challenges SET data_json=? WHERE id=?").bind(JSON.stringify({ ...c.data, webauthn: challenge }), c.id).run();
    const { rpId } = rpFromRequest(request, env);
    return respond({ publicKey: { challenge, rpId, timeout: 60000, userVerification: "preferred", allowCredentials: (results || []).map(r => ({ type: "public-key", id: r.credential_id, transports: r.transports ? JSON.parse(r.transports) : undefined })) } });
  }
  if (b.action !== "verify") throw new HttpError(400, "Unknown action");

  const method = String(b.method || "");
  if (!methods.includes(method)) throw new HttpError(400, "That method isn't available for this sign-in");
  let methodId = null;
  try {
    if (method === "email_otp") {
      await verifyOtp(env, user.id, "login", b.code);
    } else if (method === "totp") {
      const { results } = await env.DB.prepare("SELECT id, secret_enc FROM mfa_methods WHERE user_id=? AND type='totp' AND confirmed_at IS NOT NULL").bind(user.id).all();
      for (const m of results || []) { if (await verifyTotp(await decryptText(env, m.secret_enc), b.code)) { methodId = m.id; break; } }
      if (!methodId) throw new HttpError(400, "That authenticator code isn't right. Codes change every 30 seconds.");
    } else if (method === "passkey") {
      const cred = b.credential || {};
      const m = await env.DB.prepare("SELECT * FROM mfa_methods WHERE user_id=? AND type='passkey' AND credential_id=? AND confirmed_at IS NOT NULL").bind(user.id, String(cred.id || "")).first();
      if (!m || !c.data.webauthn) throw new HttpError(400, "This passkey isn't registered to your account");
      const { rpId, origins } = rpFromRequest(request, env);
      const r = await verifyAssertion(cred, { challenge: c.data.webauthn, rpId, origins, jwk: JSON.parse(m.public_key_jwk), signCount: m.sign_count }).catch(e => { throw new HttpError(400, e.message); });
      await env.DB.prepare("UPDATE mfa_methods SET sign_count=? WHERE id=?").bind(r.signCount, m.id).run();
      methodId = m.id;
    } else throw new HttpError(400, "Unknown method");
  } catch (e) {
    await failChallenge(env, c.id);
    throw e;
  }
  // Bootstrap: verified by email but no method enrolled that the policy allows → enrollment-only session.
  const policy = await loadPolicy(env, user.organization_id);
  const avail = await availableMethods(env, user, policy);
  const bootstrap = c.data.bootstrap || (avail.required && method === "email_otp" && !policy.methods.includes("email_otp"));
  const extra = [consumeChallenge(env, c.id)];
  if (methodId) extra.push(env.DB.prepare("UPDATE mfa_methods SET last_used_at=? WHERE id=?").bind(new Date().toISOString(), methodId));
  return finishLogin(env, request, user, { authMethod: c.data.authMethod || "password", mfaMethod: bootstrap ? "bootstrap" : method, extra });
}
