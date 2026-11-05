import { respond } from "../_shared/http.js";
import { verifyRs256, issuerFor, getClient } from "../_shared/oidc-provider.js";
export async function onRequestGet({ request, env }) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  if (!match) return respond({ error: "invalid_token" }, 401, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
  const claims = await verifyRs256(match[1], env), issuer = issuerFor(request, env);
  if (!claims || claims.iss !== issuer || claims.token_use !== "access" || !claims.sub || !claims.tenantId || !claims.userId || typeof claims.aud !== "string" || !getClient(env, claims.aud))
    return respond({ error: "invalid_token" }, 401, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
  const user = await env.DB.prepare("SELECT u.id,u.organization_id,u.email,u.display_name,u.role,u.status,o.status AS organization_status FROM users u JOIN organizations o ON o.id=u.organization_id WHERE u.id=? AND u.organization_id=?")
    .bind(claims.userId, claims.tenantId).first();
  if (!user || user.status !== "active" || user.organization_status !== "active" || user.id !== claims.sub) return respond({ error: "invalid_token" }, 401);
  return respond({ sub: user.id, userId: user.id, tenantId: user.organization_id, email: user.email, name: user.display_name, role: user.role });
}
