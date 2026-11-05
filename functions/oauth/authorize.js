import { respond } from "../_shared/http.js";
import { getClient, issuerFor, createAuthorizationCode, requireSignedInUser } from "../_shared/oidc-provider.js";
const fail = (message, status = 400) => respond({ error: message }, status);
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url), clientId = url.searchParams.get("client_id") || "";
  const client = getClient(env, clientId);
  if (!client) return fail("invalid_client");
  const redirectUri = url.searchParams.get("redirect_uri") || "";
  if (!client.redirectUris.includes(redirectUri)) return fail("invalid_redirect_uri");
  if (url.searchParams.get("response_type") !== "code") return fail("unsupported_response_type");
  const scope = String(url.searchParams.get("scope") || "").trim().split(/\s+/).filter(Boolean);
  if (!scope.includes("openid") || scope.some(s => !client.scopes.includes(s))) return fail("invalid_scope");
  const state = String(url.searchParams.get("state") || ""), nonce = String(url.searchParams.get("nonce") || "");
  const challenge = String(url.searchParams.get("code_challenge") || "");
  if (state.length < 16 || state.length > 512 || nonce.length < 16 || nonce.length > 512) return fail("invalid_request: state and nonce are required");
  if (url.searchParams.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail("invalid_request: PKCE S256 is required");
  const auth = await requireSignedInUser(request, env);
  if (auth.error) {
    const login = new URL("/login.html", issuerFor(request, env));
    login.searchParams.set("returnTo", url.pathname + url.search);
    return Response.redirect(login.toString(), 302);
  }
  const code = await createAuthorizationCode(env, auth.user, clientId, redirectUri, challenge, nonce, scope.join(" "));
  const destination = new URL(redirectUri);
  destination.searchParams.set("code", code); destination.searchParams.set("state", state);
  return Response.redirect(destination.toString(), 302);
}
