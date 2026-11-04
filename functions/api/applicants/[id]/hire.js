import { respond, readJson, HttpError } from "../../../_shared/http.js";
import { authenticate, auditStatement, HR } from "../../../_shared/auth.js";
import { requireFeature } from "../../../_shared/features.js";
import { newInvite, sendInviteEmail } from "../../../_shared/invites.js";
import { STANDARD_PLAN } from "../../onboarding/index.js";
import { loadApplicant } from "./index.js";
import * as v from "../../../_shared/validate.js";

const addDays = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);

// Hire & onboard: applicant → employee (status onboarding), résumé copied to the employee's
// paperwork, optional standard onboarding plan, optional emailed sign-in invitation.
export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "recruitment");
  const { env, request } = context;
  const a = await loadApplicant(context, user);
  if (a.employee_id) throw new HttpError(409, "This applicant has already been hired");
  if (["rejected", "withdrawn"].includes(a.stage)) throw new HttpError(409, "Move the applicant out of Rejected/Withdrawn first");
  const b = await readJson(request, 8192);
  const workEmail = v.email(b.workEmail || a.email, "Work email");
  if (await env.DB.prepare("SELECT id FROM employees WHERE organization_id=? AND email=? COLLATE NOCASE").bind(user.organization_id, workEmail).first()) throw new HttpError(409, "An employee already uses this work email");
  const hireDate = v.date(b.hireDate, "Start date", { required: true });
  const jobTitle = v.text(b.jobTitle || a.job_title || a.position, "Job title", { required: true, max: 120 });
  const department = v.optionalText(b.department ?? a.job_department, "Department", 80) ?? null;
  const type = v.oneOf(b.employmentType || a.job_employment_type || "full_time", ["full_time", "part_time", "contract", "intern", "temporary"], "Employment type");
  let managerId = null;
  if (b.managerId) {
    const m = await env.DB.prepare("SELECT id FROM employees WHERE id=? AND organization_id=?").bind(v.id(b.managerId, "Manager"), user.organization_id).first();
    if (!m) throw new HttpError(400, "Manager not found");
    managerId = m.id;
  }
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM employees WHERE organization_id=?").bind(user.organization_id).first();
  let number = "E-" + String((count.n || 0) + 1).padStart(4, "0");
  if (await env.DB.prepare("SELECT id FROM employees WHERE organization_id=? AND employee_number=?").bind(user.organization_id, number).first()) number += "-" + crypto.randomUUID().slice(0, 4).toUpperCase();
  const empId = crypto.randomUUID(), now = new Date().toISOString();
  const statements = [
    env.DB.prepare(`INSERT INTO employees(id,organization_id,employee_number,first_name,last_name,email,personal_email,phone,location,job_title,department,employment_type,employment_status,hire_date,manager_id,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(empId, user.organization_id, number, a.first_name, a.last_name, workEmail, a.email, a.phone, a.location, jobTitle, department, type, "onboarding", hireDate, managerId, now, now),
    env.DB.prepare("UPDATE applicants SET stage='hired', employee_id=?, updated_at=? WHERE id=?").bind(empId, now, a.id)
  ];
  if (a.resume_file_id) statements.push(env.DB.prepare("INSERT INTO employee_documents(id,organization_id,employee_id,file_id,category,title,uploaded_by) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(), user.organization_id, empId, a.resume_file_id, "resume", "Résumé (from application)", user.id));
  if (b.assignPlan !== false) STANDARD_PLAN.forEach(([title, owner, offset], i) => statements.push(env.DB.prepare("INSERT INTO onboarding_tasks(id,organization_id,employee_id,title,owner_label,due_date,sort_order) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(), user.organization_id, empId, title, owner, addDays(hireDate, offset), i)));
  let invite = null, inviteUserId = null;
  if (b.invite) {
    if (await env.DB.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE").bind(workEmail).first()) throw new HttpError(409, "A sign-in already exists for this email");
    invite = await newInvite(); inviteUserId = crypto.randomUUID();
    statements.push(env.DB.prepare("INSERT INTO users(id,organization_id,email,display_name,role,status,invite_token_hash,invite_expires_at,invited_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .bind(inviteUserId, user.organization_id, workEmail, `${a.first_name} ${a.last_name}`, "employee", "invited", invite.hash, invite.expires, user.id, now, now));
    statements.push(env.DB.prepare("UPDATE employees SET user_id=? WHERE id=?").bind(inviteUserId, empId));
  }
  statements.push(await auditStatement(env, user, "applicant.hired", "applicant", a.id, { employeeId: empId, number }, request));
  statements.push(await auditStatement(env, user, "employee.created", "employee", empId, { number, fromApplicant: a.id }, request));
  await env.DB.batch(statements);
  let mail = null;
  if (invite) mail = await sendInviteEmail(env, request, { email: workEmail, name: `${a.first_name} ${a.last_name}`, organizationId: user.organization_id, token: invite.token, invitedBy: user.display_name });
  return respond({ employeeId: empId, employeeNumber: number, invited: Boolean(invite), inviteEmailed: mail?.ok ?? false, inviteLink: mail?.link }, 201);
}
