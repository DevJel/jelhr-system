import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../_shared/auth.js";
import { requireFeature } from "../../_shared/features.js";
import { STAGES } from "../../_shared/recruitment.js";
import * as v from "../../_shared/validate.js";

export { STAGES };

export function readApplicant(b, partial = false) {
  const out = {};
  if (!partial || b.firstName !== undefined) out.first_name = v.text(b.firstName, "First name", { required: true, max: 80 });
  if (!partial || b.lastName !== undefined) out.last_name = v.text(b.lastName, "Last name", { required: true, max: 80 });
  if (!partial || b.email !== undefined) out.email = v.email(b.email);
  if (!partial || b.position !== undefined) out.position = v.text(b.position, "Position", { required: true, max: 120 });
  if (b.phone !== undefined) out.phone = v.optionalText(b.phone, "Phone", 40);
  if (b.stage !== undefined || !partial) out.stage = v.oneOf(b.stage || "applied", STAGES, "Stage");
  if (b.source !== undefined) out.source = v.optionalText(b.source, "Source", 80);
  if (b.notes !== undefined) out.notes = v.optionalText(b.notes, "Notes", 4000);
  if (b.location !== undefined) out.location = v.optionalText(b.location, "Location", 120);
  if (b.rating !== undefined) out.rating = b.rating === null || b.rating === "" ? null : v.int(b.rating, "Rating", { min: 1, max: 5 });
  if (b.consentToContact !== undefined || !partial) out.consent_to_contact = b.consentToContact === false ? 0 : 1;
  return out;
}

const LIST = `a.id, a.first_name, a.last_name, a.email, a.phone, a.position, a.stage, a.source, a.consent_to_contact, a.created_at, a.updated_at,
  a.job_id, a.rating, a.location, a.resume_file_id, a.employee_id, a.ai_summary IS NOT NULL AS has_ai_summary, j.title AS job_title,
  (SELECT MIN(i.scheduled_at) FROM interviews i WHERE i.applicant_id=a.id AND i.status='scheduled' AND i.scheduled_at>=datetime('now')) AS next_interview`;

export async function onRequestGet(context) {
  const user = await authenticate(context, HR_READ);
  const url = new URL(context.request.url);
  const binds = [user.organization_id];
  let where = "a.organization_id=?";
  const stage = url.searchParams.get("stage");
  if (stage) { where += " AND a.stage=?"; binds.push(v.oneOf(stage, STAGES, "stage")); }
  const job = url.searchParams.get("jobId");
  if (job) { where += " AND a.job_id=?"; binds.push(v.id(job, "jobId")); }
  const q = (url.searchParams.get("q") || "").trim().toLowerCase().replace(/[%_]/g, "").slice(0, 80);
  if (q) { where += " AND (lower(a.first_name || ' ' || a.last_name) LIKE ? OR lower(a.email) LIKE ? OR lower(a.position) LIKE ?)"; binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const { results } = await context.env.DB.prepare(`SELECT ${LIST} FROM applicants a LEFT JOIN jobs j ON j.id=a.job_id WHERE ${where} ORDER BY a.created_at DESC LIMIT 1000`).bind(...binds).all();
  return respond({ applicants: results || [], stages: STAGES });
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  const { env, request } = context;
  const b = await readJson(request, 16384);
  const fields = readApplicant(b);
  if (b.jobId) {
    requireFeature(user, "recruitment");
    const j = await env.DB.prepare("SELECT id, title FROM jobs WHERE id=? AND organization_id=?").bind(v.id(b.jobId, "Job"), user.organization_id).first();
    if (!j) throw new HttpError(404, "Job not found");
    fields.job_id = j.id;
  }
  const dupe = await env.DB.prepare("SELECT id FROM applicants WHERE organization_id=? AND email=? COLLATE NOCASE AND position=?").bind(user.organization_id, fields.email, fields.position).first();
  if (dupe) throw new HttpError(409, "This applicant is already recorded for this position");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = { ...fields, id, organization_id: user.organization_id, created_by: user.id, created_at: now, updated_at: now };
  const cols = Object.keys(row);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO applicants(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`).bind(...cols.map(c => row[c] ?? null)),
    await auditStatement(env, user, "applicant.created", "applicant", id, { position: fields.position }, request)
  ]);
  return respond({ id }, 201);
}
