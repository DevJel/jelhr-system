import { respond } from "../../_shared/http.js";
import { loadPolicy } from "../../_shared/authpolicy.js";
import { resolveWorkspace } from "../../_shared/login.js";
import { loadSettings } from "../../_shared/authpolicy.js";

// Public: sign-in options for a workspace (by ?workspace=slug or the branded domain).
// Reveals only what the sign-in page needs: name, brand colour, allowed identifiers, SSO/passkey.
export async function onRequestGet({ request, env }) {
  const ws = new URL(request.url).searchParams.get("workspace");
  const org = await resolveWorkspace(env, request, ws);
  if (!org || org.status !== "active") return respond({ found: false });
  const settings = await loadSettings(env, org.id);
  const p = await loadPolicy(env, org.id);
  return respond({
    found: true,
    workspace: { slug: org.slug, name: org.name, brandColor: settings.branding?.color || null, logoFileId: settings.branding?.logoFileId || null },
    identifiers: p.identifiers,
    passkey: p.methods.includes("passkey"),
    sso: { enabled: Boolean(p.sso.enabled && p.sso.issuer && p.sso.clientId), enforced: Boolean(p.sso.enforced) }
  });
}
