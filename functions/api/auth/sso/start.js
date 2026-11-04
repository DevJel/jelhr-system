import { respond } from "../../../_shared/http.js";
import { randomToken } from "../../../_shared/crypto.js";
import { loadPolicy } from "../../../_shared/authpolicy.js";
import { resolveWorkspace } from "../../../_shared/login.js";
import { discover, pkcePair, authorizeUrl } from "../../../_shared/oidc.js";

const back = (request, message) => Response.redirect(new URL("/login.html?sso_error=" + encodeURIComponent(message), request.url).toString(), 302);

// GET /api/auth/sso/start?workspace=acme[&email=…] → redirect to the organization's identity provider.
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const org = await resolveWorkspace(env, request, url.searchParams.get("workspace"));
  if (!org || org.status !== "active") return back(request, "Workspace not found");
  const p = await loadPolicy(env, org.id);
  if (!p.sso.enabled || !p.sso.issuer || !p.sso.clientId) return back(request, "Single sign-on isn't set up for this workspace");
  try {
    const conf = await discover(env, p.sso.issuer);
    const { verifier, challenge } = await pkcePair();
    const id = crypto.randomUUID(), nonce = randomToken(16);
    await env.DB.prepare("INSERT INTO auth_challenges(id,purpose,organization_id,challenge,data_json,expires_at) VALUES(?,?,?,?,?,?)")
      .bind(id, "sso", org.id, nonce, JSON.stringify({ verifier, nonce }), new Date(Date.now() + 10 * 60000).toISOString()).run();
    const redirectUri = new URL("/api/auth/sso/callback", request.url).toString();
    return Response.redirect(authorizeUrl(conf, { clientId: p.sso.clientId, redirectUri, state: id, nonce, codeChallenge: challenge, loginHint: url.searchParams.get("email") || undefined }), 302);
  } catch (e) {
    return back(request, e.message);
  }
}

export const onRequestPost = () => respond({ error: "Use GET" }, 405);
