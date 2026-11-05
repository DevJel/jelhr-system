// Response projection guard for browser-facing BFF handlers.
// Removes identity/tenant linkage and credential-shaped fields recursively while
// preserving domain record IDs needed by the UI and all Set-Cookie headers.
const PRIVATE_KEYS = new Set([
  "tenantid", "tenant_id", "organizationid", "organization_id",
  "userid", "user_id", "owner_user_id", "employee_user_id",
  "accesstoken", "access_token", "idtoken", "id_token",
  "refreshtoken", "refresh_token", "clientsecret", "client_secret",
  "code_verifier", "privatekey", "private_key"
]);

function project(value) {
  if (Array.isArray(value)) return value.map(project);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key.toLowerCase())) continue;
    out[key] = project(child);
  }
  return out;
}

export async function sanitizeBffResponse(response) {
  const type = response.headers.get("Content-Type") || "";
  if (!type.includes("application/json")) return response;
  const payload = await response.json().catch(() => null);
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.delete("Content-Encoding");
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(project(payload)), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
