// Feature access: the platform enables features per organization; organization admins
// can narrow them per user. Core areas (people, security, settings) are always on.
import { HttpError } from "./http.js";

export const FEATURES = [
  { key: "recruitment", label: "Recruitment & careers site" },
  { key: "onboarding", label: "Onboarding" },
  { key: "offboarding", label: "Offboarding" },
  { key: "esign", label: "E-signatures" },
  { key: "communications", label: "Communications (email)" },
  { key: "time", label: "Time tracking" },
  { key: "ai", label: "AI assistant" }
];
export const FEATURE_KEYS = FEATURES.map(f => f.key);

const parse = json => { try { const v = JSON.parse(json); return Array.isArray(v) ? v.filter(k => FEATURE_KEYS.includes(k)) : null; } catch { return null; } };

/** Features the platform has enabled for the organization (null/absent = all). */
export const orgFeatures = json => (json ? parse(json) ?? FEATURE_KEYS : FEATURE_KEYS);

/** Effective features for a signed-in user. Owners/admins get everything the org has. */
export function userFeatures(user) {
  const org = orgFeatures(user.organization_features);
  if (["owner", "admin"].includes(user.role) || !user.features_json) return org;
  const mine = parse(user.features_json) ?? org;
  return org.filter(k => mine.includes(k));
}

export function requireFeature(user, key) {
  if (!orgFeatures(user.organization_features).includes(key)) throw new HttpError(403, "This feature isn't enabled for your organization", { code: "feature_disabled", feature: key });
  if (!userFeatures(user).includes(key)) throw new HttpError(403, "You don't have access to this feature. Ask your administrator.", { code: "feature_denied", feature: key });
}

export function normaliseFeatureList(list) {
  if (!Array.isArray(list)) throw new HttpError(400, "features must be a list");
  const bad = list.filter(k => !FEATURE_KEYS.includes(k));
  if (bad.length) throw new HttpError(400, "Unknown feature: " + bad.join(", "));
  return [...new Set(list)];
}
