import { respond } from "../_shared/http.js";
import { publicJwk } from "../_shared/oidc-provider.js";
export async function onRequestGet({ env }) {
  const key = publicJwk(env);
  if (!key) return respond({ error: "OIDC public key is not configured." }, 503);
  return respond({ keys: [key] }, 200, { "Cache-Control": "public, max-age=300" });
}
