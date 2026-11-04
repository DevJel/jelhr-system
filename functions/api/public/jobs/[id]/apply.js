import { respond, readJson, HttpError, clientIp } from "../../../../_shared/http.js";
import { sha256b64 } from "../../../../_shared/crypto.js";
import { careersOrg } from "../../../../_shared/public.js";
import { decodeUpload, storeFile } from "../../../../_shared/files.js";
import { documentToText } from "../../../../_shared/ai.js";
import { sendEmail, renderEmailHtml, orgEmailContext } from "../../../../_shared/email.js";
import { openJob } from "./index.js";
import * as v from "../../../../_shared/validate.js";

const RESUME_TYPES = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "text/plain"];
const PER_HOUR = 5;

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  const r = await (env.__fetch || fetch)("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: String(token || ""), remoteip: ip }) });
  return Boolean((await r.json().catch(() => ({}))).success);
}

// POST /api/public/jobs/:id/apply — public application with résumé upload.
export async function onRequestPost(context) {
  const { request, env, params } = context;
  const { org } = await careersOrg(env, request);
  const job = await openJob(env, org.id, params.id);
  const b = await readJson(request, 8 * 1024 * 1024);
  if (b.website) return respond({ ok: true }, 201); // honeypot: bots fill hidden fields; pretend success
  const ip = clientIp(request), ipHash = await sha256b64(ip);
  if (!await verifyTurnstile(env, b.turnstileToken, ip)) throw new HttpError(400, "Please complete the security check and try again.");
  const key = await sha256b64("apply|" + org.id + "|" + ip), now = Math.floor(Date.now() / 1000);
  const rate = await env.DB.prepare("SELECT attempts, window_started_at FROM auth_rate_limits WHERE key=?").bind(key).first();
  const fresh = rate && now - rate.window_started_at < 3600;
  if (fresh && rate.attempts >= PER_HOUR) throw new HttpError(429, "Too many applications from this connection. Please try again later.");
  const first = v.text(b.firstName, "First name", { required: true, max: 80 });
  const last = v.text(b.lastName, "Last name", { required: true, max: 80 });
  const email = v.email(b.email);
  const phone = v.text(b.phone, "Phone", { max: 40 }) || null;
  const location = v.text(b.location, "Location", { max: 120 }) || null;
  const profile = b.profileUrl ? String(b.profileUrl).trim() : "";
  if (profile && !/^https:\/\/\S{4,300}$/.test(profile)) throw new HttpError(400, "Profile link must start with https://");
  const cover = v.text(b.coverLetter, "Cover letter", { max: 6000 }) || null;
  if (b.privacyAccepted !== true) throw new HttpError(400, "Please agree to the privacy notice to apply");
  const file = decodeUpload(env, b.resume, { allowed: RESUME_TYPES, field: "Résumé" });
  if (await env.DB.prepare("SELECT id FROM applicants WHERE organization_id=? AND email=? COLLATE NOCASE AND position=?").bind(org.id, email, job.title).first()) {
    throw new HttpError(409, "You've already applied for this role. We'll be in touch.");
  }
  const stored = await storeFile(env, { orgId: org.id, userId: null, ...file });
  const id = crypto.randomUUID(), iso = new Date().toISOString();
  await env.DB.batch([
    stored.statement,
    env.DB.prepare(`INSERT INTO applicants(id,organization_id,first_name,last_name,email,phone,position,stage,source,consent_to_contact,job_id,cover_letter,resume_file_id,profile_url,location,privacy_accepted_at,ip_hash,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, org.id, first, last, email, phone, job.title, "applied", "Careers site", b.futureContact ? 1 : 0, job.id, cover, stored.id, profile || null, location, iso, ipHash, iso, iso),
    env.DB.prepare("INSERT INTO auth_rate_limits(key,attempts,window_started_at,locked_until) VALUES(?,?,?,NULL) ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts, window_started_at=excluded.window_started_at")
      .bind(key, (fresh ? rate.attempts : 0) + 1, fresh ? rate.window_started_at : now),
    env.DB.prepare("INSERT INTO audit_logs(id,organization_id,actor_user_id,action,resource_type,resource_id,ip_hash) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(), org.id, null, "applicant.applied", "applicant", id, ipHash)
  ]);
  // After the response: extract résumé text for search/AI screening, and confirm receipt by email.
  const after = (async () => {
    const text = await documentToText(env, file);
    if (text) await env.DB.prepare("UPDATE applicants SET resume_text=? WHERE id=?").bind(text, id).run();
    const o = await orgEmailContext(env, org.id);
    const subject = `We received your application — ${job.title}`;
    const body = `Hi ${first},\n\nThank you for applying for ${job.title} at ${o.orgName}. Our team will review your application and contact you about next steps.\n\nYou don't need to reply to this email.`;
    await sendEmail(env, { to: email, toName: `${first} ${last}`, subject, text: body, html: renderEmailHtml({ subject, text: body, orgName: o.orgName, footer: o.footer }), fromName: o.senderName, replyTo: o.replyTo || undefined });
  })().catch(e => console.error("post-apply", e?.message));
  if (context.waitUntil) context.waitUntil(after); else await after;
  return respond({ ok: true, id }, 201);
}
