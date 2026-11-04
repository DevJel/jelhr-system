import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, ADMIN } from "../../_shared/auth.js";
import { emailStatus } from "../../_shared/email.js";
import { aiStatus } from "../../_shared/ai.js";
import { encryptText } from "../../_shared/crypto.js";
import { policyFrom, publicPolicy, IDENTIFIERS, MFA_METHODS, MFA_LEVELS } from "../../_shared/authpolicy.js";
import { FEATURES, orgFeatures } from "../../_shared/features.js";
import { decodeUpload, storeFile, limitFor } from "../../_shared/files.js";
import { discover } from "../../_shared/oidc.js";
import * as v from "../../_shared/validate.js";

const HEX = /^#[0-9a-f]{6}$/i;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

async function readAll(env, orgId) {
  const org = await env.DB.prepare("SELECT o.id, o.name, o.slug, o.timezone, o.status, o.custom_domain, o.features_json, o.ai_daily_limit, o.country_code, s.settings_json FROM organizations o LEFT JOIN organization_settings s ON s.organization_id=o.id WHERE o.id=?").bind(orgId).first();
  let settings = {};
  try { settings = JSON.parse(org?.settings_json || "{}"); } catch {}
  return { org, settings };
}

export async function onRequestGet(context) {
  const user = await authenticate(context, [], { allowPasswordChange: true });
  const { env } = context;
  const { org, settings } = await readAll(env, user.organization_id);
  const counts = await env.DB.prepare("SELECT COUNT(*) AS employees FROM employees WHERE organization_id=? AND employment_status<>'terminated'").bind(user.organization_id).first();
  const enabled = orgFeatures(org.features_json);
  const admin = ADMIN.includes(user.role);
  return respond({
    organization: { id: org.id, name: org.name, slug: org.slug, timezone: org.timezone, status: org.status, employees: counts.employees, customDomain: org.custom_domain, aiDailyLimit: org.ai_daily_limit, countryCode: org.country_code },
    aiProfile: { assistantName: settings.ai?.assistantName || "JelHR Assistant", tone: settings.ai?.tone || "", instructions: settings.ai?.instructions || "", labourLaw: settings.ai?.labourLaw || "" },
    settings: { emailFooter: settings.emailFooter || "", replyTo: settings.replyTo || "", senderName: settings.senderName || org.name },
    branding: { color: settings.branding?.color || "#ffdb5d", tagline: settings.branding?.tagline || "", careersIntro: settings.branding?.careersIntro || "", careersEnabled: settings.branding?.careersEnabled !== false, logoFileId: settings.branding?.logoFileId || null, privacyUrl: settings.branding?.privacyUrl || "" },
    auth: admin ? publicPolicy(policyFrom(settings)) : { mfa: policyFrom(settings).mfa, methods: policyFrom(settings).methods },
    features: FEATURES.map(f => ({ ...f, enabled: enabled.includes(f.key) })),
    email: emailStatus(env),
    ai: aiStatus(env),
    storage: { provider: env.FILES ? "r2" : "d1", maxUploadBytes: limitFor(env) },
    ssoCallbackUrl: new URL("/api/auth/sso/callback", context.request.url).toString()
  });
}

