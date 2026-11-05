import { respond } from "../_shared/http.js";
import { issuerFor } from "../_shared/oidc.js";
export async function onRequestGet({ request, env }) {
  const issuer = issuerFor(request, env);
  return respond({
    issuer, authorization_endpoint: issuer + "/oauth/authorize", token_endpoint: issuer + "/oauth/token",
    userinfo_endpoint: issuer + "/oauth/userinfo", jwks_uri: issuer + "/oauth/jwks.json",
    response_types_supported: ["code"], grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email"], token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    claims_supported: ["sub", "iss", "aud", "exp", "iat", "nonce", "email", "name", "tenantId", "userId", "role"]
  });
}
