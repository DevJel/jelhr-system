import { requireFeature } from "../../_shared/features.js";
import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../_shared/auth.js";
import { emailStatus } from "../../_shared/email.js";
import { STAGES } from "../applicants/index.js";
import * as v from "../../_shared/validate.js";

export const AUDIENCES = ["employees", "department", "applicants", "former", "individuals"];
// D1 allows 100 bound parameters per statement and Workers Free allows 50 queries per
// invocation, so recipients are inserted 14 rows at a time and capped per message.
const MAX_RECIPIENTS = 500;
const ROWS_PER_INSERT = 14;

export async function resolveAudience(env, orgId, audience, filter = {}) {
  let rows = [];
  if (audience === "employees" || audience === "department" || audience === "individuals") {
    const binds = [orgId];
    let where = "organization_id=? AND employment_status IN ('active','onboarding','on_leave','offboarding')";
    if (audience === "department") {
      const dept = v.text(filter.department, "Department", { required: true, max: 80 });
      where += " AND department=?"; binds.push(dept);
    }
    if (audience === "individuals") {
      const ids = Array.isArray(filter.employeeIds) ? filter.employeeIds.map(x => v.id(x, "Employee")) : [];
      if (!ids.length) throw new HttpError(400, "Choose at least one employee");
      if (ids.length > 90) throw new HttpError(400, "Choose up to 90 people, or use a department or all-employee audience");
      where += ` AND id IN (${ids.map(() => "?").join(",")})`; binds.push(...ids);
    }
    const r = await env.DB.prepare(`SELECT id, first_name, last_name, email FROM employees WHERE ${where}`).bind(...binds).all();
    rows = (r.results || []).map(e => ({ type: "employee", id: e.id, email: e.email, first: e.first_name, last: e.last_name }));
  } else if (audience === "applicants") {
    const stages = Array.isArray(filter.stages) && filter.stages.length ? filter.stages.map(s => v.oneOf(s, STAGES, "Stage")) : ["applied", "screening", "interview", "offer"];
    const r = await env.DB.prepare(`SELECT id, first_name, last_name, email FROM applicants WHERE organization_id=? AND consent_to_contact=1 AND stage IN (${stages.map(() => "?").join(",")})`).bind(orgId, ...stages).all();
    rows = (r.results || []).map(a => ({ type: "applicant", id: a.id, email: a.email, first: a.first_name, last: a.last_name }));
  } else if (audience === "former") {
    const r = await env.DB.prepare("SELECT id, first_name, last_name, personal_email FROM employees WHERE organization_id=? AND employment_status='terminated' AND contact_opt_out=0 AND personal_email IS NOT NULL AND personal_email<>''").bind(orgId).all();
    rows = (r.results || []).map(e => ({ type: "former", id: e.id, email: e.personal_email, first: e.first_name, last: e.last_name }));
  } else throw new HttpError(400, "Unknown audience");
  const seen = new Set();
  const unique = rows.filter(r => { const k = String(r.email).toLowerCase(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
  if (unique.length > MAX_RECIPIENTS) throw new HttpError(413, `This audience has ${unique.length} recipients; the limit per message is ${MAX_RECIPIENTS}. Send by department instead.`);
  return unique;
}

export async function onRequestGet(context) {
  const user = await authenticate(context, HR_READ);
  requireFeature(user, "communications");
  const { results } = await context.env.DB.prepare(
    `SELECT c.id, c.subject, c.audience, c.audience_filter, c.status, c.recipient_count, c.sent_count, c.failed_count, c.provider, c.created_at, c.sent_at, u.display_name AS created_by_name
       FROM communications c LEFT JOIN users u ON u.id=c.created_by WHERE c.organization_id=? ORDER BY c.created_at DESC LIMIT 200`
  ).bind(user.organization_id).all();
  return respond({ communications: results || [], email: emailStatus(context.env), audiences: AUDIENCES });
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "communications");
  const { env, request } = context;
  const b = await readJson(request, 64 * 1024);
  const audience = v.oneOf(b.audience, AUDIENCES, "Audience");
  const filter = b.filter && typeof b.filter === "object" ? b.filter : {};
  const recipients = await resolveAudience(env, user.organization_id, audience, filter);
  if (b.dryRun) return respond({ count: recipients.length, sample: recipients.slice(0, 6).map(r => `${r.first} ${r.last}`) });
  const subject = v.text(b.subject, "Subject", { required: true, max: 200 });
  const body = v.text(b.body, "Message", { required: true, max: 20000 });
  if (!recipients.length) throw new HttpError(400, "No recipients match this audience");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare("INSERT INTO communications(id,organization_id,subject,body,audience,audience_filter,status,recipient_count,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, user.organization_id, subject, body, audience, JSON.stringify(filter).slice(0, 4000), "draft", recipients.length, user.id, now, now),
    await auditStatement(env, user, "communication.created", "communication", id, { audience, recipients: recipients.length }, request)
  ];
  for (let i = 0; i < recipients.length; i += ROWS_PER_INSERT) {
    const chunk = recipients.slice(i, i + ROWS_PER_INSERT);
    statements.push(env.DB.prepare(`INSERT INTO communication_recipients(id,communication_id,organization_id,recipient_type,recipient_id,email,name) VALUES ${chunk.map(() => "(?,?,?,?,?,?,?)").join(",")}`)
      .bind(...chunk.flatMap(r => [crypto.randomUUID(), id, user.organization_id, r.type, r.id, r.email, `${r.first} ${r.last}`.trim()])));
  }
  await env.DB.batch(statements);
  return respond({ id, recipientCount: recipients.length }, 201);
}
