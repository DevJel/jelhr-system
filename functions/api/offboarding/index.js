import { requireFeature } from "../../_shared/features.js";
import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../_shared/auth.js";
import * as v from "../../_shared/validate.js";

// [category, title, owner_role, due offset in days relative to the last working day]
export const CHECKLIST = [
  ["people", "Confirm last working day and send employee notices", "hr", -7],
  ["knowledge_transfer", "Document role responsibilities", "manager", -10],
  ["knowledge_transfer", "Transfer work and project ownership", "manager", -5],
  ["finance", "Review final pay and outstanding amounts", "finance", -3],
  ["people", "Complete exit interview", "hr", -2],
  ["it_access", "Disable company account access at the effective time", "it", 0],
  ["it_access", "Revoke active sessions, keys and credentials", "it", 0],
  ["finance", "Remove payment and purchasing authority", "finance", 0],
  ["assets", "Collect company equipment", "it", 0],
  ["assets", "Record asset condition and return", "it", 1],
  ["compliance", "Review retention schedule and legal holds", "hr", 7],
  ["compliance", "Close separation and archive record", "hr", 14]
];
export const REASONS = ["Resignation", "End of contract", "Retirement", "Involuntary separation", "Redundancy", "Mutual agreement", "Other"];
const addDays = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);

export async function onRequestGet(context) {
  const user = await authenticate(context, [...HR_READ, "manager"]);
  requireFeature(user, "offboarding");
  const url = new URL(context.request.url);
  const status = url.searchParams.get("status");
  const binds = [user.organization_id];
  let where = "c.organization_id=?";
  if (status) { where += " AND c.status=?"; binds.push(v.oneOf(status, ["in_progress", "pending_approval", "completed", "cancelled"], "status")); }
  if (user.role === "manager") { where += " AND e.manager_id=?"; binds.push(user.employee_id || "-"); }
  const { results } = await context.env.DB.prepare(
    `SELECT c.id, c.status, c.reason, c.last_working_day, c.exit_interview_status, c.final_pay_status, c.created_at, c.completed_at,
            e.id AS employee_id, e.employee_number, e.first_name, e.last_name, e.email, e.job_title, e.department,
            (SELECT COUNT(*) FROM offboarding_tasks t WHERE t.case_id=c.id) AS task_total,
            (SELECT COUNT(*) FROM offboarding_tasks t WHERE t.case_id=c.id AND t.status IN ('completed','not_applicable')) AS task_done,
            (SELECT COUNT(*) FROM signature_requests s WHERE s.offboarding_case_id=c.id AND s.status='pending') AS signatures_pending
       FROM offboarding_cases c JOIN employees e ON e.id=c.employee_id
      WHERE ${where} ORDER BY c.created_at DESC LIMIT 500`
  ).bind(...binds).all();
  return respond({ cases: results || [], reasons: REASONS });
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "offboarding");
  const { env, request } = context;
  const b = await readJson(request, 8192);
  const employee = await env.DB.prepare("SELECT id, employment_status FROM employees WHERE id=? AND organization_id=?")
    .bind(v.id(b.employeeId, "Employee"), user.organization_id).first();
  if (!employee) throw new HttpError(404, "Employee not found");
  if (employee.employment_status === "terminated") throw new HttpError(409, "This employee has already left");
  const reason = v.oneOf(b.reason, REASONS, "Reason");
  const lastWorkingDay = v.date(b.lastWorkingDay, "Last working day", { required: true });
  const notes = v.text(b.notes, "Notes", { max: 4000 });
  const open = await env.DB.prepare("SELECT id FROM offboarding_cases WHERE employee_id=? AND status IN ('in_progress','pending_approval')").bind(employee.id).first();
  if (open) throw new HttpError(409, "An active offboarding case already exists for this employee", { caseId: open.id });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare("INSERT INTO offboarding_cases(id,organization_id,employee_id,initiated_by,reason,last_working_day,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(id, user.organization_id, employee.id, user.id, reason, lastWorkingDay, notes, now, now),
    ...CHECKLIST.map((t, i) => env.DB.prepare("INSERT INTO offboarding_tasks(id,case_id,category,title,owner_role,due_date,sort_order) VALUES(?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), id, t[0], t[1], t[2], addDays(lastWorkingDay, t[3]), i)),
    env.DB.prepare("UPDATE employee_assets SET case_id=? WHERE employee_id=? AND organization_id=? AND status='assigned'").bind(id, employee.id, user.organization_id),
    env.DB.prepare("UPDATE employees SET employment_status='offboarding', updated_at=? WHERE id=?").bind(now, employee.id),
    await auditStatement(env, user, "offboarding.initiated", "offboarding_case", id, { reason, lastWorkingDay }, request)
  ];
  await env.DB.batch(statements);
  return respond({ id, status: "in_progress", taskCount: CHECKLIST.length }, 201);
}
