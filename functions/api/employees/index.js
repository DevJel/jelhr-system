import { respond, readJson, HttpError } from "../../_shared/http.js";
import { authenticate, auditStatement, HR, HR_READ } from "../../_shared/auth.js";
import * as v from "../../_shared/validate.js";

export const EMPLOYEE_FIELDS = `e.id, e.employee_number, e.first_name, e.last_name, e.email, e.personal_email, e.phone, e.location,
  e.job_title, e.department, e.employment_type, e.employment_status, e.hire_date, e.manager_id, e.country_code,
  e.contact_opt_out, e.user_id, e.created_at, e.updated_at,
  m.first_name || ' ' || m.last_name AS manager_name`;
export const TYPES = ["full_time", "part_time", "contract", "intern", "temporary"];
const STATUS_FILTERS = {
  current: "('active','onboarding','on_leave','offboarding')",
  active: "('active')", onboarding: "('onboarding')", on_leave: "('on_leave')",
  offboarding: "('offboarding')", former: "('terminated')",
  all: "('active','onboarding','on_leave','offboarding','terminated')"
};

export async function onRequestGet(context) {
  const user = await authenticate(context);
  const url = new URL(context.request.url);
  const filter = STATUS_FILTERS[url.searchParams.get("status") || "current"];
  if (!filter) throw new HttpError(400, "Unknown status filter");
  const q = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 80);
  const department = (url.searchParams.get("department") || "").slice(0, 80);
  let where = `e.organization_id=? AND e.employment_status IN ${filter}`;
  const binds = [user.organization_id];
  if (!HR_READ.includes(user.role)) {
    if (user.role !== "manager" || !user.employee_id) throw new HttpError(403, "Insufficient permission");
    where += " AND (e.manager_id=? OR e.id=?)";
    binds.push(user.employee_id, user.employee_id);
  }
  if (q) {
    where += " AND (lower(e.first_name || ' ' || e.last_name) LIKE ? OR lower(e.email) LIKE ? OR lower(e.job_title) LIKE ? OR lower(e.employee_number) LIKE ?)";
    const like = `%${q.replace(/[%_]/g, "")}%`;
    binds.push(like, like, like, like);
  }
  if (department) { where += " AND e.department=?"; binds.push(department); }
  const { results } = await context.env.DB.prepare(
    `SELECT ${EMPLOYEE_FIELDS} FROM employees e LEFT JOIN employees m ON m.id=e.manager_id WHERE ${where} ORDER BY e.last_name, e.first_name LIMIT 1000`
  ).bind(...binds).all();
  const departments = await context.env.DB.prepare("SELECT DISTINCT department FROM employees WHERE organization_id=? AND department IS NOT NULL AND department<>'' ORDER BY department").bind(user.organization_id).all();
  const rows = (results || []).map(r => HR.includes(user.role) ? r : { ...r, personal_email: undefined, phone: undefined });
  return respond({ employees: rows, departments: (departments.results || []).map(d => d.department) });
}

export async function readEmployeeInput(env, user, b, existing = null) {
  const out = {};
  const req = !existing;
  if (req || b.firstName !== undefined) out.first_name = v.text(b.firstName, "First name", { required: true, max: 80 });
  if (req || b.lastName !== undefined) out.last_name = v.text(b.lastName, "Last name", { required: true, max: 80 });
  if (req || b.email !== undefined) out.email = v.email(b.email, "Work email");
  if (req || b.jobTitle !== undefined) out.job_title = v.text(b.jobTitle, "Job title", { required: true, max: 120 });
  if (b.department !== undefined) out.department = v.optionalText(b.department, "Department", 80);
  if (b.personalEmail !== undefined) out.personal_email = b.personalEmail ? v.email(b.personalEmail, "Personal email") : null;
  if (b.phone !== undefined) out.phone = v.optionalText(b.phone, "Phone", 40);
  if (b.location !== undefined) out.location = v.optionalText(b.location, "Location", 80);
  if (b.employmentType !== undefined) out.employment_type = v.oneOf(b.employmentType, TYPES, "Employment type");
  if (b.hireDate !== undefined) out.hire_date = v.date(b.hireDate, "Hire date");
  if (b.countryCode !== undefined) {
    const cc = b.countryCode ? String(b.countryCode).toUpperCase() : null;
    if (cc && !/^[A-Z]{2}$/.test(cc)) throw new HttpError(400, "Country code must be two letters");
    out.country_code = cc;
  }
  if (b.contactOptOut !== undefined) out.contact_opt_out = b.contactOptOut ? 1 : 0;
  if (b.employmentStatus !== undefined) {
    out.employment_status = v.oneOf(b.employmentStatus, ["active", "onboarding", "on_leave"], "Employment status");
    if (existing && ["offboarding", "terminated"].includes(existing.employment_status)) {
      throw new HttpError(409, "Status is controlled by the offboarding case for this employee");
    }
  }
  if (b.managerId !== undefined) {
    if (b.managerId) {
      const m = await env.DB.prepare("SELECT id FROM employees WHERE id=? AND organization_id=?").bind(v.id(b.managerId, "Manager"), user.organization_id).first();
      if (!m) throw new HttpError(400, "Manager not found");
      if (existing && m.id === existing.id) throw new HttpError(400, "An employee cannot manage themselves");
      out.manager_id = m.id;
    } else out.manager_id = null;
  }
  if (out.email) {
    const clash = await env.DB.prepare("SELECT id FROM employees WHERE organization_id=? AND email=? COLLATE NOCASE AND id<>?").bind(user.organization_id, out.email, existing?.id || "").first();
    if (clash) throw new HttpError(409, "Another employee already uses this work email");
  }
  return out;
}

export async function onRequestPost(context) {
  const user = await authenticate(context, HR);
  const { env, request } = context;
  const b = await readJson(request, 16384);
  const fields = await readEmployeeInput(env, user, b);
  let number = b.employeeNumber ? v.text(b.employeeNumber, "Employee number", { max: 30 }) : "";
  if (!number) {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM employees WHERE organization_id=?").bind(user.organization_id).first();
    number = "E-" + String((row.n || 0) + 1).padStart(4, "0");
  }
  const dupe = await env.DB.prepare("SELECT id FROM employees WHERE organization_id=? AND employee_number=?").bind(user.organization_id, number).first();
  if (dupe) number = number + "-" + crypto.randomUUID().slice(0, 4).toUpperCase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = { employment_status: "onboarding", employment_type: "full_time", ...fields, id, organization_id: user.organization_id, employee_number: number, created_at: now, updated_at: now };
  const cols = Object.keys(row);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO employees(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`).bind(...cols.map(c => row[c] ?? null)),
    await auditStatement(env, user, "employee.created", "employee", id, { number }, request)
  ]);
  return respond({ id, employeeNumber: number }, 201);
}
