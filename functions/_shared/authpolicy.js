// Organization sign-in policy, stored in organization_settings.settings_json.auth.
export const IDENTIFIERS = ["email", "username", "employee_id"];
export const MFA_METHODS = ["passkey", "totp", "email_otp"];
export const MFA_LEVELS = ["off", "admins", "all"];

export const DEFAULT_POLICY = {
  identifiers: ["email", "username", "employee_id"],
  mfa: "off",
  methods: ["passkey", "totp", "email_otp"],
  sso: { enabled: false, enforced: false, issuer: "", clientId: "", clientSecretEnc: "", domains: [], satisfiesMfa: true }
};

export async function loadSettings(env, orgId) {
  const row = await env.DB.prepare("SELECT settings_json FROM organization_settings WHERE organization_id=?").bind(orgId).first();
  try { return JSON.parse(row?.settings_json || "{}"); } catch { return {}; }
}

export function policyFrom(settings) {
  const p = settings?.auth || {};
  return {
    identifiers: Array.isArray(p.identifiers) && p.identifiers.length ? p.identifiers.filter(x => IDENTIFIERS.includes(x)) : DEFAULT_POLICY.identifiers,
    mfa: MFA_LEVELS.includes(p.mfa) ? p.mfa : "off",
    methods: Array.isArray(p.methods) && p.methods.length ? p.methods.filter(x => MFA_METHODS.includes(x)) : DEFAULT_POLICY.methods,
    sso: { ...DEFAULT_POLICY.sso, ...(p.sso || {}) }
  };
}

export async function loadPolicy(env, orgId) { return policyFrom(await loadSettings(env, orgId)); }

export const mfaRequiredFor = (policy, role) => policy.mfa === "all" || (policy.mfa === "admins" && ["owner", "admin", "hr_manager"].includes(role));

/** Public-safe view of the policy (no secrets). */
export const publicPolicy = p => ({ identifiers: p.identifiers, mfa: p.mfa, methods: p.methods, sso: { enabled: p.sso.enabled, enforced: p.sso.enforced, issuer: p.sso.issuer, clientId: p.sso.clientId, domains: p.sso.domains, satisfiesMfa: p.sso.satisfiesMfa, hasSecret: Boolean(p.sso.clientSecretEnc) } });
