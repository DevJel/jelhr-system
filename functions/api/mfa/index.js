import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement } from "../../_shared/auth.js";
import { encryptText, decryptText, verifyTotp, base32Encode, randomToken } from "../../_shared/crypto.js";
import { issueOtp, verifyOtp } from "../../_shared/otp.js";
import { verifyRegistration, rpFromRequest } from "../../_shared/webauthn.js";
import { loadPolicy, mfaRequiredFor } from "../../_shared/authpolicy.js";
import * as v from "../../_shared/validate.js";

const PUBLIC = "id, type, label, confirmed_at, last_used_at, created_at";

export async function onRequestGet(context) {
  const user = await authenticate(context, [], { allowPasswordChange: true });
  const { results } = await context.env.DB.prepare(`SELECT ${PUBLIC} FROM mfa_methods WHERE user_id=? AND confirmed_at IS NOT NULL ORDER BY created_at`).bind(user.id).all();
  const p = await loadPolicy(context.env, user.organization_id);
  return respond({ methods: results || [], allowed: p.methods, required: mfaRequiredFor(p, user.role), enrollmentRequired: user.session_mfa === "bootstrap" });
}

// After a user enrols a method on a bootstrap session, the session becomes a full session.
const upgrade = (env, user, method) => env.DB.prepare("UPDATE sessions SET mfa_method=? WHERE id=? AND mfa_method='bootstrap'").bind(method, user.session_id);

export async function onRequestPost(context) {
  const user = await authenticate(context, [], { allowPasswordChange: true });
  const { env, request } = context;
  const p = await loadPolicy(env, user.organization_id);
  const b = await readJson(request, 32768);
  const allow = type => { if (!p.methods.includes(type)) throw new HttpError(403, "Your organization doesn't allow this method"); };
  const label = b.label ? v.text(b.label, "Name", { max: 60 }) : null;

  switch (b.action) {
    case "totp_setup": {
      allow("totp");
      const secret = base32Encode(crypto.getRandomValues(new Uint8Array(20)));
      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare("DELETE FROM mfa_methods WHERE user_id=? AND type='totp' AND confirmed_at IS NULL").bind(user.id),
        env.DB.prepare("INSERT INTO mfa_methods(id,user_id,type,label,secret_enc) VALUES(?,?,?,?,?)").bind(id, user.id, "totp", label || "Authenticator app", await encryptText(env, secret))
      ]);
      const issuer = encodeURIComponent("JelHR " + (user.organization_name || ""));
      const uri = `otpauth://totp/${issuer}:${encodeURIComponent(user.email)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
      return respond({ id, secret, uri });
    }
    case "totp_confirm": {
      allow("totp");
      const m = await env.DB.prepare("SELECT id, secret_enc FROM mfa_methods WHERE id=? AND user_id=? AND type='totp' AND confirmed_at IS NULL").bind(v.id(b.id), user.id).first();
      if (!m) throw new HttpError(404, "Start the authenticator setup again");
      if (!await verifyTotp(await decryptText(env, m.secret_enc), b.code)) throw new HttpError(400, "That code isn't right. Check the app shows JelHR and try the newest code.");
      await env.DB.batch([
        env.DB.prepare("UPDATE mfa_methods SET confirmed_at=? WHERE id=?").bind(new Date().toISOString(), m.id), upgrade(env, user, "totp"),
        await auditStatement(env, user, "mfa.enrolled", "user", user.id, { type: "totp" }, request)
      ]);
      return respond({ ok: true });
    }
    case "passkey_options": {
      allow("passkey");
      const { rpId } = rpFromRequest(request, env);
      const { results } = await env.DB.prepare("SELECT credential_id, transports FROM mfa_methods WHERE user_id=? AND type='passkey' AND confirmed_at IS NOT NULL").bind(user.id).all();
      const id = crypto.randomUUID(), challenge = randomToken(32);
      await env.DB.prepare("INSERT INTO auth_challenges(id,purpose,user_id,organization_id,challenge,expires_at) VALUES(?,?,?,?,?,?)").bind(id, "webauthn_register", user.id, user.organization_id, challenge, new Date(Date.now() + 5 * 60000).toISOString()).run();
      return respond({ challengeId: id, publicKey: {
        challenge, rp: { id: rpId, name: "JelHR" },
        user: { id: btoa(user.id).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"), name: user.email, displayName: user.display_name },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "preferred" },
        attestation: "none", timeout: 60000,
        excludeCredentials: (results || []).map(r => ({ type: "public-key", id: r.credential_id }))
      } });
    }
    case "passkey_register": {
      allow("passkey");
      const c = await env.DB.prepare("SELECT * FROM auth_challenges WHERE id=? AND purpose='webauthn_register' AND user_id=? AND consumed_at IS NULL AND expires_at>?").bind(String(b.challengeId || ""), user.id, new Date().toISOString()).first();
      if (!c) throw new HttpError(400, "The passkey request expired. Try again.");
      const { rpId, origins } = rpFromRequest(request, env);
      let reg;
      try { reg = await verifyRegistration(b.credential || {}, { challenge: c.challenge, rpId, origins }); } catch (e) { throw new HttpError(400, "Couldn't register the passkey: " + e.message); }
      const exists = await env.DB.prepare("SELECT id FROM mfa_methods WHERE credential_id=?").bind(reg.credentialId).first();
      if (exists) throw new HttpError(409, "This passkey is already registered");
      const transports = Array.isArray(b.credential?.transports) ? JSON.stringify(b.credential.transports.slice(0, 6).map(String)) : null;
      await env.DB.batch([
        env.DB.prepare("UPDATE auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(), c.id),
        env.DB.prepare("INSERT INTO mfa_methods(id,user_id,type,label,credential_id,public_key_jwk,sign_count,transports,confirmed_at) VALUES(?,?,?,?,?,?,?,?,?)")
          .bind(crypto.randomUUID(), user.id, "passkey", label || "Passkey", reg.credentialId, JSON.stringify(reg.jwk), reg.signCount, transports, new Date().toISOString()),
        upgrade(env, user, "passkey"),
        await auditStatement(env, user, "mfa.enrolled", "user", user.id, { type: "passkey" }, request)
      ]);
      return respond({ ok: true });
    }
    case "email_start": {
      allow("email_otp");
      const r = await issueOtp(env, { id: user.id, email: user.email, display_name: user.display_name, organization_id: user.organization_id }, "enroll");
      return respond({ ok: true, sent: r.sent, error: r.error, devCode: r.devCode });
    }
    case "email_confirm": {
      allow("email_otp");
      await verifyOtp(env, user.id, "enroll", b.code);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM mfa_methods WHERE user_id=? AND type='email_otp'").bind(user.id),
        env.DB.prepare("INSERT INTO mfa_methods(id,user_id,type,label,confirmed_at) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(), user.id, "email_otp", "Email codes", new Date().toISOString()),
        upgrade(env, user, "email_otp"),
        await auditStatement(env, user, "mfa.enrolled", "user", user.id, { type: "email_otp" }, request)
      ]);
      return respond({ ok: true });
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
}
