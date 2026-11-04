import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../_shared/auth.js";
import { requireFeature } from "../../_shared/features.js";
import { sendEmail, renderEmailHtml, orgEmailContext } from "../../_shared/email.js";
import * as v from "../../_shared/validate.js";

export const MODES = ["video", "phone", "onsite"];
export const isoDateTime = (value, field) => {
  const s = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `${field} must be a date and time`);
  return new Date(s).toISOString();
};

export async function onRequestGet(context) {
  const user = await authenticate(context, HR_READ);
  requireFeature(user, "recruitment");
  const scope = new URL(context.request.url).searchParams.get("scope") || "upcoming";
  const { results } = await context.env.DB.prepare(
    `SELECT i.*, a.first_name || ' ' || a.last_name AS applicant_name, a.email AS applicant_email, a.position, a.stage
       FROM interviews i JOIN applicants a ON a.id=i.applicant_id
      WHERE i.organization_id=? ${scope === "upcoming" ? "AND i.status='scheduled'" : ""} ORDER BY i.scheduled_at ${scope === "upcoming" ? "ASC" : "DESC"} LIMIT 500`
  ).bind(user.organization_id).all();
  return respond({ interviews: results || [] });
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "recruitment");
  const { env, request } = context;
  const b = await readJson(request, 8192);
  const a = await env.DB.prepare("SELECT id, first_name, last_name, email, position, stage FROM applicants WHERE id=? AND organization_id=?").bind(v.id(b.applicantId, "Applicant"), user.organization_id).first();
  if (!a) throw new HttpError(404, "Applicant not found");
  if (["hired", "rejected", "withdrawn"].includes(a.stage)) throw new HttpError(409, "This applicant is no longer in the pipeline");
  const when = isoDateTime(b.scheduledAt, "Interview time");
  const mode = v.oneOf(b.mode || "video", MODES, "Format");
  const duration = v.int(b.durationMinutes, "Duration", { min: 10, max: 480, fallback: 45 });
  const location = v.text(b.location, "Location or link", { max: 300 }) || null;
  const interviewer = v.text(b.interviewer, "Interviewer", { max: 160 }) || null;
  const id = crypto.randomUUID();
  const statements = [
    env.DB.prepare("INSERT INTO interviews(id,organization_id,applicant_id,scheduled_at,duration_minutes,mode,location,interviewer,created_by) VALUES(?,?,?,?,?,?,?,?,?)").bind(id, user.organization_id, a.id, when, duration, mode, location, interviewer, user.id),
    await auditStatement(env, user, "interview.scheduled", "applicant", a.id, { interviewId: id, when }, request)
  ];
  if (["applied", "screening"].includes(a.stage)) statements.push(env.DB.prepare("UPDATE applicants SET stage='interview', updated_at=? WHERE id=?").bind(new Date().toISOString(), a.id));
  await env.DB.batch(statements);
  let notified = false, notifyError;
  if (b.notifyCandidate) {
    const org = await orgEmailContext(env, user.organization_id);
    const tz = (await env.DB.prepare("SELECT timezone FROM organizations WHERE id=?").bind(user.organization_id).first()).timezone;
    const whenText = new Intl.DateTimeFormat("en-GB", { dateStyle: "full", timeStyle: "short", timeZone: tz }).format(new Date(when)) + ` (${tz})`;
    const subject = `Interview for ${a.position} at ${org.orgName}`;
    const text = `Hi ${a.first_name},\n\nThank you for applying for ${a.position}. We'd like to invite you to a ${mode} interview.\n\nWhen: ${whenText}\nDuration: ${duration} minutes${location ? `\nWhere: ${location}` : ""}${interviewer ? `\nWith: ${interviewer}` : ""}\n\nReply to this email if you need a different time.\n\n${org.orgName} recruitment team`;
    const r = await sendEmail(env, { to: a.email, toName: `${a.first_name} ${a.last_name}`, subject, text, html: renderEmailHtml({ subject, text, orgName: org.orgName, footer: org.footer }), fromName: org.senderName, replyTo: org.replyTo || undefined });
    notified = r.ok; notifyError = r.ok ? undefined : r.error;
  }
  return respond({ id, notified, notifyError }, 201);
}
