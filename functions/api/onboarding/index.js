import { requireFeature } from "../../_shared/features.js";
import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, isManagerOf, HR, HR_READ } from "../../_shared/auth.js";
import * as v from "../../_shared/validate.js";

// [title, owner label, day offset from hire date]
export const STANDARD_PLAN = [
  ["Send welcome pack and first-day details", "People Operations", -3],
  ["Prepare laptop, accounts and access", "IT", -1],
  ["Team introduction", "Manager", 0],
  ["Complete employee profile", "New employee", 1],
  ["Review company handbook and policies", "New employee", 3],
  ["Security and privacy training", "New employee", 5],
  ["Role and goals alignment", "Manager", 7],
  ["Benefits orientation", "People Operations", 10],
  ["30-day check-in", "Manager", 30]
];
const addDays = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);

export async function onRequestGet(context) {
  const user = await authenticate(context);
  requireFeature(user, "onboarding");
  const { env } = context;
  const url = new URL(context.request.url);
  const employeeId = url.searchParams.get("employeeId");
  const binds = [user.organization_id];
  let where = "t.organization_id=?";
  if (employeeId) {
    const id = v.id(employeeId, "employeeId");
    if (!(HR_READ.includes(user.role) || id === user.employee_id || await isManagerOf(env, user, id))) throw new HttpError(403, "Insufficient permission");
    where += " AND t.employee_id=?"; binds.push(id);
  } else if (url.searchParams.get("scope") === "team") {
    if (user.role === "manager") { where += " AND e.manager_id=?"; binds.push(user.employee_id || "-"); }
    else if (!HR_READ.includes(user.role)) throw new HttpError(403, "Insufficient permission");
  } else {
    where += " AND t.employee_id=?"; binds.push(user.employee_id || "-");
  }
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.employee_id, t.title, t.description, t.owner_label, t.due_date, t.completed_at, t.sort_order,
            e.first_name || ' ' || e.last_name AS employee_name, e.employee_number, e.employment_status, u.display_name AS completed_by_name
       FROM onboarding_tasks t JOIN employees e ON e.id=t.employee_id LEFT JOIN users u ON u.id=t.completed_by
      WHERE ${where} ORDER BY e.last_name, t.sort_order, t.due_date LIMIT 2000`
  ).bind(...binds).all();
  return respond({ tasks: results || [], plan: STANDARD_PLAN.map(([title, owner, offset]) => ({ title, owner, offset })) });
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  requireFeature(user, "onboarding");
  const { env, request } = context;
  const b = await readJson(request, 8192);
  const employee = await env.DB.prepare("SELECT id, hire_date, employment_status FROM employees WHERE id=? AND organization_id=?").bind(v.id(b.employeeId, "Employee"), user.organization_id).first();
  if (!employee) throw new HttpError(404, "Employee not found");
  if (employee.employment_status === "terminated") throw new HttpError(409, "Former employees cannot be onboarded");
  const statements = [];
  let created = 0;
  if (b.plan === "standard") {
    const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM onboarding_tasks WHERE employee_id=?").bind(employee.id).first();
    if (existing.n) throw new HttpError(409, "This employee already has onboarding tasks. Add tasks individually instead.");
    const start = employee.hire_date || new Date().toISOString().slice(0, 10);
    STANDARD_PLAN.forEach(([title, owner, offset], i) => {
      statements.push(env.DB.prepare("INSERT INTO onboarding_tasks(id,organization_id,employee_id,title,owner_label,due_date,sort_order) VALUES(?,?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), user.organization_id, employee.id, title, owner, addDays(start, offset), i));
    });
    created = STANDARD_PLAN.length;
  } else {
    const max = await env.DB.prepare("SELECT COALESCE(MAX(sort_order),0) AS n FROM onboarding_tasks WHERE employee_id=?").bind(employee.id).first();
    statements.push(env.DB.prepare("INSERT INTO onboarding_tasks(id,organization_id,employee_id,title,description,owner_label,due_date,sort_order) VALUES(?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), user.organization_id, employee.id, v.text(b.title, "Task title", { required: true, max: 160 }), v.text(b.description, "Description", { max: 1000 }) || null,
        v.text(b.ownerLabel, "Owner", { max: 60 }) || "People Operations", v.date(b.dueDate, "Due date"), (max.n || 0) + 1));
    created = 1;
  }
  statements.push(await auditStatement(env, user, "onboarding.tasks_created", "employee", employee.id, { count: created }, request));
  await env.DB.batch(statements);
  return respond({ ok: true, created }, 201);
}
