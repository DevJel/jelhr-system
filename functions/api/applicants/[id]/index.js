import { respond, readJson, HttpError } from "../../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../../_shared/auth.js";
import { deleteFileContent } from "../../../_shared/files.js";
import { readApplicant } from "../index.js";
import * as v from "../../../_shared/validate.js";

export async function loadApplicant(context, user) {
  const a = await context.env.DB.prepare("SELECT a.*, j.title AS job_title, j.department AS job_department, j.employment_type AS job_employment_type FROM applicants a LEFT JOIN jobs j ON j.id=a.job_id WHERE a.id=? AND a.organization_id=?")
    .bind(v.id(context.params.id), user.organization_id).first();
  if (!a) throw new HttpError(404, "Applicant not found");
  return a;
}

export async function onRequestGet(context) {
  const user = await authenticate(context, HR_READ);
  const a = await loadApplicant(context, user);
  const [interviews, file, events] = await Promise.all([
    context.env.DB.prepare("SELECT * FROM interviews WHERE applicant_id=? ORDER BY scheduled_at DESC").bind(a.id).all(),
    a.resume_file_id ? context.env.DB.prepare("SELECT id, filename, content_type, size FROM stored_files WHERE id=?").bind(a.resume_file_id).first() : null,
    context.env.DB.prepare("SELECT a.action, a.metadata_json, a.created_at, u.display_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id WHERE a.organization_id=? AND a.resource_id=? ORDER BY a.created_at DESC LIMIT 50").bind(user.organization_id, a.id).all()
  ]);
  let ai = null; try { ai = a.ai_summary ? JSON.parse(a.ai_summary) : null; } catch {}
  delete a.ip_hash; delete a.resume_text;
  return respond({ applicant: { ...a, ai_summary: ai }, interviews: interviews.results || [], resume: file, events: events.results || [] });
}

export async function onRequestPatch(context) {
  const user = await authenticate(context, HR);
  const { env, request } = context;
  const a = await loadApplicant(context, user);
  const b = await readJson(request, 16384);
  const fields = readApplicant(b, true);
  if (fields.stage === "hired" && !a.employee_id) throw new HttpError(409, "Use “Hire & onboard” to move an applicant to Onboarded");
  if (a.stage === "hired" && fields.stage && fields.stage !== "hired") throw new HttpError(409, "This applicant is already an employee");
  const cols = Object.keys(fields);
  if (!cols.length) throw new HttpError(400, "Nothing to update");
  await env.DB.batch([
    env.DB.prepare(`UPDATE applicants SET ${cols.map(c => c + "=?").join(",")}, updated_at=? WHERE id=?`).bind(...cols.map(c => fields[c]), new Date().toISOString(), a.id),
    await auditStatement(env, user, fields.stage && fields.stage !== a.stage ? "applicant.stage_changed" : "applicant.updated", "applicant", a.id, fields.stage ? { from: a.stage, to: fields.stage } : { fields: cols }, request)
  ]);
  return respond({ ok: true });
}

// Permanently removes the applicant record (e.g. on an erasure request or end of retention).
export async function onRequestDelete(context) {
  const user = await authenticate(context, HR);
  const { env, request } = context;
  const a = await loadApplicant(context, user);
  if (a.employee_id) throw new HttpError(409, "This applicant was hired. Their résumé now belongs to the employee record.");
  const file = a.resume_file_id ? await env.DB.prepare("SELECT * FROM stored_files WHERE id=?").bind(a.resume_file_id).first() : null;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM interviews WHERE applicant_id=?").bind(a.id),
    env.DB.prepare("DELETE FROM applicants WHERE id=?").bind(a.id),
    env.DB.prepare("UPDATE communication_recipients SET email='[erased]', name='[erased]' WHERE recipient_type='applicant' AND recipient_id=? AND organization_id=?").bind(a.id, user.organization_id),
    ...(file ? [env.DB.prepare("DELETE FROM stored_files WHERE id=? AND id NOT IN (SELECT file_id FROM employee_documents)").bind(file.id)] : []),
    await auditStatement(env, user, "applicant.deleted", "applicant", a.id, null, request)
  ]);
  if (file) await deleteFileContent(env, file);
  return respond({ ok: true });
}
