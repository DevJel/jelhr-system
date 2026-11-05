import { respond, HttpError } from "../_shared/http.js";
import { parseTokenRequest, exchangeAuthorizationCode, issuerFor, oidcError } from "../_shared/oidc.js";
export async function onRequestPost({ request, env }) {
  let body;
  try { body = await parseTokenRequest(request); }
  catch (error) { return oidcError(error instanceof HttpError ? error.message : "invalid_request", error instanceof HttpError ? error.status : 400); }
  try { return respond(await exchangeAuthorizationCode(env, body, issuerFor(request, env)), 200, { "Cache-Control": "no-store", "Pragma": "no-cache" }); }
  catch (error) {
    if (error instanceof HttpError) return oidcError(error.message, error.status);
    console.error("OIDC token exchange failed", error?.message);
    return oidcError("server_error", 500);
  }
}
