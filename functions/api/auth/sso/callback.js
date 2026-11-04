import { decryptText } from "../../../_shared/crypto.js";
import { loadPolicy } from "../../../_shared/authpolicy.js";
import { loadChallenge, consumeChallenge, afterFirstFactor, finishLogin } from "../../../_shared/login.js";
import { discover, exchangeCode, verifyIdToken } from "../../../_shared/oidc.js";

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// A same-origin page hop so the SameSite=Strict session cookie is sent on the next request.
const hop = (target, cookie) => new Response(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${esc(target)}"><title>Signing in…</title><p>Signing in… <a href="${esc(target)}">Continue</a></p>`,
  { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
const fail = message => hop("/login.html?sso_error=" + encodeURIComponent(message));

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") || url.searchParams.get("error"));
  let c;
  try { c = await loadChallenge(env, url.searchParams.get("state"), "sso"); } catch { return fail("The sign-in link expired. Try again."); }
  await consumeChallenge(env, c.id).run();
  const p = await loadPolicy(env, c.organization_id);
  if (!p.sso.enabled) return fail("Single sign-on is turned off for this workspace");
  let identity;
  try {
    const conf = await discover(env, p.sso.issuer);
    const tokens = await exchangeCode(env, conf, {
      code: url.searchParams.get("code"), clientId: p.sso.clientId,
      clientSecret: p.sso.clientSecretEnc ? await decryptText(env, p.sso.clientSecretEnc) : undefined,
      redirectUri: new URL("/api/auth/sso/callback", request.url).toString(), verifier: c.data.verifier
    });
    identity = await verifyIdToken(env, conf, tokens.id_token, { clientId: p.sso.clientId, nonce: c.data.nonce });
  } catch (e) { return fail(e.message); }
  const domain = identity.email.split("@")[1];
  if (p.sso.domains?.length && !p.sso.domains.map(d => d.toLowerCase()).includes(domain)) return fail(`Accounts from ${domain} can't sign in to this workspace`);
  const user = await env.DB.prepare("SELECT id, organization_id, email, display_name, role, status, must_change_password FROM users WHERE organization_id=? AND email=? COLLATE NOCASE").bind(c.organization_id, identity.email).first();
  if (!user) return fail(`${identity.email} doesn't have a JelHR account in this workspace. Ask your administrator to invite you.`);
  if (user.status === "invited") await env.DB.prepare("UPDATE users SET status='active', invite_token_hash=NULL, invite_expires_at=NULL WHERE id=?").bind(user.id).run();
  else if (user.status !== "active") return fail("Your account is disabled");
  const audit = env.DB.prepare("INSERT INTO auth_events(id,user_id,email,event) VALUES(?,?,?,?)").bind(crypto.randomUUID(), user.id, user.email, "sso_login");
  const res = p.sso.satisfiesMfa
    ? await finishLogin(env, request, user, { authMethod: "sso", mfaMethod: "sso", extra: [audit] })
    : await afterFirstFactor(env, request, user, { authMethod: "sso", extra: [audit] });
  const data = await res.clone().json();
  if (data.mfaRequired) return hop(`/login.html#mfa=${encodeURIComponent(data.challengeId)}&methods=${encodeURIComponent(data.methods.join(","))}&hint=${encodeURIComponent(data.emailHint)}`);
  const home = ["owner", "admin", "hr_manager", "auditor"].includes(user.role) ? "/index.html" : "/employee.html";
  return hop(home, res.headers.get("Set-Cookie"));
}
