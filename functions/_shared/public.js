// Public (unauthenticated) careers-site helpers.
import { HttpError } from "./http.js";
import { resolveWorkspace } from "./login.js";
import { loadSettings } from "./authpolicy.js";
import { orgFeatures } from "./features.js";

/** Organization for a public careers request: ?org=slug, or the branded custom domain. */
export async function careersOrg(env, request) {
  const slug = new URL(request.url).searchParams.get("org");
  const org = await resolveWorkspace(env, request, slug);
  if (!org || org.status !== "active") throw new HttpError(404, "Careers site not found");
  const settings = await loadSettings(env, org.id);
  if (!orgFeatures(org.features_json).includes("recruitment") || settings.branding?.careersEnabled === false) throw new HttpError(404, "This careers site isn't available");
  return { org, settings };
}

export const brandOf = (org, settings) => ({
  name: org.name, slug: org.slug, color: settings.branding?.color || "#ffdb5d", tagline: settings.branding?.tagline || "",
  intro: settings.branding?.careersIntro || "", privacyUrl: settings.branding?.privacyUrl || "",
  logoUrl: settings.branding?.logoFileId ? `/api/public/logo?org=${encodeURIComponent(org.slug)}` : null,
  customDomain: org.custom_domain || null
});