export async function onRequestPatch(context) {
  const user = await authenticate(context, ADMIN);
  const { env, request } = context;
  const b = await readJson(request, 3 * 1024 * 1024);
  const { org, settings } = await readAll(env, user.organization_id);
  const statements = [];
  const now = new Date().toISOString();
  const changed = [];
  if (b.name !== undefined) { statements.push(env.DB.prepare("UPDATE organizations SET name=?, updated_at=? WHERE id=?").bind(v.text(b.name, "Organization name", { required: true, max: 120 }), now, org.id)); changed.push("name"); }
  if (b.timezone !== undefined) { statements.push(env.DB.prepare("UPDATE organizations SET timezone=?, updated_at=? WHERE id=?").bind(v.timezone(b.timezone), now, org.id)); changed.push("timezone"); }
  if (b.customDomain !== undefined) {
    const d = b.customDomain ? String(b.customDomain).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null;
    if (d && !DOMAIN.test(d)) throw new HttpError(400, "Enter a domain like careers.yourcompany.com");
    if (d && d.endsWith(".pages.dev")) throw new HttpError(400, "Use your own domain, not a pages.dev address");
    if (d && await env.DB.prepare("SELECT id FROM organizations WHERE custom_domain=? AND id<>?").bind(d, org.id).first()) throw new HttpError(409, "That domain is used by another workspace");
    statements.push(env.DB.prepare("UPDATE organizations SET custom_domain=?, updated_at=? WHERE id=?").bind(d, now, org.id)); changed.push("customDomain");
  }
  if (b.countryCode !== undefined) { const cc = b.countryCode ? String(b.countryCode).toUpperCase() : null; if (cc && !/^[A-Z]{2}$/.test(cc)) throw new HttpError(400, "Country must be a two-letter code like MY"); statements.push(env.DB.prepare("UPDATE organizations SET country_code=? WHERE id=?").bind(cc, org.id)); changed.push("countryCode"); }
  if (b.ai !== undefined) {
    const x = b.ai || {}, cur = settings.ai || {};
    settings.ai = {
      assistantName: x.assistantName !== undefined ? v.text(x.assistantName, "Assistant name", { max: 60 }) : cur.assistantName,
      tone: x.tone !== undefined ? v.text(x.tone, "Tone", { max: 120 }) : cur.tone,
      instructions: x.instructions !== undefined ? v.text(x.instructions, "Instructions", { max: 4000 }) : cur.instructions,
      labourLaw: x.labourLaw !== undefined ? v.text(x.labourLaw, "Labour-law notes", { max: 8000 }) : cur.labourLaw
    };
    changed.push("ai");
  }
  if (b.emailFooter !== undefined) { settings.emailFooter = v.text(b.emailFooter, "Email footer", { max: 600 }); changed.push("emailFooter"); }
  if (b.senderName !== undefined) { settings.senderName = v.text(b.senderName, "Sender name", { max: 80 }); changed.push("senderName"); }
  if (b.replyTo !== undefined) { settings.replyTo = b.replyTo ? v.email(b.replyTo, "Reply-to") : ""; changed.push("replyTo"); }

  if (b.branding !== undefined) {
    const br = { ...(settings.branding || {}) };
    const x = b.branding || {};
    if (x.color !== undefined) { if (!HEX.test(x.color)) throw new HttpError(400, "Brand colour must be a hex colour like #ffdb5d"); br.color = x.color.toLowerCase(); }
    if (x.tagline !== undefined) br.tagline = v.text(x.tagline, "Tagline", { max: 140 });
    if (x.careersIntro !== undefined) br.careersIntro = v.text(x.careersIntro, "Careers introduction", { max: 2000 });
    if (x.careersEnabled !== undefined) br.careersEnabled = Boolean(x.careersEnabled);
    if (x.privacyUrl !== undefined) { const u = String(x.privacyUrl || ""); if (u && !/^https:\/\/\S+$/.test(u)) throw new HttpError(400, "Privacy notice must be an https:// link"); br.privacyUrl = u; }
    if (x.logo) {
      const f = decodeUpload(env, x.logo, { allowed: ["image/png", "image/jpeg", "image/webp"], field: "Logo" });
      if (f.bytes.length > 512 * 1024) throw new HttpError(413, "Logo must be 512 KB or smaller");
      const stored = await storeFile(env, { orgId: org.id, userId: user.id, ...f });
      statements.push(stored.statement);
      br.logoFileId = stored.id;
    }
    if (x.removeLogo) br.logoFileId = null;
    settings.branding = br; changed.push("branding");
  }

  if (b.auth !== undefined) {
    const cur = policyFrom(settings);
    const a = b.auth || {};
    const next = { ...cur, sso: { ...cur.sso } };
    if (a.identifiers !== undefined) {
      if (!Array.isArray(a.identifiers) || a.identifiers.some(x => !IDENTIFIERS.includes(x))) throw new HttpError(400, "Unknown sign-in identifier");
      next.identifiers = [...new Set(["email", ...a.identifiers])];
    }
    if (a.mfa !== undefined) next.mfa = v.oneOf(a.mfa, MFA_LEVELS, "Two-step verification requirement");
    if (a.methods !== undefined) {
      if (!Array.isArray(a.methods) || !a.methods.length || a.methods.some(x => !MFA_METHODS.includes(x))) throw new HttpError(400, "Choose at least one two-step method");
      next.methods = [...new Set(a.methods)];
    }
    if (a.sso !== undefined) {
      const s = a.sso || {};
      if (s.issuer !== undefined) { const iss = String(s.issuer || "").trim().replace(/\/$/, ""); if (iss && !/^https:\/\/\S+$/.test(iss)) throw new HttpError(400, "Issuer must be an https:// URL"); next.sso.issuer = iss; }
      if (s.clientId !== undefined) next.sso.clientId = v.text(s.clientId, "Client ID", { max: 200 });
      if (s.clientSecret) next.sso.clientSecretEnc = await encryptText(env, v.text(s.clientSecret, "Client secret", { max: 500 }));
      if (s.clearSecret) next.sso.clientSecretEnc = "";
      if (s.domains !== undefined) {
        const list = (Array.isArray(s.domains) ? s.domains : String(s.domains).split(/[\s,]+/)).map(d => String(d).trim().toLowerCase()).filter(Boolean);
        if (list.some(d => !DOMAIN.test(d))) throw new HttpError(400, "Allowed email domains must look like company.com");
        next.sso.domains = list.slice(0, 20);
      }
      if (s.satisfiesMfa !== undefined) next.sso.satisfiesMfa = Boolean(s.satisfiesMfa);
      if (s.enabled !== undefined) next.sso.enabled = Boolean(s.enabled);
      if (s.enforced !== undefined) next.sso.enforced = Boolean(s.enforced);
      if (next.sso.enabled && (!next.sso.issuer || !next.sso.clientId)) throw new HttpError(400, "Add the issuer URL and client ID before turning SSO on");
      if (next.sso.enforced && !next.sso.enabled) throw new HttpError(400, "Turn SSO on before enforcing it");
    }
    settings.auth = next; changed.push("auth");
  }

  if (changed.some(k => ["emailFooter", "senderName", "replyTo", "branding", "auth", "ai"].includes(k))) {
    statements.push(env.DB.prepare("INSERT INTO organization_settings(organization_id,settings_json,updated_at) VALUES(?,?,?) ON CONFLICT(organization_id) DO UPDATE SET settings_json=excluded.settings_json, updated_at=excluded.updated_at")
      .bind(org.id, JSON.stringify(settings), now));
  }
  if (!statements.length) throw new HttpError(400, "Nothing to update");
  statements.push(await auditStatement(env, user, "settings.updated", "organization", org.id, { fields: changed }, request));
  await env.DB.batch(statements);
  return respond({ ok: true });
}

// POST { action: "test_sso", issuer } — checks the identity provider's discovery document.
export async function onRequestPost(context) {
  await authenticate(context, ADMIN);
  const b = await readJson(context.request, 2048);
  if (b.action !== "test_sso") throw new HttpError(400, "Unknown action");
  const issuer = String(b.issuer || "").trim();
  if (!/^https:\/\/\S+$/.test(issuer)) throw new HttpError(400, "Issuer must be an https:// URL");
  try {
    const conf = await discover(context.env, issuer);
    return respond({ ok: true, issuer: conf.issuer, authorization: conf.authorization_endpoint });
  } catch (e) { throw new HttpError(502, e.message); }
}
